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

test('parse: expectation lines accept inline comments', () => {
  const { queries, problems } = Queries.parseQueries([
    'a IS ?x',
    '  ?x = b ; expected binding',
    'c IS ?x',
    '  none ; no matches expected',
    'd HAS note: ?note',
    '  ?note = `part;two` ; quoted semicolon belongs to the value'
  ].join('\n'))
  assert.deepEqual(problems, [])
  assert.deepEqual(queries.map(query => query.expect), [
    { kind: 'solutions', solutions: [{ x: 'b' }] },
    { kind: 'none' },
    { kind: 'solutions', solutions: [{ note: '`part;two`' }] }
  ])
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

for (const unreadableMessage of [false, true]) {
  test(`check: an unprintable query failure remains reportable (${unreadableMessage})`, t => {
    const store = seeded()
    try {
      const failure = unreadableMessage ? new Error('query failed') : Object.create(null)
      if (unreadableMessage) {
        Object.defineProperty(failure, 'message', { get() { throw new Error('unreadable message') } })
      }
      const prepare = store.db.prepare.bind(store.db)
      let fail = true
      const mocked = t.mock.method(store.db, 'prepare', (...args: Parameters<typeof prepare>) => {
        if (fail) {
          fail = false
          throw failure
        }
        return prepare(...args)
      })
      const outcomes = check(store, 'maria PARENT-OF anna\nmaria PARENT-OF anna')
      assert.deepEqual(outcomes[0], {
        pattern: 'maria PARENT-OF anna', pass: false, matches: 0,
        missing: [], unexpected: [], error: '[unprintable thrown value]'
      })
      assert.equal(outcomes[1]!.pass, true)
      assert.doesNotThrow(() => JSON.stringify(outcomes))
      mocked.mock.restore()
    } finally {
      store.close()
    }
  })
}


test('expectations preserve prototype-named variables through real queries', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const parsed = Queries.parseQueries(`?${name} IS service\n  ?${name} = api`)
      assert.deepEqual(parsed.problems, [])
      const q = parsed.queries[0]!
      assert.equal(q.expect.kind, 'solutions')
      if (q.expect.kind !== 'solutions') throw new Error('expected solutions')
      const solution = q.expect.solutions[0]!
      assert.ok(Object.hasOwn(solution, name))
      assert.equal(solution[name], 'api')
      assert.equal(Queries.checkQuery(store, q).pass, true)
      const wrong = Queries.parseQueries(`?${name} IS service\n  ?${name} = ghost`)
      assert.equal(Queries.checkQuery(store, wrong.queries[0]!).pass, false)
    }
  } finally {
    store.close()
  }
})

test('duplicate variables in one expectation are fixture errors', () => {
  for (const name of ['x', '__proto__', 'constructor']) {
    const parsed = Queries.parseQueries(`?${name} IS service\n  ?${name} = ghost ?${name} = api`)
    assert.equal(parsed.problems.length, 1)
    assert.match(parsed.problems[0]!, /queries line 2: expected/)
  }
})


test('binding markers inside literal values remain part of the expected value', () => {
  const store = open()
  try {
    for (const delimiter of ['"', '`']) {
      const value = `${delimiter}literal ?note = text; ?other = data${delimiter}`
      store.ingest(`api HAS note: ${value}`)
      const parsed = Queries.parseQueries(`?owner HAS note: ?note\n  ?owner = api ?note = ${value} ; expected`)
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.queries[0]!.expect, {
        kind: 'solutions', solutions: [{ owner: 'api', note: value }]
      })
      assert.equal(Queries.checkQuery(store, parsed.queries[0]!).pass, true)
    }
  } finally {
    store.close()
  }
})


test('tab-separated WHERE clauses remain query filters in fixtures', () => {
  const store = seeded()
  try {
    const source = 'jan HAS birth-year: ?y\n\tWHERE\tconf >= 0.6\n  ?y = 1932'
    const parsed = Queries.parseQueries(source)
    assert.deepEqual(parsed.problems, [])
    assert.equal(parsed.queries.length, 1)
    assert.equal(parsed.queries[0]!.pattern, 'jan HAS birth-year: ?y\nWHERE\tconf >= 0.6')
    assert.equal(Queries.checkQuery(store, parsed.queries[0]!).pass, true)
    assert.match(Queries.parseQueries('WHERE\tconf >= 0.6').problems[0]!, /WHERE without a pattern/)
    const incomplete = Queries.parseQueries('jan HAS birth-year: ?y\n  WHERE')
    assert.deepEqual(incomplete.problems, [])
    assert.equal(Queries.checkQuery(store, incomplete.queries[0]!).pass, false)
    assert.match(Queries.checkQuery(store, incomplete.queries[0]!).error!, /WHERE/)
  } finally { store.close() }
})


test('solution comparison ignores insertion order for distinct Unicode variable names', () => {
  const store = open()
  try {
    store.ingest('api HAS owner: platform')
    const first = '\u00e9', second = 'e\u0301'
    const parsed = Queries.parseQueries(`?${first} HAS owner: ?${second}\n  ?${second} = platform ?${first} = api`)
    assert.deepEqual(parsed.problems, [])
    const result = Queries.checkQuery(store, parsed.queries[0]!)
    assert.equal(result.pass, true, JSON.stringify(result))
    assert.equal(result.matches, 1)
    assert.deepEqual(result.missing, [])
    assert.deepEqual(result.unexpected, [])
  } finally { store.close() }
})
