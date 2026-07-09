import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'

test('resolve returns one winner per contested fact (spec §26.4)', () => {
  const store = open()
  store.ingest('service HAS owner: alice', { source: 'ingest/93a0' })
  store.ingest('service HAS owner: bob', { source: 'cli' })
  store.ingest('service HAS owner: alice', { source: 'ingest/93a0' }) // the re-run
  const plain = query(store, 'service HAS owner: ?who')
  assert.deepEqual(plain.map(match => match.bindings['who']).sort(), ['alice', 'bob'],
    'default read: coexistence stays visible (§9.4)')
  const resolved = query(store, 'service HAS owner: ?who', { resolve: true })
  assert.deepEqual(resolved.map(match => match.bindings['who']), ['bob'],
    'resolved read: the human-tier series wins the ingest re-run')
  store.close()
})

test('a positive pattern is suppressed when the denial wins (spec §26.4)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60% @src:scanner-a\nserver IS NOT compromised @ 90% @src:forensics')
  assert.equal(query(store, 'server IS compromised').length, 1, 'default read matches the positive row')
  assert.equal(query(store, 'server IS compromised', { resolve: true }).length, 0,
    'the overridden assertion is invisible')
  const denial = query(store, 'server IS NOT compromised', { resolve: true })
  assert.equal(denial.length, 1)
  assert.equal(denial[0]!.row?.conf, 0.9)
  store.close()
})

test('resolve is incompatible with all (spec §26.4)', () => {
  const store = open()
  assert.throws(() => query(store, '?x IS ?y', { resolve: true, all: true }), /incompatible with all/)
  store.close()
})

test('resolve composes with asOf — winners and policy at the boundary (spec §26.4, §12.3)', () => {
  const store = open()
  store.ingest('service HAS owner: alice', { source: 'ingest/93a0' })
  const beforeCorrection = store.currentBeliefs().at(-1)!.tx
  store.ingest('service HAS owner: bob', { source: 'cli' })
  const beforePolicy = store.currentBeliefs().at(-1)!.tx
  // Later, a declaration turns the ladder upside down...
  store.ingest('source/cli HAS precedence: 0', { source: 'cli' })
  const resolved = (asOf?: string): string[] =>
    query(store, 'service HAS owner: ?who', { resolve: true, ...asOf === undefined ? {} : { asOf } })
      .map(match => match.bindings['who']!)
  assert.deepEqual(resolved(beforeCorrection), ['alice'], 'only the ingest series existed then')
  assert.deepEqual(resolved(beforePolicy), ['bob'], 'the human correction had just landed')
  assert.deepEqual(resolved(), ['alice'], 'the current policy demotes cli below the ingest tier')
  store.close()
})

test('resolve composes with aliases — the group widens through the closure (spec §26.1)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('postgres HAS version: 14', { source: 'ingest/a' })
  store.ingest('postgresql HAS version: 15', { source: 'cli' })
  const plain = query(store, 'postgres HAS version: ?v', { aliases: true, resolve: false })
  assert.deepEqual(plain.map(match => match.bindings['v']).sort(), ['14', '15'])
  const resolved = query(store, 'postgres HAS version: ?v', { aliases: true, resolve: true })
  assert.deepEqual(resolved.map(match => match.bindings['v']), ['15'],
    'one winner across the aliased series; matching still reaches it through either name')
  store.close()
})

test('transitive hops walk resolved edges only (spec §26.4)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c', { source: 'ingest/x' })
  assert.equal(query(store, 'a NEEDS+ c').length, 1)
  // A human denies the middle edge — stronger than the ingest assertion.
  store.ingest('b NEEDS NOT c @ 95%', { source: 'cli' })
  assert.equal(query(store, 'a NEEDS+ c').length, 1, 'default read still walks the positive row')
  assert.equal(query(store, 'a NEEDS+ c', { resolve: true }).length, 0,
    'the denial wins its group, so the path is gone')
  store.close()
})

test('reliability declarations steer query resolution (spec §26.3)', () => {
  const store = open()
  store.ingest('source/scanner-a HAS reliability: 40%', { source: 'cli' })
  store.ingest('server IS compromised @ 80% @src:scanner-a\nserver IS NOT compromised @ 50% @src:forensics')
  assert.equal(query(store, 'server IS compromised', { resolve: true }).length, 0,
    '0.8 × 0.4 loses to 0.5 — the discounted scanner cannot carry the fact')
  store.close()
})

test('inverse patterns resolve against the same canonical winners (spec §12.1, §26)', () => {
  const store = open()
  store.ingest('CONTAINS REVERSE PART-OF')
  store.ingest('monorepo CONTAINS packages/api @ 60%', { source: 'ingest/a' })
  store.ingest('monorepo CONTAINS NOT packages/api @ 90%', { source: 'cli' })
  assert.equal(query(store, 'packages/api PART-OF monorepo').length, 1)
  assert.equal(query(store, 'packages/api PART-OF monorepo', { resolve: true }).length, 0,
    'the inverse reading resolves over the same stored group')
  store.close()
})
