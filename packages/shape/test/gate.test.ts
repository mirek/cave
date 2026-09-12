import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry } from '@cavelang/canonical'
import { open, type Store } from '@cavelang/store'
import { evaluate, gatedIngest } from '@cavelang/shape'

test('the gate rolls back newly introduced malformed shape declarations', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    assert.throws(() => gatedIngest(store, 'service EXPECTS owner #cardinality:many\napi HAS owner: team'), /invalid shape declaration/)
    assert.equal(store.currentBeliefs().length, 1)
    assert.equal(store.claimsAbout('service').filter(row => row.verb === 'EXPECTS').length, 0)
  } finally { store.close() }
})

test('reactivating a historical expectation gates the batch and rolls back its registry', () => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner\nservice EXPECTS owner @ 0%\napi IS service')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const rejected = gatedIngest(store, 'MIGRATES IS verb\nservice EXPECTS owner', { strict: true })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) {
      assert.equal(rejected.violations.length, 1)
      assert.equal(rejected.violations[0]!.entity, 'api')
      assert.equal(rejected.violations[0]!.expectation.name, 'owner')
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(Registry.isDeclared(store.registry(), 'MIGRATES'), false)
    const accepted = gatedIngest(store, 'MIGRATES IS verb\nservice EXPECTS owner\napi HAS owner: platform', { strict: true })
    assert.equal(accepted.ok, true)
    assert.equal(Registry.isDeclared(store.registry(), 'MIGRATES'), true)
  } finally { store.close() }
})

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

test('a new violation cannot hide behind separators in an existing violation identity', () => {
  const store = open()
  try {
    store.ingest('worker EXPECTS owner\nservice\0worker EXPECTS owner\napi\0service IS worker', { strict: true })
    const before = store.currentBeliefs()
    const outcome = gatedIngest(store, 'api IS service\0worker', { strict: true })
    assert.equal(outcome.ok, false)
    if (!outcome.ok) {
      assert.equal(outcome.violations.length, 1)
      assert.equal(outcome.violations[0]!.entity, 'api')
      assert.equal(outcome.violations[0]!.expectation.type, 'service\0worker')
    }
    assert.deepEqual(store.currentBeliefs(), before, 'the rejected append leaves no belief behind')
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get()!.n, before.length,
      'the rejected append leaves no historical row behind')
  } finally {
    store.close()
  }
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
  assert.equal(queries, 10, 'one declaration probe and four-query snapshot before and after the append')
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

test('the gate rejects incomplete instances beyond 32 taxonomy hops', () => {
  const store = open()
  try {
    store.ingest([
      'type-0 EXPECTS owner',
      ...Array.from({ length: 40 }, (_, index) => `type-${index + 1} EXTENDS type-${index}`)
    ].join('\n'))
    const outcome = gatedIngest(store, 'api IS type-40')
    assert.equal(outcome.ok, false)
    assert.equal(store.claimsAbout('api').length, 0, 'deep instance append is rolled back')
    assert.equal(gatedIngest(store, 'api IS type-40\napi HAS owner: platform').ok, true)
  } finally { store.close() }
})

test('the gate baselines violations after reserving against concurrent repairs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-shape-race-'))
  const path = join(dir, 'knowledge.db')
  const store = open(path)
  const peer = open(path)
  try {
    store.ingest('service EXPECTS owner\napi IS service')
    let crossed = false
    const intercepted = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return <T>(body: () => T): T => {
          if (!crossed) {
            crossed = true
            peer.ingest('api HAS owner: platform')
          }
          return target.transaction(body)
        }
      }
    })
    const outcome = gatedIngest(intercepted, 'api HAS owner: platform @ 0%')
    assert.equal(crossed, true)
    assert.equal(outcome.ok, false, 'reintroducing a repaired violation must be rejected')
    assert.equal(store.claimsAbout('api').filter(row => row.attribute === 'owner').length, 1,
      'the concurrent repair survives without a retraction append')
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejected gates discard inverse vocabulary used by evaluation and allow corrected retry', () => {
  const store = open()
  try {
    store.ingest('HOSTS IS verb\nservice EXPECTS HOSTED-BY\napi IS service\nhost HOSTS api')
    const baseline = evaluate(store)
    assert.equal(baseline.violations.length, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const patch = 'HOSTS REVERSE HOSTED-BY\nservice EXPECTS owner'
    const rejected = gatedIngest(store, patch, { strict: true })
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.deepEqual(rejected.violations.map(value => value.expectation.name), ['owner'])
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.deepEqual(evaluate(store), baseline)
    const accepted = gatedIngest(store, `${patch}\napi HAS owner: team`, { strict: true })
    assert.equal(accepted.ok, true)
    assert.deepEqual(evaluate(store).violations, [])
    assert.equal(evaluate(store).checks, 2)
  } finally { store.close() }
})

for (const nested of [false, true]) test(`gate rollback failures retain rejection and recover through owner cleanup (nested=${nested})`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-gate-rollback-failure-'))
  const path = join(dir, 'knowledge.db')
  let store = open(path)
  try {
    store.ingest('service EXPECTS owner')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const cleanup = new Error('rollback transport failed')
    const outer = new Error('caller rollback')
    const exec = store.db.exec.bind(store.db)
    let failures = 0
    const mocked = t.mock.method(store.db, 'exec', (sql: string) => {
      if (failures === 0 && sql === (nested ? 'ROLLBACK TO cave_tx_1' : 'ROLLBACK')) {
        failures++
        throw cleanup
      }
      exec(sql)
    })
    const reject = () => {
      assert.throws(() => gatedIngest(store, 'MIGRATES IS verb\napi IS service', { strict: true }), error => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors.length, 2)
        assert.equal(error.cause, error.errors[0])
        assert.match(error.errors[0].message, /shape gate: 1 new violation/)
        assert.equal(error.errors[1], cleanup)
        assert.match(error.message, /rollback also failed.*rollback transport failed/)
        return true
      })
      assert.equal(failures, 1)
    }
    if (nested) assert.throws(() => store.transaction(() => { reject(); throw outer }), error => error === outer)
    else reject()
    mocked.mock.restore()
    // Closing discards an unfinished outer transaction; no successful rollback
    // is inferred from the gate's failed cleanup attempt.
    store.close()
    store = open(path)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(Registry.isDeclared(store.registry(), 'MIGRATES'), false)
    assert.equal(gatedIngest(store, 'api IS service\napi HAS owner: team', { strict: true }).ok, true)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
