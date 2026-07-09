import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Queries } from '@cavelang/eval'

test('parse: patterns, WHERE lines, solutions, none, bare, comments', () => {
  const { queries, problems } = Queries.parseQueries([
    '; behavioral checks',
    '?a PARENT-OF+ me',
    '  ?a = anna',
    '  ?a = maria',
    '',
    'jan HAS birth-year: ?y',
    '  WHERE conf >= 0.6',
    '  ?y = 1932',
    'jan HAS birthplace: Kraków',
    'me PARENT-OF ?child',
    '  none'
  ].join('\n'))
  assert.deepEqual(problems, [])
  assert.equal(queries.length, 4)
  assert.deepEqual(queries[0], {
    pattern: '?a PARENT-OF+ me',
    expect: { kind: 'solutions', solutions: [{ a: 'anna' }, { a: 'maria' }] },
    line: 2
  })
  assert.equal(queries[1]!.pattern, 'jan HAS birth-year: ?y\nWHERE conf >= 0.6')
  assert.deepEqual(queries[2]!.expect, { kind: 'some' })
  assert.deepEqual(queries[3]!.expect, { kind: 'none' })
})

test('parse: multi-variable solution lines split on ?var =', () => {
  const { queries, problems } = Queries.parseQueries('?x HAS bug: ?bug\n  ?x = auth/middleware ?bug = token-expiry')
  assert.deepEqual(problems, [])
  assert.deepEqual(queries[0]!.expect, {
    kind: 'solutions',
    solutions: [{ x: 'auth/middleware', bug: 'token-expiry' }]
  })
})

test('parse problems: orphan expectations, conflicting none, junk lines', () => {
  const { problems } = Queries.parseQueries([
    '  ?x = orphan',
    'WHERE conf >= 0.5',
    'a IS ?x',
    '  none',
    '  ?x = b',
    'b IS ?y',
    '  what is this'
  ].join('\n'))
  assert.equal(problems.length, 4)
  assert.match(problems[0]!, /expectation without a pattern/)
  assert.match(problems[1]!, /WHERE without a pattern/)
  assert.match(problems[2]!, /'none' conflicts/)
  assert.match(problems[3]!, /expected '\?var = value'/)
})

const seeded = (): ReturnType<typeof open> => {
  const store = open()
  store.ingest([
    'PARENT-OF IS verb',
    'PARENT-OF REVERSE CHILD-OF',
    'maria PARENT-OF anna',
    'anna PARENT-OF me',
    'jan HAS birth-year: 1932 @src:maria @ 70%',
    'jan HAS birth-year: 1931 @src:cousin @ 40%'
  ].join('\n'))
  return store
}

const check = (store: ReturnType<typeof open>, text: string): Queries.Outcome[] => {
  const { queries, problems } = Queries.parseQueries(text)
  assert.deepEqual(problems, [])
  return queries.map(q => Queries.checkQuery(store, q))
}

test('check: exact solution sets pass; missing and unexpected both fail', () => {
  const store = seeded()
  const [exact] = check(store, '?a PARENT-OF+ me\n  ?a = anna\n  ?a = maria')
  assert.equal(exact!.pass, true)
  assert.equal(exact!.matches, 2)

  const [missing] = check(store, '?a PARENT-OF+ me\n  ?a = anna\n  ?a = maria\n  ?a = ghost')
  assert.equal(missing!.pass, false)
  assert.deepEqual(missing!.missing, [{ a: 'ghost' }])
  assert.deepEqual(missing!.unexpected, [])

  const [unexpected] = check(store, '?a PARENT-OF+ me\n  ?a = anna')
  assert.equal(unexpected!.pass, false)
  assert.deepEqual(unexpected!.unexpected, [{ a: 'maria' }], 'an invented solution is as wrong as a lost one')
  store.close()
})

test('check: WHERE filters, inverse reads, none and bare expectations', () => {
  const store = seeded()
  const outcomes = check(store, [
    'jan HAS birth-year: ?y',
    '  WHERE conf >= 0.6',
    '  ?y = 1932',
    '?child CHILD-OF anna',
    '  ?child = me',
    'maria PARENT-OF anna',
    'me PARENT-OF ?x',
    '  none'
  ].join('\n'))
  assert.deepEqual(outcomes.map(outcome => outcome.pass), [true, true, true, true])
  const [failsNone] = check(store, 'anna PARENT-OF ?x\n  none')
  assert.equal(failsNone!.pass, false)
  assert.deepEqual(failsNone!.unexpected, [{ x: 'me' }])
  const [failsSome] = check(store, 'ghost PARENT-OF ?x')
  assert.equal(failsSome!.pass, false)
  store.close()
})

test('check: an uncompilable pattern reports its error instead of throwing', () => {
  const store = seeded()
  const [outcome] = check(store, 'not a pattern at all !!')
  assert.equal(outcome!.pass, false)
  assert.ok(outcome!.error !== undefined)
  store.close()
})

test('formatSolution renders like cave query output', () => {
  assert.equal(Queries.formatSolution({ a: 'anna', b: 'x y' }), '?a = anna  ?b = x y')
  assert.equal(Queries.formatSolution({}), '(match)')
})
