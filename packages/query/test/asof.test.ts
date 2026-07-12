import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Uuidv7 } from '@cavelang/core'
import { open, type Store } from '@cavelang/store'
import { query } from '@cavelang/query'

/** tx of the newest row about an entity — the boundary "just after this append". */
const lastTx = (store: Store, entity: string): string =>
  store.claimsAbout(entity)[0]!.tx

test('asOf reconstructs current belief at a past tx (spec §12.3)', () => {
  const store = open()
  store.ingest('anthropic HAS ipo-timing: 2026-H2 @ 40%')
  const before = lastTx(store, 'anthropic')
  store.ingest('anthropic HAS ipo-timing: 2026-H2 @ 65%')
  const now = query(store, 'anthropic HAS ipo-timing: ?t')
  assert.equal(now.length, 1)
  assert.equal(now[0]!.row?.conf, 0.65)
  const then = query(store, 'anthropic HAS ipo-timing: ?t', { asOf: before })
  assert.equal(then.length, 1)
  assert.equal(then[0]!.row?.conf, 0.4, 'the belief as it stood at the boundary')
  assert.equal(
    query(store, 'anthropic HAS ipo-timing: ?t', { asOf: before.toUpperCase() })[0]!.row?.conf,
    0.4,
    'boundary ids are case-insensitive'
  )
  store.close()
})

test('a claim retracted later is still believed at the boundary (spec §9.3, §12.3)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60%')
  const before = lastTx(store, 'server')
  store.ingest('server IS compromised @ 0% ; clean forensic scan')
  assert.equal(query(store, 'server IS compromised').length, 0, 'retracted → no current support')
  const then = query(store, 'server IS compromised', { asOf: before })
  assert.equal(then.length, 1)
  assert.equal(then[0]!.row?.conf, 0.6)
  store.close()
})

test('a claim first recorded after the boundary is unknown (spec §12.3)', () => {
  const store = open()
  store.ingest('seed IS marker')
  const before = lastTx(store, 'seed')
  store.ingest('billing USES jwt')
  assert.equal(query(store, '?x USES jwt').length, 1)
  assert.equal(query(store, '?x USES jwt', { asOf: before }).length, 0)
  store.close()
})

test('date and timestamp boundaries are inclusive intervals (spec §12.2, §12.3)', () => {
  const store = open()
  store.ingest('a USES jwt')
  const ms = Uuidv7.msOf(lastTx(store, 'a'))
  const day = new Date(ms).toISOString().slice(0, 10)
  const second = `${new Date(ms).toISOString().slice(0, 19)}Z`
  assert.equal(query(store, '?x USES jwt', { asOf: day }).length, 1, 'the named day is included')
  assert.equal(query(store, '?x USES jwt', { asOf: second }).length, 1, 'the named second is included')
  assert.equal(query(store, '?x USES jwt', { asOf: '2000-01-01' }).length, 0, 'nothing was believed then')
  store.close()
})

test('all composes: full history up to the boundary (spec §12.3)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60%')
  const before = lastTx(store, 'server')
  store.ingest('server IS compromised @ 90%')
  assert.equal(query(store, 'server IS compromised', { all: true }).length, 2)
  assert.equal(query(store, 'server IS compromised', { all: true, asOf: before }).length, 1)
  store.close()
})

test('asOf does not use inverse declarations recorded after the boundary (spec §12.3)', () => {
  const store = open()
  store.ingest('LEADS IS verb\nteam LEADS project')
  const before = lastTx(store, 'team')
  store.ingest('LEADS REVERSE LED-BY')
  assert.equal(query(store, 'project LED-BY team').length, 1, 'the inverse is available now')
  assert.equal(
    query(store, 'project LED-BY team', { asOf: before }).length,
    0,
    'the inverse vocabulary did not exist at the boundary'
  )
  store.close()
})

test('the alias closure reconstructs entity resolution as believed then (spec §12.3, §13.6)', () => {
  const store = open()
  store.ingest('billing USES postgres\nanalytics USES postgresql')
  const before = lastTx(store, 'analytics')
  store.ingest('postgres ALIAS postgresql')
  const widened = query(store, '?x USES postgres', { aliases: true })
  assert.deepEqual(widened.map(match => match.bindings['x']), ['billing', 'analytics'])
  const then = query(store, '?x USES postgres', { aliases: true, asOf: before })
  assert.deepEqual(then.map(match => match.bindings['x']), ['billing'], 'the merge had not happened yet')
  store.close()
})

test('transitive hops walk as-of edges (spec §12.3)', () => {
  const store = open()
  store.ingest('terrier EXTENDS dog')
  const before = lastTx(store, 'terrier')
  store.ingest('dog EXTENDS mammal')
  assert.equal(query(store, 'terrier EXTENDS+ mammal').length, 1)
  assert.equal(query(store, 'terrier EXTENDS+ mammal', { asOf: before }).length, 0)
  assert.equal(query(store, 'terrier EXTENDS+ dog', { asOf: before }).length, 1)
  store.close()
})

test('an unparseable boundary is rejected', () => {
  const store = open()
  store.ingest('a USES jwt')
  assert.throws(() => query(store, '?x USES jwt', { asOf: 'yesterday' }), /as-of boundary/)
  store.close()
})
