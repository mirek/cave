import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Registry } from '@cavelang/canonical'
import { open, type Store } from '@cavelang/store'
import { gatedIngest } from '@cavelang/shape'

test('a clean append passes the gate (spec §20.3)', () => {
  const store = open()
  store.ingest('service EXPECTS owner')
  const outcome = gatedIngest(store, 'api IS service\napi HAS owner: platform-team')
  assert.ok(outcome.ok)
  assert.equal(outcome.result.ids.length, 2)
  assert.equal(store.claimsAbout('api').length, 2)
  store.close()
})

test('an append introducing a violation rolls back (spec §20.3)', () => {
  const store = open()
  store.ingest('service EXPECTS owner')
  const outcome = gatedIngest(store, 'api IS service')
  assert.ok(!outcome.ok)
  assert.equal(outcome.violations.length, 1)
  assert.equal(outcome.violations[0]!.entity, 'api')
  assert.equal(outcome.violations[0]!.expectation.name, 'owner')
  assert.equal(store.claimsAbout('api').length, 0, 'nothing appended')
  store.close()
})

test('pre-existing violations never block (spec §20.3)', () => {
  const store = open()
  store.ingest('service EXPECTS owner\nlegacy IS service ; already violating')
  const outcome = gatedIngest(store, 'auth USES jwt')
  assert.ok(outcome.ok)
  assert.equal(store.claimsAbout('auth').length, 1)
  store.close()
})

test('the gate uses two bounded shape snapshots regardless of check count', () => {
  const store = open()
  store.ingest([
    ...Array.from({ length: 10 }, (_, index) => `service EXPECTS field-${index}`),
    ...Array.from({ length: 100 }, (_, index) => `entity/${index} IS service`)
  ].join('\n'))
  const database = store.db
  let queries = 0
  const counted: Store = {
    ...store,
    db: {
      exec: sql => database.exec(sql),
      prepare: sql => {
        queries += 1
        return database.prepare(sql)
      },
      close: () => database.close()
    }
  }
  const outcome = gatedIngest(counted, 'auth USES jwt')
  assert.ok(outcome.ok, 'the append introduces none of the existing 1,000 violations')
  assert.equal(queries, 6, 'one three-query snapshot before and after the append')
  store.close()
})

test('the gate sees expectations the text itself declares (spec §20.3)', () => {
  const store = open()
  const outcome = gatedIngest(store, 'service EXPECTS owner\napi IS service')
  assert.ok(!outcome.ok)
  assert.equal(store.claimsAbout('api').length, 0)
  assert.equal(store.claimsAbout('service').length, 0, 'the declaration rolls back with the batch')
  store.close()
})

test('the gate rejects new cardinality and unit violations', () => {
  const cardinality = open()
  cardinality.ingest('service EXPECTS USES #cardinality:one\napi IS service\napi USES postgres')
  const extra = gatedIngest(cardinality, 'api USES redis')
  assert.equal(extra.ok, false)
  if (!extra.ok) assert.equal(extra.violations[0]!.actualCount, 2)
  assert.equal(cardinality.claimsAbout('api').filter(row => row.verb === 'USES').length, 1, 'extra relation rolled back')
  cardinality.close()

  const units = open()
  units.ingest('service EXPECTS latency #unit:ms\napi IS service\napi HAS latency: 20ms')
  const wrongUnit = gatedIngest(units, 'api HAS latency: 1s')
  assert.equal(wrongUnit.ok, false)
  if (!wrongUnit.ok) assert.deepEqual(wrongUnit.violations[0]!.actualUnits, ['s'])
  assert.equal(units.claimsAbout('api').filter(row => row.attribute === 'latency').length, 1, 'wrong unit rolled back')
  units.close()
})

test('rollback restores in-band registry declarations (spec §20.3)', () => {
  const store = open()
  store.ingest('service EXPECTS owner')
  const outcome = gatedIngest(store, 'MIGRATES IS verb\napi IS service\nlegacy MIGRATES postgres')
  assert.ok(!outcome.ok)
  assert.equal(Registry.isDeclared(store.registry(), 'MIGRATES'), false)
  store.close()
})

test('a violating append can fix itself in the same batch (spec §20.3)', () => {
  const store = open()
  store.ingest('service EXPECTS owner\nservice EXPECTS USES')
  const outcome = gatedIngest(store, [
    'api IS service',
    'api HAS owner: platform-team',
    'api USES postgres'
  ].join('\n'))
  assert.ok(outcome.ok)
  store.close()
})

test('strict parse problems still throw, and roll back (spec §20.3)', () => {
  const store = open()
  assert.throws(() => gatedIngest(store, 'auth USES jwt\n%%%not-a-line%%% USES', { strict: true }))
  assert.equal(store.claimsAbout('auth').length, 0)
  store.close()
})

test('the gate stamps actor provenance like plain ingest (spec §9.5, §20.3)', () => {
  const store = open()
  const outcome = gatedIngest(store, 'auth USES jwt', { source: 'cli' })
  assert.ok(outcome.ok)
  const claim = store.toClaim(store.claimsAbout('auth')[0]!)
  assert.deepEqual(claim.contexts, ['src:cli'])
  store.close()
})
