import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { page, query, queryRecords, Select } from '@cavelang/query'

const fixture = (): Store => {
  const store = open()
  store.ingest([
    'billing USES jwt',
    'auth USES jwt',
    'search USES elastic',
    'billing HAS owner: ana',
    'auth HAS owner: bo',
    'ana HAS team: platform',
    'billing HAS age: 12',
    'auth HAS age: 30',
    'search HAS age: 9',
  ].join('\n'))
  return store
}

const bindings = (store: Store, input: string, options = {}): Record<string, string>[] =>
  query(store, input, options).map(match => ({ ...match.bindings }))

test('premises join left to right and carry every premise row as evidence (spec §12.4)', () => {
  const store = fixture()
  try {
    const matches = query(store, '?svc USES jwt, ?svc HAS owner: ?who')
    assert.deepEqual(matches.map(match => match.bindings), [
      { svc: 'billing', who: 'ana' },
      { svc: 'auth', who: 'bo' },
    ])
    assert.equal(matches[0]!.row, undefined, 'a solution has no single claim')
    assert.deepEqual(matches[0]!.rows!.map(row => row.raw_line), ['billing USES jwt', 'billing HAS owner: ana'])
    // Further lines and a trailing comma conjoin too.
    assert.deepEqual(bindings(store, '?svc USES jwt,\n  ?svc HAS owner: ?who'), bindings(store, '?svc USES jwt\n?svc HAS owner: ?who'))
    assert.deepEqual(bindings(store, '?svc USES jwt, ?svc HAS age: ?a, ?a < 20'), [{ svc: 'billing', a: '12' }])
  } finally { store.close() }
})

test('single-pattern queries keep their original parse and row shape', () => {
  const store = fixture()
  try {
    assert.equal(Select.parseQuery('?svc USES jwt\n  WHERE conf >= 0.5').kind, 'pattern')
    const [first] = query(store, '?svc USES jwt\n  WHERE conf >= 0.5')
    assert.equal(first!.row?.raw_line, 'billing USES jwt')
    assert.equal(first!.rows, undefined)
    // A comma inside one token is still part of an object term.
    assert.equal(Select.parseQuery('?svc USES a,b').kind, 'pattern')
    assert.throws(() => query(store, '?x USES jwt ?y'), /cannot parse payload/, 'single-pattern diagnostics are kept')
  } finally { store.close() }
})

test('OPTIONAL keeps unextended solutions with the group unbound, all or nothing (spec §12.4)', () => {
  const store = fixture()
  try {
    assert.deepEqual(bindings(store, '?svc USES jwt\nOPTIONAL ?svc HAS owner: ?who, ?who HAS team: ?team'), [
      { svc: 'billing', who: 'ana', team: 'platform' },
      { svc: 'auth' },
    ], 'bo has no team, so auth keeps neither ?who nor ?team')
    const [, auth] = query(store, '?svc USES jwt\nOPTIONAL ?svc HAS owner: ?who')
    assert.deepEqual(auth!.rows!.map(row => row.raw_line), ['auth USES jwt', 'auth HAS owner: bo'])
    // A constraint on an unbound optional variable fails, never passes.
    assert.deepEqual(bindings(store, '?svc USES ?lib\nOPTIONAL ?svc HAS owner: ?who\n?who != nobody'), [
      { svc: 'billing', lib: 'jwt', who: 'ana' },
      { svc: 'auth', lib: 'jwt', who: 'bo' },
    ])
  } finally { store.close() }
})

test('SELECT projects and DISTINCT collapses solutions, unioning their evidence (spec §12.4)', () => {
  const store = fixture()
  try {
    assert.deepEqual(bindings(store, '?svc USES ?lib, ?svc HAS age: ?a\nSELECT ?lib'),
      [{ lib: 'jwt' }, { lib: 'jwt' }, { lib: 'elastic' }])
    const distinct = query(store, '?svc USES ?lib, ?svc HAS age: ?a\nSELECT DISTINCT ?lib')
    assert.deepEqual(distinct.map(match => match.bindings), [{ lib: 'jwt' }, { lib: 'elastic' }])
    assert.equal(distinct[0]!.rows!.length, 4, 'both jwt solutions stand behind the collapsed answer')
    assert.deepEqual(bindings(store, '?svc USES jwt\nSELECT *'), bindings(store, '?svc USES jwt, ?svc ?v ?o\nSELECT DISTINCT ?svc'))
  } finally { store.close() }
})

test('ORDER BY compares numbers numerically, text by code point, unbound last (spec §12.4)', () => {
  const store = fixture()
  try {
    assert.deepEqual(bindings(store, '?svc HAS age: ?a\nORDER BY ?a').map(entry => entry['a']), ['9', '12', '30'])
    assert.deepEqual(bindings(store, '?svc HAS age: ?a\nORDER BY ?a DESC').map(entry => entry['a']), ['30', '12', '9'])
    for (const direction of ['', ' DESC']) {
      assert.deepEqual(
        bindings(store, `?svc HAS age: ?a\nOPTIONAL ?svc HAS owner: ?who\nORDER BY ?who${direction}, ?svc`).map(entry => entry['svc']),
        direction === '' ? ['billing', 'auth', 'search'] : ['auth', 'billing', 'search'])
    }
  } finally { store.close() }
})

