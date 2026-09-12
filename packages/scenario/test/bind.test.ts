import { test } from 'node:test'
import { inputDigest } from '../src/bind.ts'
import * as assert from 'node:assert/strict'
import { bind, explanationContext, Model, run, ScenarioInputError } from '@cavelang/scenario'
import { open, type Store } from '@cavelang/store'
import { Uuidv7 } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

test('binding captures a changing definition once before validation and digesting', () => {
  const store = open()
  try {
    const expected = bind(store, baseDefinition())
    let reads = 0
    const definition: Model.Definition = { ...baseDefinition(),
      get id() { return ++reads === 1 ? 'architecture-choice' : 'changed' }
    }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const result = bind(store, definition)
    assert.equal(reads, 1)
    assert.deepEqual(result, expected)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('deep invalid definition values fail with classified diagnostics before database access', () => {
  let value: unknown = 'invalid overlay'
  for (let depth = 0; depth < 20000; depth++) value = { nested: value }
  const store = open()
  store.close()
  assert.throws(() => bind(store, baseDefinition({ overlay: value as never })), error =>
    error instanceof ScenarioInputError && error.code === 'invalid-definition' && /overlay/.test(error.message))
})

test('unserializable definition metadata rejects before database access and permits corrected retry', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  let deep: unknown = 'metadata'
  for (let depth = 0; depth < 20000; depth++) deep = { nested: deep }
  const closed = open()
  closed.close()
  const store = open()
  try {
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const metadata of [cyclic, deep, 1n]) {
      const definition = { ...baseDefinition(), metadata }
      for (const database of [closed, store]) {
        assert.throws(() => bind(database, definition), error =>
          error instanceof ScenarioInputError && error.code === 'invalid-definition' && /serializ/.test(error.message))
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const definition = { ...baseDefinition(), metadata: { label: 'corrected' } }
    const result = bind(store, definition)
    assert.deepEqual(bind(store, definition), result)
    assert.doesNotThrow(() => explanationContext(definition, result))
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('fresh bindings reflect rollback while previously returned input records stay frozen', () => {
  const store = open()
  try {
    store.ingest('system HAS stage: retained')
    const definition = baseDefinition({ bindings: [{
      id: 'stage', query: 'system HAS stage: ?value', select: 'value',
      expected: { kind: 'text' }, cardinality: 'one', scenarioOverride: false, policies: policies()
    }] })
    const before = bind(store, definition)
    let staged: ReturnType<typeof bind> | undefined
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('system HAS stage: staged')
      staged = bind(store, definition)
      assert.deepEqual(staged.values['stage'], { kind: 'text', value: 'staged' })
      const stagedJson = JSON.stringify(staged)
      assert.throws(() => store.transaction(() => {
        store.ingest('system HAS stage: nested')
        const nested = bind(store, definition)
        assert.deepEqual(nested.values['stage'], { kind: 'text', value: 'nested' })
        assert.notEqual(nested.digest, staged!.digest)
        throw rollback
      }), error => error === rollback)
      assert.deepEqual(bind(store, definition), staged)
      assert.equal(JSON.stringify(staged), stagedJson)
      throw rollback
    }), error => error === rollback)
    assert.deepEqual(bind(store, definition), before)
    assert.deepEqual(staged!.values['stage'], { kind: 'text', value: 'staged' })
    assert.notEqual(staged!.digest, before.digest)
    assert.equal(store.currentBeliefs().some(row => staged!.supportingRowIds.includes(row.id)), false)
  } finally { store.close() }
})

test('invalid selections fail before reads even for optional or Boolean bindings', () => {
  const store = open()
  store.close()
  for (const select of ['typo', '?value', '', null, 1, ['value'], { toString: () => 'value' }]) {
    for (const expected of [{ kind: 'text' }, { kind: 'boolean' }] as const) {
      const binding: Model.Binding = { id: 'stage', query: 'system HAS stage: ?value',
        select: select as string, expected, cardinality: 'optional',
        scenarioOverride: false, policies: policies({ missing: 'omit' }) }
      assert.throws(() => bind(store, baseDefinition({ bindings: [binding] })), error =>
        error instanceof ScenarioInputError && error.code === 'invalid-definition' && error.bindingId === 'stage')
    }
  }
})

test('an empty snapshot cannot hide an unbound selection', () => {
  const store = open()
  try {
    assert.throws(() => bind(store, baseDefinition({ bindings: [{
      id: 'stage', query: 'system HAS stage: ?value', select: 'typo', expected: { kind: 'text' },
      cardinality: 'optional', scenarioOverride: false, policies: policies({ missing: 'omit' })
    }] })), error => error instanceof ScenarioInputError && error.code === 'invalid-definition')
  } finally { store.close() }
})

test('selections support subject, verb, object and attribute value variables', () => {
  const store = open()
  try {
    store.ingest('system IS service\nsystem HAS stage: prod')
    for (const [query, value] of [
      ['?chosen IS service', 'system'], ['system ?chosen service', 'IS'],
      ['system IS ?chosen', 'service'], ['system HAS stage: ?chosen', 'prod']
    ] as const) {
      const record = bind(store, baseDefinition({ bindings: [{
        id: 'selected', query, select: 'chosen', expected: { kind: 'text' },
        cardinality: 'one', scenarioOverride: false, policies: policies()
      }] }))
      assert.deepEqual(record.values['selected'], { kind: 'text', value })
    }
    const record = bind(store, baseDefinition({ bindings: [{
      id: 'exists', query: 'system IS service', expected: { kind: 'boolean' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }] }))
    assert.deepEqual(record.values['exists'], { kind: 'boolean', value: true })
  } finally { store.close() }
})

test('scenario binding rejects writes between snapshot capture and materialization', () => {
  for (const writer of ['peer', 'local'] as const) {
    const directory = mkdtempSync(join(tmpdir(), 'cave-scenario-snapshot-'))
    const store = open(join(directory, 'store.db'))
    const peer = open(join(directory, 'store.db'))
    try {
      let injected = false
      const observed = new Proxy(store, { get(target, key, receiver) {
        if (key === 'registry') return () => {
          if (!injected) {
            injected = true
            ;(writer === 'peer' ? peer : store).ingest('system IS ready')
          }
          return target.registry()
        }
        return Reflect.get(target, key, receiver)
      } })
      const definition = baseDefinition({ bindings: [{ id: 'ready', query: 'system IS ready',
        expected: { kind: 'boolean' }, cardinality: 'many', reduce: 'all',
        scenarioOverride: false, policies: policies({ missing: 'empty' }) }] })
      assert.throws(() => bind(observed, definition), error =>
        error instanceof ScenarioInputError && error.code === 'snapshot-changed', writer)
      const retried = bind(store, definition)
      assert.notEqual(retried.snapshot.transactionTime, null)
      assert.deepEqual(retried.values['ready'], [{ kind: 'boolean', value: true }])
      const reader = open(join(directory, 'store.db'), { access: 'read-only' })
      try { assert.deepEqual(bind(reader, definition), retried) } finally { reader.close() }
    } finally {
      peer.close(); store.close(); rmSync(directory, { recursive: true, force: true })
    }
  }
})

test('a peer commit after overlay rollback prevents evaluator invocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-scenario-overlay-race-'))
  const store = open(join(directory, 'store.db'))
  const peer = open(join(directory, 'store.db'))
  try {
    store.ingest('baseline IS ready')
    const observed = new Proxy(store, { get(target, key, receiver) {
      if (key === 'transaction') return (body: Parameters<Store['transaction']>[0]) => {
        try { return target.transaction(body) } finally {
          const id = Uuidv7.at(Date.parse('2020-01-01T00:00:00Z'), 0, new Uint8Array(8))
          Uuidv7.withStatePreserved(() => peer.insertResult(canonicalizeText('imported IS ready', peer.registry()), { ids: [id] }))
        }
      }
      return Reflect.get(target, key, receiver)
    } })
    const definition = baseDefinition({ overlay: 'system IS ready', bindings: [{ id: 'ready', query: 'system IS ready',
      expected: { kind: 'boolean' }, cardinality: 'one', scenarioOverride: true, policies: policies() }] })
    let called = false
    await assert.rejects(run(observed, definition, () => { called = true }), error =>
      error instanceof ScenarioInputError && error.code === 'snapshot-changed')
    assert.equal(called, false)
    assert.equal(store.claimsAbout('system').length, 0)
    assert.equal(store.claimsAbout('imported').length, 1)
    assert.deepEqual(bind(store, definition).values['ready'], { kind: 'boolean', value: true })
  } finally {
    peer.close(); store.close(); rmSync(directory, { recursive: true, force: true })
  }
})

test('unknown scenario policies fail as invalid definitions before any database access', () => {
  const store = open()
  store.close()
  const original: Model.Definition = baseDefinition({ bindings: [{ id: 'size', query: 'system HAS size: ?n', select: 'n',
    expected: { kind: 'integer' }, cardinality: 'many', reduce: 'sum', scenarioOverride: false,
    policies: policies({ missing: 'empty' }) }] })
  const paths = [
    ['snapshot', 'aliases'], ['snapshot', 'resolution'],
    ['bindings', 0, 'cardinality'], ['bindings', 0, 'reduce'], ['bindings', 0, 'scenarioOverride'],
    ['bindings', 0, 'expected', 'kind'],
    ...['missing', 'contested', 'retracted', 'unresolved'].map(key => ['bindings', 0, 'policies', key])
  ]
  for (const path of paths) {
    const definition = JSON.parse(JSON.stringify(original))
    let target = definition
    for (const key of path.slice(0, -1)) target = target[key!]
    target[path[path.length - 1]!] = 'typo'
    assert.throws(() => bind(store, definition), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition', path.join('.'))
  }
})

test('scenario and binding identifiers reject coercible values before database access', () => {
  const store = open()
  store.close()
  const binding: Model.Binding = { id: 'ready', query: 'system IS ready',
    expected: { kind: 'boolean' }, cardinality: 'one', scenarioOverride: false, policies: policies() }
  const coercible = { toString: () => { throw new Error('identifier must not be coerced') } }
  for (const value of [undefined, null, true, 1, 1n, ['ready'], new String('ready'), Symbol('ready'), coercible]) {
    const id = value as unknown as string
    for (const definition of [baseDefinition({ id }), baseDefinition({ bindings: [{ ...binding, id }] })]) {
      assert.throws(() => bind(store, definition), error =>
        error instanceof ScenarioInputError && error.code === 'invalid-definition')
    }
  }
  assert.throws(() => bind(store, baseDefinition({ modelDigest: new String(modelDigest) as unknown as string })),
    error => error instanceof ScenarioInputError && error.code === 'invalid-definition')
})

test('numeric and string binding identifiers cannot overwrite the same input slot', () => {
  const store = open()
  try {
    store.ingest('system HAS size: 1\nsystem HAS count: 2')
    const binding: Model.Binding = { id: '1', query: 'system HAS count: ?n', select: 'n',
      expected: { kind: 'integer' }, cardinality: 'one', scenarioOverride: false, policies: policies() }
    assert.throws(() => bind(store, baseDefinition({ bindings: [
      { ...binding, id: 1 as unknown as string, query: 'system HAS size: ?n' }, binding
    ] })), error => error instanceof ScenarioInputError && error.code === 'invalid-definition')
    assert.deepEqual(bind(store, baseDefinition({ bindings: [binding] })).values['1'],
      { kind: 'integer', value: '2', authored: '2', approximate: false })
  } finally { store.close() }
})

test('scenario time anchors are validated before reads even without bindings', () => {
  const store = open()
  store.close()
  for (const field of ['asOf', 'at']) {
    for (const value of ['2026-02-30', '2026-13', 'not-a-time', '', null, 42, {}]) {
      const definition = baseDefinition({ snapshot: { ...snapshot, [field]: value } as Model.Snapshot })
      assert.throws(() => bind(store, definition), error =>
        error instanceof ScenarioInputError && error.code === 'invalid-definition', `${field}: ${JSON.stringify(value)}`)
    }
  }
})

test('empty scenarios reject invalid valid-time dates and retain valid anchors', () => {
  const store = open()
  try {
    assert.throws(() => bind(store, baseDefinition({ snapshot: { ...snapshot, at: '2026-02-30' } })),
      error => error instanceof ScenarioInputError && error.code === 'invalid-definition')
    for (const at of ['2026', '2026-02', '2026-02-28', '2026-02-28T12:34:56Z']) {
      const record = bind(store, baseDefinition({ snapshot: { ...snapshot, at } }))
      assert.equal(record.snapshot.at, at)
      assert.deepEqual(record.bindings, [])
    }
    const tx = Uuidv7.at(Date.parse('2026-01-01T00:00:00Z'), 0, new Uint8Array(8))
    assert.throws(() => bind(store, baseDefinition({ snapshot: { ...snapshot, at: tx } })), ScenarioInputError)
  } finally { store.close() }
})

test('scenario valid-time periods anchor at their start', () => {
  const store = open()
  try {
    store.ingest('system HAS phase: initial @2026-01-01\nsystem HAS phase: later @2026-02-01')
    const bindings: Model.Binding[] = [{ id: 'phase', query: 'system HAS phase: ?value', select: 'value',
      expected: { kind: 'text' }, cardinality: 'one', scenarioOverride: false, policies: policies() }]
    for (const [at, expected] of [['2026', 'initial'], ['2026-02', 'later']] as const) {
      const record = bind(store, baseDefinition({ snapshot: { ...snapshot, at }, bindings }))
      assert.deepEqual(record.values['phase'], { kind: 'text', value: expected })
    }
  } finally { store.close() }
})

test('enum definitions require a non-empty dense array of unique strings before reads', () => {
  const store = open()
  store.close()
  for (const values of [undefined, null, 'product', new Set(['prod']), [1], [undefined], new Array(1), [], ['prod', 'prod']]) {
    const bindings: Model.Binding[] = [{ id: 'stage', query: 'system HAS stage: ?s', select: 's',
      expected: { kind: 'enum', values: values as readonly string[] }, cardinality: 'optional',
      scenarioOverride: false, policies: policies({ missing: 'omit' }) }]
    assert.throws(() => bind(store, baseDefinition({ bindings })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition')
  }
})

test('a string cannot turn scenario enum membership into substring matching', () => {
  const store = open()
  try {
    store.ingest('system HAS stage: prod')
    const binding: Model.Binding = { id: 'stage', query: 'system HAS stage: ?s', select: 's',
      expected: { kind: 'enum', values: 'product' as unknown as readonly string[] }, cardinality: 'one',
      scenarioOverride: false, policies: policies() }
    assert.throws(() => bind(store, baseDefinition({ bindings: [binding] })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition')
    const valid = { ...binding, expected: { kind: 'enum', values: ['prod', 'product'] } as const }
    assert.deepEqual(bind(store, baseDefinition({ bindings: [valid] })).values['stage'], { kind: 'enum', value: 'prod' })
    store.ingest('system HAS stage: pro')
    assert.throws(() => bind(store, baseDefinition({ bindings: [valid] })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-value')
    store.ingest('system HAS stage: Prod')
    assert.throws(() => bind(store, baseDefinition({ bindings: [valid] })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-value')
    store.ingest('system HAS stage: ""')
    const empty = { ...valid, expected: { kind: 'enum', values: ['', 'prod', 'Prod'] } as const }
    assert.deepEqual(bind(store, baseDefinition({ bindings: [empty] })).values['stage'], { kind: 'enum', value: '' })
  } finally { store.close() }
})

test('Boolean mappings reject invalid types and overlapping values before reads', () => {
  const store = open()
  store.close()
  const mappings = [
    { trueValue: 'yes', falseValue: 'yes' }, { trueValue: 'false' }, { falseValue: 'true' },
    { trueValue: '', falseValue: '' }, { trueValue: null }, { falseValue: 0 }
  ]
  for (const mapping of mappings) {
    const binding: Model.Binding = { id: 'ready', query: 'system HAS ready: ?value', select: 'value',
      expected: { kind: 'boolean', ...mapping } as Model.Expected, cardinality: 'optional',
      scenarioOverride: false, policies: policies({ missing: 'omit' }) }
    assert.throws(() => bind(store, baseDefinition({ bindings: [binding] })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition')
  }
})

test('Boolean mappings cannot silently resolve an ambiguous value as true', () => {
  const store = open()
  try {
    store.ingest('system HAS ready: yes')
    const binding: Model.Binding = { id: 'ready', query: 'system HAS ready: ?value', select: 'value',
      expected: { kind: 'boolean', trueValue: 'yes', falseValue: 'yes' }, cardinality: 'one',
      scenarioOverride: false, policies: policies() }
    assert.throws(() => bind(store, baseDefinition({ bindings: [binding] })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition')
    const valid = { ...binding, expected: { kind: 'boolean', trueValue: 'yes', falseValue: 'no' } as const }
    assert.deepEqual(bind(store, baseDefinition({ bindings: [valid] })).values['ready'], { kind: 'boolean', value: true })
    store.ingest('system HAS ready: no')
    assert.deepEqual(bind(store, baseDefinition({ bindings: [valid] })).values['ready'], { kind: 'boolean', value: false })
    store.ingest('system HAS ready: ""')
    const empty = { ...valid, expected: { kind: 'boolean', trueValue: '', falseValue: 'no' } as const }
    assert.deepEqual(bind(store, baseDefinition({ bindings: [empty] })).values['ready'], { kind: 'boolean', value: true })
  } finally { store.close() }
})

test('scenario transaction boundaries share query year, month, day, and UUID semantics', () => {
  const store = open()
  try {
    const ids = ['2026-01-15', '2026-02-01', '2027-01-01'].map(date => Uuidv7.at(Date.parse(`${date}T00:00:00Z`), 0, new Uint8Array(8)))
    Uuidv7.withStatePreserved(() => ids.forEach((id, index) =>
      store.insertResult(canonicalizeText(`system HAS size: ${index + 1}`, store.registry()), { ids: [id] })))
    const bindings: Model.Binding[] = [{ id: 'size', query: 'system HAS size: ?n', select: 'n',
      expected: { kind: 'integer' }, cardinality: 'one', scenarioOverride: false, policies: policies() }]
    for (const [asOf, expected, tx] of [['2026', '2', ids[1]], ['2026-01', '1', ids[0]], ['2026-01-15', '1', ids[0]], [ids[0]!.toUpperCase(), '1', ids[0]]] as const) {
      const record = bind(store, baseDefinition({ snapshot: { ...snapshot, asOf }, bindings }))
      assert.equal(record.snapshot.transactionTime, tx)
      assert.equal((record.values['size'] as Model.Value & { value: string }).value, expected)
    }
    for (const asOf of ['2026-02-30', '2026-13', 'not-a-boundary']) {
      assert.throws(() => bind(store, baseDefinition({ snapshot: { ...snapshot, asOf } })), ScenarioInputError)
    }
  } finally { store.close() }
})

test('valid binding names cannot resolve inherited overlay entries', () => {
  const store = open()
  try {
    store.ingest('system IS ready')
    for (const id of ['constructor', 'toString', 'hasOwnProperty', '1', 'true', 'null', 'undefined']) {
      const record = bind(store, baseDefinition({ bindings: [{ id, query: 'system IS ready',
        expected: { kind: 'boolean' }, cardinality: 'one', scenarioOverride: false, policies: policies() }] }))
      assert.deepEqual(record.values[id], { kind: 'boolean', value: true })
    }
  } finally { store.close() }
})

const assertNoOverlay = (store: Store): void => {
  assert.equal(store.byContext('src:scenario/architecture-choice').length, 0)
  assert.equal(store.claimsAbout('system').length, 1)
}

test('overlay query filters match stored claims and leave no rows after success or failure', () => {
  const stored = open()
  const hypothetical = open()
  const claims = 'a HAS size: 2 nodes @production #review:yes @ 90%\nb HAS size: 5 nodes @staging #review:no @ 60%'
  try {
    stored.ingest(claims)
    for (const filter of ['WHERE conf >= 0.8', 'WHERE tag = review:yes',
      'WHERE context = production', 'WHERE value > 3 nodes',
      'WHERE conf >= 0.5\nWHERE value < 3 nodes', 'WHERE tag = absent']) {
      const binding: Model.Binding = { id: 'sizes', query: `?subject HAS size: ?value\n${filter}`,
        select: 'value', expected: { kind: 'integer', unit: 'nodes' }, cardinality: 'many', reduce: 'all',
        scenarioOverride: true, policies: policies({ missing: 'empty' }) }
      const definition = baseDefinition({ bindings: [binding] })
      const base = bind(stored, definition)
      const overlay = bind(hypothetical, { ...definition, overlay: claims })
      assert.deepEqual(overlay.values, base.values, filter)
      assert.deepEqual(overlay.bindings[0]!.candidates.map(candidate => candidate.confidence),
        base.bindings[0]!.candidates.map(candidate => candidate.confidence), filter)
      assert.deepEqual(overlay.supportingRowIds, [])
      assert.equal(overlay.scenarioClaimIds.length, overlay.bindings[0]!.candidates.length)
      assert.equal(hypothetical.currentBeliefs().length, 0)
    }
    assert.throws(() => bind(hypothetical, baseDefinition({ overlay: claims, bindings: [{
      id: 'sizes', query: '?subject HAS size: ?value', select: 'value',
      expected: { kind: 'integer', unit: 'ms' }, cardinality: 'many', reduce: 'all',
      scenarioOverride: true, policies: policies()
    }] })), error => error instanceof ScenarioInputError && error.code === 'incompatible-unit')
    assert.equal(hypothetical.currentBeliefs().length, 0)
    assert.equal(hypothetical.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get()!['n'], 0)
  } finally { stored.close(); hypothetical.close() }
})

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

test('ambiguous conversion pairs cannot choose a factor by declaration order', () => {
  const store = open()
  try {
    store.ingest('job HAS timeout: 2 s')
    const conversions = [{ from: 's', to: 'ms', factor: '1000' }, { from: 's', to: 'ms', factor: '100' }]
    for (const ordered of [conversions, [...conversions].reverse()]) {
      assert.throws(() => bind(store, baseDefinition({ bindings: [{
        id: 'timeout', query: 'job HAS timeout: ?value', select: 'value',
        expected: { kind: 'number', unit: 'ms', conversions: ordered }, cardinality: 'one',
        scenarioOverride: false, policies: policies()
      }] })), error => error instanceof ScenarioInputError && error.code === 'invalid-definition')
    }
  } finally { store.close() }
})

test('malformed conversion definitions fail before database access', () => {
  const store = open()
  store.close()
  const conversion = { from: 's', to: 'ms', factor: '1000' }
  for (const conversions of [null, {}, new Array(1), [null],
    [{ ...conversion, from: '' }], [{ ...conversion, to: 1 }],
    [{ ...conversion, factor: 'not-a-number' }], [conversion, conversion]]) {
    const binding: Model.Binding = { id: 'timeout', query: 'job HAS timeout: ?value', select: 'value',
      expected: { kind: 'number', unit: 'ms', conversions } as Model.Expected,
      cardinality: 'optional', scenarioOverride: false, policies: policies({ missing: 'omit' }) }
    assert.throws(() => bind(store, baseDefinition({ bindings: [binding] })), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition')
  }
})

test('numeric inputs honor the selected variable instead of another row value', () => {
  const store = open()
  try {
    store.ingest('system HAS size: 8\n12 HAS count: 8 +/- 1')
    for (const kind of ['integer', 'number'] as const) {
      const binding: Model.Binding = { id: 'selected', query: '?chosen HAS size: ?value', select: 'chosen',
        expected: { kind }, cardinality: 'one',
        scenarioOverride: false, policies: policies() }
      assert.throws(() => bind(store, baseDefinition({ bindings: [binding] })), error =>
        error instanceof ScenarioInputError && error.code === 'invalid-value')
      for (const overlay of [undefined, '12 HAS count: 9 +/- 2']) {
        const valid = bind(store, baseDefinition({ overlay,
          bindings: [{ ...binding, query: '?chosen HAS count: ?value', scenarioOverride: true }] }))
        assert.deepEqual(valid.values['selected'], { kind,
          value: kind === 'integer' ? '12' : { numerator: '12', denominator: '1' },
          authored: '12', approximate: false })
      }
    }
  } finally { store.close() }
})

test('numeric selections preserve interpolation only for the selected value slot', () => {
  const store = open()
  try {
    store.ingest('12 HAS count: 100 -> 400 @2025..2027')
    for (const [select, value] of [['subject', '12'], ['value', '250']] as const) {
      const record = bind(store, baseDefinition({ snapshot: { ...snapshot, at: '2026' }, bindings: [{
        id: 'selected', query: '?subject HAS count: ?value', select, expected: { kind: 'integer' },
        cardinality: 'one', scenarioOverride: false, policies: policies()
      }] }))
      assert.deepEqual(record.values['selected'], { kind: 'integer', value, authored: value, approximate: false })
    }
  } finally { store.close() }
})

test('stored decimal suffixes retain exact scenario values, uncertainty and evidence', () => {
  const store = open()
  try {
    const zeros = '0'.repeat(1000)
    const inserted = store.ingest(`job HAS timeout: ~1.25${zeros} s +/- 0.05${zeros} s @ 80%`)
    assert.deepEqual(inserted.problems, [])
    const definition = baseDefinition({ bindings: [{
      id: 'timeout', query: 'job HAS timeout: ?value', select: 'value',
      expected: { kind: 'number', unit: 'ms', conversions: [{ from: 's', to: 'ms', factor: '1000' }] },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }] })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const record = bind(store, definition)
    const value = record.values['timeout']
    assert.ok(value !== undefined && 'kind' in value && value.kind === 'number')
    assert.deepEqual(value.value, { numerator: '1250', denominator: '1' })
    assert.equal(value.approximate, true)
    assert.deepEqual(value.uncertainty?.exact, { numerator: '50', denominator: '1' })
    assert.equal(value.uncertainty?.sigmaLevel, 2)
    assert.equal(record.bindings[0]!.candidates[0]!.confidence, 0.8)
    assert.deepEqual(record.bindings[0]!.candidates[0]!.evidence, [{ origin: 'belief', rowIds: inserted.ids }])
    assert.deepEqual(bind(store, definition), record)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
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
        conversions: [
          { from: 's', to: 'ms', factor: '1000' },
          { from: 'ms', to: 's', factor: { numerator: '1', denominator: '1000' } }
        ]
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

test('numeric reducers reject mixed units instead of comparing or adding raw magnitudes', () => {
  for (const values of [['1 s', '500 ms'], ['1', '2 s']]) {
    for (const ordered of [values, [...values].reverse()]) {
      const store = open()
      try {
        store.ingest(ordered.map((value, index) => `job-${index} HAS duration: ${value}`).join('\n'))
        for (const kind of ['integer', 'number'] as const) {
          for (const reduce of ['sum', 'min', 'max'] as const) {
            assert.throws(() => bind(store, baseDefinition({ bindings: [{
              id: 'duration', query: '?job HAS duration: ?value', select: 'value', expected: { kind },
              cardinality: 'many', reduce, scenarioOverride: false, policies: policies()
            }] })), error => error instanceof ScenarioInputError && error.code === 'incompatible-unit' &&
              error.bindingId === 'duration')
          }
        }
      } finally { store.close() }
    }
  }
})

test('numeric reducers use explicitly converted units and all retains individual units', () => {
  const store = open()
  try {
    store.ingest('a HAS duration: 1 s\nb HAS duration: 500 ms')
    const binding: Model.Binding = { id: 'duration', query: '?job HAS duration: ?value', select: 'value',
      expected: { kind: 'integer' }, cardinality: 'many', reduce: 'all', scenarioOverride: false, policies: policies() }
    const all = bind(store, baseDefinition({ bindings: [binding] })).values['duration'] as readonly Model.Value[]
    assert.deepEqual(all.map(value => 'unit' in value ? value.unit : undefined), ['s', 'ms'])
    for (const [reduce, value] of [['sum', '1500'], ['min', '500'], ['max', '1000']] as const) {
      const result = bind(store, baseDefinition({ bindings: [{ ...binding, reduce,
        expected: { kind: 'integer', unit: 'ms', conversions: [{ from: 's', to: 'ms', factor: '1000' }] }
      }] })).values['duration'] as Extract<Model.Value, { kind: 'integer' }>
      assert.equal(result.value, value)
      assert.equal(result.unit, 'ms')
    }
  } finally { store.close() }
})

test('numeric reducers retain common inferred units and unitless inputs', () => {
  for (const unit of [undefined, 's']) {
    const store = open()
    try {
      store.ingest(`a HAS duration: 1${unit === undefined ? '' : ` ${unit}`}\nb HAS duration: 2${unit === undefined ? '' : ` ${unit}`}`)
      for (const kind of ['integer', 'number'] as const) {
        for (const [reduce, value] of [['sum', '3'], ['min', '1'], ['max', '2']] as const) {
          const result = bind(store, baseDefinition({ bindings: [{
            id: 'duration', query: '?job HAS duration: ?value', select: 'value', expected: { kind },
            cardinality: 'many', reduce, scenarioOverride: false, policies: policies()
          }] })).values['duration'] as Extract<Model.Value, { kind: 'integer' | 'number' }>
          assert.deepEqual(result.value, kind === 'integer' ? value : { numerator: value, denominator: '1' })
          assert.equal(result.unit, unit)
        }
      }
    } finally { store.close() }
  }
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

test('explanation values come from the input record whose digest was checked', () => {
  const store = open()
  try {
    store.ingest('system HAS size: 8')
    const definition = baseDefinition({ bindings: [{
      id: 'size', query: 'system HAS size: ?value', select: 'value', expected: { kind: 'integer' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }] })
    const record = bind(store, definition)
    const expected = explanationContext(definition, record)
    const original = record.bindings[0]!.value as Extract<Model.Value, { kind: 'integer' }>
    let reads = 0
    const changing: Model.InputRecord = { ...record, bindings: [{ ...record.bindings[0]!,
      get value() { return ++reads === 1 ? original : { ...original, value: '999' } }
    }] }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.deepEqual(explanationContext(definition, changing), expected)
    assert.equal(reads, 1)
    assert.throws(() => explanationContext(definition, changing), /input digest/)
    assert.equal(reads, 2)

    const mutable = JSON.parse(JSON.stringify(record)) as Model.InputRecord
    const captured = explanationContext(definition, mutable)
    Object.assign(mutable.bindings[0]!.value!, { value: '999' })
    assert.deepEqual(captured, expected, 'later caller mutations do not rewrite checked explanation values')
    assert.throws(() => explanationContext(definition, mutable), /input digest/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('explanation context rejects unsupported input schemas even with a matching digest', () => {
  const store = open()
  try {
    const definition = baseDefinition({ bindings: [] })
    const record = bind(store, definition)
    const expected = explanationContext(definition, record)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const schema of [undefined, null, '', 'cave.scenario/inputs@2', 1, false, {}]) {
      const { digest: _digest, ...contents } = record
      const changed = { ...contents, schema } as unknown as Omit<Model.InputRecord, 'digest'>
      const imported = { ...changed, digest: inputDigest(changed) }
      assert.throws(() => explanationContext(definition, imported), /unsupported scenario input schema/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    assert.deepEqual(explanationContext(definition, JSON.parse(JSON.stringify(record))), expected)
  } finally { store.close() }
})

test('explanation context requires one result for every declared binding', () => {
  const store = open()
  try {
    store.ingest('system HAS size: 8')
    const definition = baseDefinition({ bindings: [{
      id: 'size', query: 'system HAS size: ?value', select: 'value', expected: { kind: 'integer' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }] })
    const record = bind(store, definition)
    const expected = explanationContext(definition, record)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const [bindings, message] of [
      [[], /missing binding "size"/],
      [[record.bindings[0]!, record.bindings[0]!], /duplicate binding "size"/]
    ] as const) {
      const { digest: _digest, ...contents } = record
      const changed = { ...contents, bindings }
      assert.throws(() => explanationContext(definition, { ...changed, digest: inputDigest(changed) }), message)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    assert.deepEqual(explanationContext(definition, JSON.parse(JSON.stringify(record))), expected)
  } finally { store.close() }
})

test('explanation queries come from the definition whose digest was checked', () => {
  const store = open()
  try {
    store.ingest('system HAS size: 8')
    const definition = baseDefinition({ bindings: [{
      id: 'size', query: 'system HAS size: ?value', select: 'value', expected: { kind: 'integer' },
      cardinality: 'one', scenarioOverride: false, policies: policies()
    }] })
    const record = bind(store, definition)
    const expected = explanationContext(definition, record)
    let queries = 0
    const changing: Model.Definition = { ...definition, bindings: [{ ...definition.bindings[0]!,
      get query() { return ++queries === 1 ? 'system HAS size: ?value' : 'system HAS unrelated: ?value' }
    }] }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.deepEqual(explanationContext(changing, record), expected)
    assert.equal(queries, 1)
    assert.throws(() => explanationContext(changing, record), /definition digest/)
    assert.equal(queries, 2)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
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
  const changed = {
    ...definition,
    bindings: definition.bindings.map(binding => ({ ...binding, query: 'system HAS headcount: ?n' }))
  }
  assert.throws(() => explanationContext(changed, record), /definition digest/)
  assert.throws(() => explanationContext({ ...definition, snapshot: { ...definition.snapshot, aliases: 'closure' } }, record), /definition digest/)
  assert.throws(() => explanationContext(definition, { ...record, bindings: [] }), /input digest/)
  assert.throws(() => explanationContext(definition, { ...record, values: {} }), /input digest/)
  const legacy = { ...record, definitionDigest: undefined } as unknown as Model.InputRecord
  assert.throws(() => explanationContext(definition, legacy), /definition digest.*missing/)
  assert.deepEqual(explanationContext(definition, JSON.parse(JSON.stringify(record)) as Model.InputRecord), context)

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

test('overlay insertion failures restore history and vocabulary before a run can be retried', async t => {
  const store = open()
  try {
    store.ingest('system HAS size: 8')
    const definition = baseDefinition({
      overlay: 'MIGRATES IS verb\nsystem MIGRATES postgres\nsystem HAS size: 12',
      bindings: [{
        id: 'size', query: 'system HAS size: ?value', select: 'value', expected: { kind: 'integer' },
        cardinality: 'one', scenarioOverride: true, policies: policies()
      }]
    })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const failure = new Error('overlay insertion failed after writes')
    const insert = store.insertResult.bind(store)
    let attempts = 0, evaluations = 0
    const mocked = t.mock.method(store, 'insertResult', (...args: Parameters<typeof store.insertResult>) => {
      const result = insert(...args)
      attempts++
      assert.equal(result.ids.length, 3)
      assert.equal(store.registry().declared.has('MIGRATES'), true)
      throw failure
    })
    await assert.rejects(run(store, definition, () => { evaluations++; }), error => error === failure)
    assert.equal(attempts, 1)
    assert.equal(evaluations, 0)
    mocked.mock.restore()
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(store.registry().declared.has('MIGRATES'), false)

    const recovered = await run(store, definition, inputs => {
      evaluations++
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(store.registry().declared.has('MIGRATES'), false)
      return inputs
    })
    assert.equal(evaluations, 1)
    assert.equal((recovered.values['size'] as Extract<Model.Value, { kind: 'integer' }>).value, '12')
    assert.deepEqual(bind(store, definition), recovered)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(store.registry().declared.has('MIGRATES'), false)
  } finally { store.close() }
})

test('a pending evaluator holds no overlay transaction and preserves subsequent writes', async () => {
  for (const fails of [false, true]) {
    const store = open()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let settled = false
    const failure = new Error('evaluator deadline exceeded')
    try {
      store.ingest('system HAS size: 8')
      const result = run(store, baseDefinition({ overlay: 'system HAS size: 12', bindings: [{
        id: 'size', query: 'system HAS size: ?value', select: 'value', expected: { kind: 'integer' },
        cardinality: 'one', scenarioOverride: true, policies: policies()
      }] }), async inputs => {
        assert.equal((inputs.values['size'] as Extract<Model.Value, { kind: 'integer' }>).value, '12')
        await pending
        if (fails) throw failure
        return 'evaluated'
      }).then(value => { settled = true; return value }, error => { settled = true; return error })
      await Promise.resolve()
      assert.equal(settled, false)
      assert.equal(store.byContext('src:scenario/architecture-choice').length, 0)
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get()!['n'], 1)
      store.transaction(() => store.ingest('system HAS size: 9'))
      release()
      assert.equal(await result, fails ? failure : 'evaluated')
      assert.equal(store.currentBeliefs()[0]!.value_text, '9')
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get()!['n'], 2)
    } finally { release(); store.close() }
  }
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

test('winner bindings avoid an unused unresolved query while coexisting bindings retain it', () => {
  const store = open()
  try {
    store.ingest('system IS ready')
    let reads = 0
    const measured = { ...store, db: { ...store.db, exec: store.db.exec.bind(store.db), prepare: (sql: string) => {
      if (sql.includes('ORDER BY c.tx')) reads++
      return store.db.prepare(sql)
    } } }
    const binding: Model.Binding = { id: 'ready', query: 'system IS ready',
      expected: { kind: 'boolean' }, cardinality: 'one', scenarioOverride: false, policies: policies() }
    for (const resolution of ['winner', 'coexisting'] as const) {
      reads = 0
      const result = bind(measured, baseDefinition({ snapshot: { ...snapshot, resolution }, bindings: [binding] }))
      assert.deepEqual(result.values['ready'], { kind: 'boolean', value: true })
      assert.equal(result.supportingRowIds.length, 1)
      assert.equal(reads, resolution === 'winner' ? 1 : 2)
    }
  } finally { store.close() }
})

test('malformed definition containers fail with a classified error before database access', () => {
  const binding = {
    id: 'status', query: 'system HAS status: ?value', select: 'value',
    expected: { kind: 'text' }, cardinality: 'one', scenarioOverride: false, policies: policies()
  }
  const malformed: unknown[] = [null, [], {},
    baseDefinition({ snapshot: null as never }),
    baseDefinition({ snapshot: [] as never }),
    baseDefinition({ bindings: null as never }),
    baseDefinition({ bindings: {} as never }),
    baseDefinition({ bindings: [null as never] }),
    baseDefinition({ bindings: new Array(1) }),
    baseDefinition({ bindings: [42 as never] }),
    baseDefinition({ bindings: [{ ...binding, expected: null } as never] }),
    baseDefinition({ bindings: [{ ...binding, expected: [] } as never] }),
    baseDefinition({ bindings: [{ ...binding, policies: null } as never] }),
    baseDefinition({ bindings: [{ ...binding, policies: [] } as never] }),
    baseDefinition({ bindings: [{ ...binding, query: 42 } as never] }),
    baseDefinition({ overlay: 42 as never })
  ]
  const store = open()
  store.close()
  for (const definition of malformed) {
    assert.throws(() => bind(store, definition as Model.Definition), error =>
      error instanceof ScenarioInputError && error.code === 'invalid-definition', JSON.stringify(definition))
  }
})

test('numeric target units are validated even when optional bindings have no candidates', () => {
  const store = open()
  try {
    for (const kind of ['integer', 'number'] as const) {
      for (const unit of [null, 42, false, {}, [], '']) {
        const definition = baseDefinition({ bindings: [{
          id: 'duration', query: 'missing HAS duration: ?n', select: 'n',
          expected: { kind, unit: unit as never }, cardinality: 'optional',
          scenarioOverride: false, policies: policies({ missing: 'omit' })
        }] })
        assert.throws(() => bind(store, definition), error =>
          error instanceof ScenarioInputError && error.code === 'invalid-definition' && error.bindingId === 'duration')
      }
    }
  } finally { store.close() }
})

test('bound input values and evidence are immutable during evaluator handoff', async () => {
  const store = open()
  try {
    store.ingest('system HAS status: ready')
    const authoredSnapshot = { ...snapshot, metadata: { label: 'caller-owned' } }
    const definition = baseDefinition({ snapshot: authoredSnapshot, bindings: [{
      id: 'status', query: 'system HAS status: ?value', select: 'value',
      expected: { kind: 'text' }, cardinality: 'one', scenarioOverride: false, policies: policies()
    }] })
    const inputs = bind(store, definition)
    assert.equal(Object.isFrozen(authoredSnapshot), false)
    assert.equal(Object.isFrozen(authoredSnapshot.metadata), false)
    assert.equal(Object.hasOwn(inputs.snapshot, 'metadata'), false, 'only snapshot contract fields are published')
    const before = JSON.stringify(inputs)
    const pending: unknown[] = [inputs]
    const seen = new Set<object>()
    while (pending.length > 0) {
      const value = pending.pop()
      if (value === null || typeof value !== 'object' || seen.has(value)) continue
      seen.add(value)
      assert.equal(Object.isFrozen(value), true, 'every nested input object and array is frozen')
      pending.push(...Object.values(value))
    }
    assert.throws(() => { (inputs.values.status as { value: string }).value = 'changed' }, TypeError)
    assert.throws(() => { (inputs.supportingRowIds as string[]).push('invented') }, TypeError)
    assert.equal(JSON.stringify(inputs), before)
    assert.doesNotThrow(() => explanationContext(definition, inputs))
    await run(store, definition, async record => {
      await Promise.resolve()
      assert.throws(() => { (record.snapshot as { minimumConfidence: number }).minimumConfidence = 0 }, TypeError)
      assert.doesNotThrow(() => explanationContext(definition, record))
    })
  } finally { store.close() }
})

test('scenario conversion and aggregation retain long coprime fractions exactly', () => {
  let a = 0n, b = 1n
  for (let index = 0; index < 5000; index++) [a, b] = [b, a + b]
  assert.notEqual(b % 3n, 0n)
  const store = open()
  try {
    store.ingest('first HAS duration: 1s\nsecond HAS duration: 2s')
    const result = bind(store, baseDefinition({ bindings: [{
      id: 'duration', query: '?item HAS duration: ?value', select: 'value',
      expected: { kind: 'number', unit: 'ms', conversions: [{
        from: 's', to: 'ms', factor: { numerator: String(a), denominator: String(b) }
      }] }, cardinality: 'many', reduce: 'sum', scenarioOverride: false, policies: policies()
    }] }))
    assert.deepEqual(result.values['duration'], {
      kind: 'number', value: { numerator: String(3n * a), denominator: String(b) }, unit: 'ms', approximate: false
    })
    assert.equal(store.currentBeliefs().length, 2)
  } finally { store.close() }
})

test('conversion failures preserve history and allow corrected overlay bindings', () => {
  const store = open()
  try {
    store.ingest('job HAS duration: 2 s')
    const binding: Model.Binding = {
      id: 'duration', query: 'job HAS duration: ?value', select: 'value',
      expected: { kind: 'integer', unit: 'ms', conversions: [{ from: 's', to: 'ms', factor: '2' }] },
      cardinality: 'one', scenarioOverride: true, policies: policies()
    }
    const overlay = 'job HAS duration: 1.5 s'
    const definition = baseDefinition({ overlay, bindings: [binding] })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const valid = bind(store, definition)
    assert.deepEqual(valid.values['duration'], {
      kind: 'integer', value: '3', unit: 'ms', authored: '1.5 s', approximate: false
    })
    for (const [factor, code] of [
      ['0', 'invalid-definition'], ['-1', 'invalid-definition'],
      [{ numerator: '1', denominator: '0' }, 'invalid-definition'],
      ['not-exact', 'invalid-definition'], ['1', 'invalid-value']
    ] as const) {
      const failed = baseDefinition({ overlay, bindings: [{ ...binding,
        expected: { kind: 'integer', unit: 'ms', conversions: [{ from: 's', to: 'ms', factor }] }
      }] })
      assert.throws(() => bind(store, failed), error =>
        error instanceof ScenarioInputError && error.code === code && error.bindingId === 'duration')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(bind(store, definition), valid)
    }
    for (const failed of [
      { ...definition, bindings: [{ ...binding, expected: { kind: 'integer' as const, unit: 'ms' } }] },
      { ...definition, overlay: 'job HAS duration: 1.5' }
    ]) {
      assert.throws(() => bind(store, failed), error =>
        error instanceof ScenarioInputError && error.code === 'incompatible-unit' && error.bindingId === 'duration')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(bind(store, definition), valid)
    }
    store.ingest('job HAS duration: 4 s')
    const current = bind(store, { ...definition, overlay: undefined })
    assert.deepEqual(current.values['duration'], {
      kind: 'integer', value: '8', unit: 'ms', authored: '4 s', approximate: false
    })
  } finally { store.close() }
})

test('min and max preserve negative converted differences below floating-point precision', () => {
  const store = open()
  try {
    assert.deepEqual(store.ingest('first HAS offset: -1.0000000000000000001 s\nsecond HAS offset: -1 s').problems, [])
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const factor of ['1000', { numerator: '-1000', denominator: '-1' }] as const) {
      for (const [reduce, numerator, denominator] of [
        ['min', '-10000000000000000001', '10000000000000000'],
        ['max', '-1000', '1']
      ] as const) {
        const definition = baseDefinition({ bindings: [{
          id: 'offset', query: '?item HAS offset: ?value', select: 'value',
          expected: { kind: 'number', unit: 'ms', conversions: [{ from: 's', to: 'ms', factor }] },
          cardinality: 'many', reduce, scenarioOverride: false, policies: policies()
        }] })
        const record = bind(store, definition)
        const value = record.values['offset'] as Extract<Model.Value, { kind: 'number' }>
        assert.equal(value.kind, 'number')
        assert.deepEqual(value.value, { numerator, denominator })
        assert.equal(value.unit, 'ms')
        assert.equal(record.supportingRowIds.length, 2)
        assert.deepEqual(bind(store, definition), record)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
    }
  } finally { store.close() }
})

test('min and max retain exact converted ordering across comparison shortcuts', () => {
  for (const [left, right, minimum, maximum] of [
    ['-1', '1', ['-1', '3'], ['1', '7']],
    ['1', '1', ['1', '7'], ['1', '3']],
    ['-1', '-1', ['-1', '3'], ['-1', '7']],
    ['0', '1', ['0', '1'], ['1', '7']]
  ] as const) {
    const store = open()
    try {
      const input = store.ingest(`first HAS offset: ${left} s\nsecond HAS offset: ${right} ms`)
      assert.deepEqual(input.problems, [])
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const [reduce, expected] of [['min', minimum], ['max', maximum]] as const) {
        const definition = baseDefinition({ bindings: [{
          id: 'offset', query: '?item HAS offset: ?value', select: 'value',
          expected: { kind: 'number', unit: 'unit', conversions: [
            { from: 's', to: 'unit', factor: { numerator: '1', denominator: '3' } },
            { from: 'ms', to: 'unit', factor: { numerator: '1', denominator: '7' } }
          ] },
          cardinality: 'many', reduce, scenarioOverride: false, policies: policies()
        }] })
        const record = bind(store, definition)
        const value = record.values['offset'] as Extract<Model.Value, { kind: 'number' }>
        assert.deepEqual(value.value, { numerator: expected[0], denominator: expected[1] })
        assert.equal(value.unit, 'unit')
        assert.deepEqual(new Set(record.supportingRowIds), new Set(input.ids))
        assert.deepEqual(bind(store, definition), record)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
    } finally { store.close() }
  }
})
