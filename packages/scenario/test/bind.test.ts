import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { bind, explanationContext, Model, run, ScenarioInputError } from '@cavelang/scenario'
import { open, type Store } from '@cavelang/store'

const modelDigest = `sha256:${'0'.repeat(64)}`

const policies = (overrides: Partial<Model.Policies> = {}): Model.Policies => ({
  missing: 'reject',
  contested: 'reject',
  retracted: 'exclude',
  unresolved: 'reject',
  ...overrides
})

const snapshot: Model.Snapshot = {
  aliases: 'exact',
  resolution: 'coexisting',
  minimumConfidence: 0.5
}

const baseDefinition = (overrides: Partial<Model.Definition> = {}): Model.Definition => ({
  id: 'architecture-choice',
  modelDigest,
  snapshot,
  bindings: [],
  ...overrides
})

const assertNoOverlay = (store: Store): void => {
  assert.equal(store.byContext('src:scenario/architecture-choice').length, 0)
  assert.equal(store.claimsAbout('system').length, 1)
}

test('scenario values override base beliefs and the overlay is rolled back', () => {
  const store = open()
  store.ingest('system HAS team-size: 8 people @ 90%')
  const record = bind(store, baseDefinition({
    overlay: 'MIGRATES IS verb\nsystem HAS team-size: 0.012K people\nsystem MIGRATES postgres',
    bindings: [
      {
        id: 'team-size',
        query: 'system HAS team-size: ?n',
        select: 'n',
        expected: { kind: 'integer', unit: 'people' },
        cardinality: 'one',
        scenarioOverride: true,
        policies: policies()
      },
      {
        id: 'migration',
        query: 'system MIGRATES postgres',
        expected: { kind: 'boolean' },
        cardinality: 'one',
        scenarioOverride: true,
        policies: policies()
      }
    ]
  }))

  assert.deepEqual(record.values['team-size'], {
    kind: 'integer', value: '12', unit: 'people', authored: '0.012K people', approximate: false
  })
  assert.equal(record.bindings[0]!.candidates[0]!.evidence[0]!.origin, 'scenario')
  assert.deepEqual(record.supportingRowIds, [])
  assert.deepEqual(record.values['migration'], { kind: 'boolean', value: true })
  assert.equal(record.scenarioClaimIds.length, 2)
  assert.equal(record.snapshot.transactionTime, store.currentBeliefs()[0]!.tx)
  assert.equal(store.registry().declared.has('MIGRATES'), false)
  assertNoOverlay(store)
  store.close()
})

test('an omitted as-of freezes the head and an explicit boundary replays the older belief', () => {
  const store = open()
  store.ingest('system HAS team-size: 8 people')
  const before = store.currentBeliefs()[0]!.tx
  store.ingest('system HAS team-size: 10 people')
  const record = bind(store, baseDefinition({
    snapshot: { ...snapshot, asOf: before },
    bindings: [{
      id: 'team-size', query: 'system HAS team-size: ?n', select: 'n', expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }]
  }))
  assert.deepEqual(record.values['team-size'], {
    kind: 'integer', value: '8', unit: 'people', authored: '8 people', approximate: false
  })
  assert.equal(record.snapshot.transactionTime, before)
  assert.deepEqual(record.supportingRowIds, [before])
  store.close()
})

test('exact conversions are opt-in and uncertainty remains separate from confidence', () => {
  const store = open()
  store.ingest('job HAS timeout: ~1.25 s +/- 0.05 s @ 80%')
  const record = bind(store, baseDefinition({
    bindings: [{
      id: 'timeout',
      query: 'job HAS timeout: ?value',
      select: 'value',
      expected: {
        kind: 'number',
        unit: 'ms',
        conversions: [{ from: 's', to: 'ms', factor: '1000' }]
      },
      cardinality: 'one',
      scenarioOverride: false,
      policies: policies()
    }]
  }))

  assert.deepEqual(record.values['timeout'], {
    kind: 'number',
    value: { numerator: '1250', denominator: '1' },
    unit: 'ms',
    authored: '~1.25 s',
    approximate: true,
    uncertainty: {
      authored: '0.05 s', exact: { numerator: '50', denominator: '1' }, unit: 'ms', sigmaLevel: 2
    }
  })
  assert.equal(record.bindings[0]!.candidates[0]!.confidence, 0.8)
  store.close()
})

test('many bindings require an explicit reducer and sum exactly', () => {
  const store = open()
  store.ingest('api HAS replicas: 2 nodes\nworker HAS replicas: 3 nodes')
  const record = bind(store, baseDefinition({
    bindings: [{
      id: 'replicas',
      query: '?service HAS replicas: ?count',
      select: 'count',
      expected: { kind: 'integer', unit: 'nodes' },
      cardinality: 'many',
      reduce: 'sum',
      scenarioOverride: false,
      policies: policies({ missing: 'empty' })
    }]
  }))
  assert.deepEqual(record.values['replicas'], {
    kind: 'integer', value: '5', unit: 'nodes', approximate: false
  })
  assert.equal(record.supportingRowIds.length, 2)

  const empty = bind(store, baseDefinition({
    bindings: [{
      id: 'missing-replicas',
      query: '?service HAS missing-replicas: ?count',
      select: 'count',
      expected: { kind: 'integer', unit: 'nodes' },
      cardinality: 'many',
      reduce: 'min',
      scenarioOverride: false,
      policies: policies({ missing: 'empty' })
    }]
  }))
  assert.deepEqual(empty.values['missing-replicas'], [])
  store.close()
})

