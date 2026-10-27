import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { page, Pattern, query } from '@cavelang/query'

const fixture = (): Store => {
  const store = open()
  store.ingest([
    'billing USES jwt',
    'billing NEEDS postgres',
    'postgres NEEDS disk',
    'auth USES redis',
    'monorepo CONTAINS billing',
    'billing CONTAINS api',
  ].join('\n'))
  return store
}

const values = (store: Store, input: string, name: string, options = {}): string[] =>
  query(store, input, options).map(match => match.bindings[name]!)

test('path verbs parse to path slots; VERB+ keeps its verb shape (spec §12.1)', () => {
  assert.deepEqual(Pattern.parse('a NEEDS+ ?b').verb, { kind: 'verb', name: 'NEEDS', transitive: true })
  assert.deepEqual(Pattern.parse('a NEEDS* ?b').verb, { kind: 'path', verbs: ['NEEDS'], repeat: 'star' })
  assert.deepEqual(Pattern.parse('a (USES|NEEDS) ?b').verb, { kind: 'path', verbs: ['USES', 'NEEDS'], repeat: 'one' })
  assert.deepEqual(Pattern.parse('a (USES|NEEDS)+ ?b').verb, { kind: 'path', verbs: ['USES', 'NEEDS'], repeat: 'plus' })
  assert.throws(() => Pattern.parse('a (USES) ?b'), /two or more verbs/)
  assert.throws(() => Pattern.parse('a (USES|needs)* ?b'), /two or more verbs/)
})

test('VERB* adds zero-hop pairs to the transitive closure (spec §12.1)', () => {
  const store = fixture()
  try {
    assert.deepEqual(values(store, 'billing NEEDS* ?x', 'x'), ['billing', 'disk', 'postgres'])
    assert.deepEqual(values(store, '?x NEEDS* disk', 'x'), ['billing', 'disk', 'postgres'])
    assert.deepEqual(values(store, '?x NEEDS* ?x', 'x'), ['billing', 'disk', 'postgres'],
      'unseeded identity covers every endpoint of a traversed edge')
    assert.equal(query(store, 'unknown NEEDS* unknown').length, 1, 'a concrete endpoint always reaches itself')
    assert.equal(query(store, 'disk NEEDS* billing').length, 0)
    assert.equal(query(store, '?a NEEDS* ?b').length, 6)
  } finally { store.close() }
})

test('alternations walk every member, inverse members backwards (spec §12.1)', () => {
  const store = fixture()
  try {
    assert.deepEqual(values(store, 'billing (USES|NEEDS)+ ?x', 'x'), ['disk', 'jwt', 'postgres'])
    assert.deepEqual(values(store, '?x (USES|NEEDS)+ disk', 'x'), ['billing', 'postgres'])
    assert.deepEqual(values(store, 'api (PART-OF|NEEDS)+ ?x', 'x'), ['billing', 'monorepo', 'postgres', 'disk'].sort())
    assert.deepEqual(values(store, 'api (CONTAINS|PART-OF)* ?x', 'x'), ['api', 'billing', 'monorepo'],
      'a verb and its inverse make the walk undirected')
  } finally { store.close() }
})

test('one-hop alternations return member rows in transaction order, once each', () => {
  const store = fixture()
  try {
    const matches = query(store, 'billing (USES|NEEDS|USED-BY) ?x')
    assert.deepEqual(matches.map(match => match.row?.raw_line), ['billing USES jwt', 'billing NEEDS postgres'])
    assert.deepEqual(values(store, '?x (CONTAINS|PART-OF) billing', 'x'), ['monorepo', 'api'],
      'each member keeps its own inverse resolution')
    store.ingest('billing USES legacy @ 30%')
    assert.deepEqual(values(store, 'billing (USES|NEEDS) ?x\n  WHERE conf >= 0.5', 'x'), ['jwt', 'postgres'],
      'filters apply to every member')
    assert.deepEqual(values(store, 'billing (USES|NEEDS) ?x', 'x', { limit: 1, offset: 1 }), ['postgres'])
    const first = page(store, 'billing (USES|NEEDS) ?x', { limit: 2 })
    const second = page(store, 'billing (USES|NEEDS) ?x', { limit: 2, cursor: first.next! })
    assert.deepEqual([...first.matches, ...second.matches].map(match => match.bindings['x']), ['jwt', 'postgres', 'legacy'])
  } finally { store.close() }
})

test('repeated paths keep transitive restrictions and support semantics', () => {
  const store = fixture()
  try {
    assert.throws(() => query(store, 'billing NEEDS* ?x #core'), /transitive patterns support subject\/object slots only/)
    assert.throws(() => query(store, 'billing (USES|NEEDS)+ ?x', { at: '2026' }), /at does not compose with transitive/)
    const [chain] = query(store, 'billing NEEDS* disk', { support: true })
    assert.deepEqual(chain!.rows!.map(row => row.raw_line).sort(), ['billing NEEDS postgres', 'postgres NEEDS disk'])
    const [self] = query(store, 'billing NEEDS* billing', { support: true })
    assert.deepEqual(self!.rows, [], 'a zero-hop match stands on no edge')
  } finally { store.close() }
})

test('paths compose with conjunctive queries and carry support there (spec §12.4)', () => {
  const store = fixture()
  try {
    const matches = query(store, '?svc USES jwt, ?svc NEEDS+ ?dep\nORDER BY ?dep', { support: true })
    assert.deepEqual(matches.map(match => match.bindings['dep']), ['disk', 'postgres'])
    assert.ok(matches[0]!.rows!.some(row => row.raw_line === 'postgres NEEDS disk'))
  } finally { store.close() }
})