test('WHERE filters the single pattern on the line above it (spec §12.4)', () => {
  const store = fixture()
  store.ingest('legacy USES jwt @ 40%\nlegacy HAS owner: cy')
  try {
    assert.deepEqual(bindings(store, '?svc USES jwt\n  WHERE conf >= 0.5\n?svc HAS owner: ?who').map(entry => entry['svc']),
      ['billing', 'auth'])
    assert.throws(() => query(store, '?svc USES jwt, ?svc HAS owner: ?who\n  WHERE conf >= 0.5'),
      /CAVE-Q line 2: WHERE needs exactly one pattern/)
    assert.throws(() => query(store, '?svc USES jwt\nSELECT ?svc\nWHERE conf >= 0.5'), /CAVE-Q line 3: WHERE filters the pattern/)
    assert.throws(() => query(store, '?svc USES jwt\n?svc HAS owner: ?w\n  WHERE colour = red'), /CAVE-Q line 3: unknown filter field/)
  } finally { store.close() }
})

test('conjunctive queries validate independently of rows (spec §12.1)', () => {
  const empty = open()
  try {
    const cases: [string, object, RegExp][] = [
      ['?svc USES jwt, ?svc NEEDS+ ?dep', { at: '2026-01-01' }, /at does not compose with transitive/],
      ['?svc USES jwt, ?svc PART-OF owner: ?o', {}, /inverse verb PART-OF cannot take an attribute pattern/],
      ['?svc USES jwt\nSELECT ?nope', {}, /\?nope is not bound/],
      ['?a < 3, ?svc HAS age: ?a', {}, /before any pattern premise binds it/],
      ['?svc USES jwt\nOPTIONAL ?a < 3', {}, /before any pattern premise binds it/],
      ['?svc USES jwt\nORDER BY DESC', {}, /DESC follows/],
      ['?svc USES jwt\nSELECT ?svc\nSELECT ?svc', {}, /at most one SELECT/],
      ['?svc USES jwt, ?svc USES ?x', { limit: 0 }, /limit must be/],
    ]
    for (const [input, options, message] of cases) {
      assert.throws(() => query(empty, input, options), message, input)
      assert.throws(() => page(empty, input, options), message, input)
    }
  } finally { empty.close() }
})

test('options apply to every premise: as-of, aliases and windows (spec §12.3, §13.6)', () => {
  const store = fixture()
  try {
    const before = query(store, 'search HAS age: ?a')[0]!.row!.tx
    store.ingest('billing HAS owner: ana @ 0%\npg ALIAS postgres\nbilling USES postgres\npostgres HAS license: permissive')
    assert.deepEqual(bindings(store, '?svc USES jwt, ?svc HAS owner: ?who'), [{ svc: 'auth', who: 'bo' }])
    assert.deepEqual(bindings(store, '?svc USES jwt, ?svc HAS owner: ?who', { asOf: before })
      .map(entry => entry['svc']).sort(), ['auth', 'billing'])
    assert.deepEqual(bindings(store, 'billing USES ?db, pg HAS license: ?l'), [])
    assert.deepEqual(bindings(store, '?svc USES ?db, ?db HAS license: ?l', { aliases: true }),
      [{ svc: 'billing', db: 'postgres', l: 'permissive' }])
    assert.deepEqual(bindings(store, '?svc HAS age: ?a\nORDER BY ?a', { limit: 1, offset: 1 }), [{ svc: 'billing', a: '12' }])
  } finally { store.close() }
})

test('records and pages expose conjunctive evidence as support', () => {
  const store = fixture()
  try {
    const [record] = queryRecords(store, '?svc USES jwt, ?svc HAS owner: ?who')
    assert.deepEqual(record!.support!.map(claim => claim.claim.raw), ['billing USES jwt', 'billing HAS owner: ana'])
    const input = '?svc HAS age: ?a\nORDER BY ?a DESC'
    const first = page(store, input, { limit: 2 })
    assert.deepEqual(first.matches.map(match => match.bindings['a']), ['30', '12'])
    const second = page(store, input, { limit: 2, cursor: first.next! })
    assert.deepEqual(second.matches.map(match => match.bindings['a']), ['9'])
    assert.equal(second.next, undefined)
  } finally { store.close() }
})

test('variable names that shadow prototype members survive joins and projection', () => {
  const store = fixture()
  try {
    const [match] = query(store, 'billing USES ?__proto__, billing HAS owner: ?constructor\nSELECT ?__proto__ ?constructor')
    assert.deepEqual(Object.entries(match!.bindings), [['__proto__', 'jwt'], ['constructor', 'ana']])
  } finally { store.close() }
})

test('interpolated value bindings join after valid-time evaluation (spec §32.4)', () => {
  const store = open()
  try {
    store.ingest('acme HAS headcount: 100 -> 400 @2025..2027\nglobex HAS headcount: 250')
    const at = { at: '2026' }
    assert.deepEqual(query(store, 'acme HAS headcount: ?n', at).map(match => match.bindings['n']), ['250'])
    assert.deepEqual(query(store, 'acme HAS headcount: ?n, acme HAS headcount: ?n', at).map(match => match.bindings), [{ n: '250' }])
    assert.deepEqual(query(store, 'acme HAS headcount: ?n, ?peer HAS headcount: ?n\nSELECT ?peer\nORDER BY ?peer', at)
      .map(match => match.bindings['peer']), ['acme', 'globex'], 'an evaluated value joins a stored scalar too')
    assert.deepEqual(query(store, 'acme HAS headcount: ?n, ?peer HAS headcount: ?n', { at: '2025' })
      .map(match => match.bindings['peer']), ['acme'])
  } finally { store.close() }
})

test('equal normalized numbers tie in ORDER BY whatever their spelling', () => {
  const store = open()
  try {
    store.ingest('a HAS score: 1000\nb HAS score: 1K\nc HAS score: 999')
    assert.deepEqual(query(store, '?s HAS score: ?n\nORDER BY ?n, ?s DESC').map(match => match.bindings['s']), ['c', 'b', 'a'])
    assert.deepEqual(query(store, '?s HAS score: ?n\nORDER BY ?n').map(match => match.bindings['s']), ['c', 'a', 'b'],
      'ties keep join order')
  } finally { store.close() }
})