test('ambiguous, contested, and incompatible inputs have binding diagnostics', () => {
  const ambiguous = open()
  ambiguous.ingest('api HAS owner: team-a\nworker HAS owner: team-b')
  assert.throws(() => bind(ambiguous, baseDefinition({
    bindings: [{
      id: 'owner', query: '?service HAS owner: ?owner', select: 'owner', expected: { kind: 'text' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }]
  })), (error: unknown) => error instanceof ScenarioInputError && error.code === 'ambiguous-input' && /owner/.test(error.message))
  ambiguous.close()

  const contested = open()
  contested.ingest('system HAS budget: 10 USD @src:forecast-a\nsystem HAS budget: 12 USD @src:forecast-b')
  assert.throws(() => bind(contested, baseDefinition({
    bindings: [{
      id: 'budget', query: 'system HAS budget: ?value', select: 'value', expected: { kind: 'number', unit: 'USD' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }]
  })), (error: unknown) => error instanceof ScenarioInputError && error.code === 'contested-input')
  contested.close()

  const units = open()
  units.ingest('system HAS team-size: 8 people')
  assert.throws(() => bind(units, baseDefinition({
    overlay: 'system HAS team-size: 30ms',
    bindings: [{
      id: 'team-size', query: 'system HAS team-size: ?n', select: 'n', expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one', scenarioOverride: true, policies: policies()
    }]
  })), (error: unknown) => error instanceof ScenarioInputError && error.code === 'incompatible-unit')
  assertNoOverlay(units)
  units.close()

  const retracted = open()
  retracted.ingest('system HAS team-size: 8 people\nsystem HAS team-size: 8 people @ 0%')
  assert.throws(() => bind(retracted, baseDefinition({
    bindings: [{
      id: 'team-size', query: 'system HAS team-size: ?n', select: 'n', expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one', scenarioOverride: false, policies: policies({ retracted: 'reject' })
    }]
  })), (error: unknown) => error instanceof ScenarioInputError && error.code === 'retracted-input')
  retracted.close()
})

test('replaying a frozen snapshot and overlay produces the same record digest', () => {
  const store = open()
  store.ingest('system HAS team-size: 8 people')
  const definition = baseDefinition({
    overlay: 'system HAS team-size: 12 people',
    bindings: [{
      id: 'team-size', query: 'system HAS team-size: ?n', select: 'n', expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one', scenarioOverride: true, policies: policies()
    }]
  })
  const first = bind(store, definition)
  const second = bind(store, definition)
  assert.deepEqual(second, first)
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/)
  assertNoOverlay(store)
  store.close()
})

test('explanation context retains authored inputs, queries, snapshots, and exact evidence IDs', () => {
  const store = open()
  store.ingest('system HAS team-size: 8 people')
  const definition = baseDefinition({
    snapshot: { ...snapshot, at: '2026-08-01', resolution: 'winner' },
    bindings: [{
      id: 'team-size', query: 'system HAS team-size: ?n', select: 'n', expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }]
  })
  const record = bind(store, definition)
  const context = explanationContext(definition, record)

  assert.equal(context.modelDigest, modelDigest)
  assert.deepEqual(context.scenario, {
    id: definition.id, inputDigest: record.digest, overlayDigest: record.overlay.digest
  })
  assert.deepEqual(context.snapshot, {
    transactionTime: record.snapshot.transactionTime,
    validTime: '2026-08-01', aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5
  })
  assert.deepEqual(context.inputs, [{
    id: 'team-size', query: 'system HAS team-size: ?n',
    value: { kind: 'integer', value: '8', unit: 'people', authored: '8 people', approximate: false },
    authoredValue: '8 people', evidenceRowIds: record.supportingRowIds, scenarioClaimIds: []
  }])
  store.close()
})

test('evaluators run only after success, timeout, and crash overlays are gone', async () => {
  const store = open()
  store.ingest('system HAS team-size: 8 people')
  const definition = baseDefinition({
    overlay: 'system HAS team-size: 12 people',
    bindings: [{
      id: 'team-size', query: 'system HAS team-size: ?n', select: 'n', expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one', scenarioOverride: true, policies: policies()
    }]
  })

  assert.equal(await run(store, definition, () => {
    assertNoOverlay(store)
    return 'satisfied'
  }), 'satisfied')
  await assert.rejects(run(store, definition, () => {
    assertNoOverlay(store)
    throw new Error('timeout')
  }), /timeout/)
  await assert.rejects(run(store, definition, async () => {
    assertNoOverlay(store)
    throw new Error('worker crashed')
  }), /worker crashed/)
  assertNoOverlay(store)
  store.close()
})
