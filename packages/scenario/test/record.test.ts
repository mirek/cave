import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { emitClaim } from '@cavelang/canonical'
import { Adapter, Explain, Model, Solve } from '@cavelang/solver'
import { bind, Model as ScenarioModel, Record, run } from '@cavelang/scenario'

const model: Model.t = {
  schema: Model.schema,
  variables: [{ id: 'architecture', sort: 'bool' }],
  constraints: [{ id: 'allowed', expression: { kind: 'variable', id: 'architecture' } }]
}

const adapter: Adapter.t = {
  backend: { name: 'test-solver', version: '1.0.0' },
  capabilities: new Set(['booleans']),
  solve: async () => ({
    status: 'satisfied',
    backend: { name: 'test-solver', version: '1.0.0' },
    diagnostics: [],
    elapsedMs: 2,
    assignment: { architecture: { sort: 'bool', value: true } }
  })
}

const report = async (): Promise<Explain.Report> =>
  Solve.runWithExplanation(adapter, model, {}, {
    snapshot: { transactionTime: null },
    inputs: []
  })

const count = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS count FROM cave_claim').get() as { count: number }).count

const evaluation = (store: ReturnType<typeof open>): Record.Evaluation => ({
  schema: Record.evaluationSchema, id: 'evaluation',
  inputs: bind(store, { id: 'empty-scenario', modelDigest: `sha256:${'0'.repeat(64)}`,
    snapshot: { aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5 }, bindings: [] }),
  evaluator: { name: 'test-evaluator', version: '1.0.0' }, output: null
})

test('a caller transaction records a complete decision chain or rolls it back for corrected retry', () => {
  const store = open()
  try {
    store.ingest('retained IS knowledge')
    const result = evaluation(store)
    const recommendation: Record.Recommendation = {
      schema: Record.recommendationSchema, id: 'recommendation', resultId: result.id, value: 'selected'
    }
    const decision: Record.Decision = {
      schema: Record.decisionSchema, id: 'decision', resultId: result.id,
      recommendationId: recommendation.id, selected: 'selected', decidedBy: 'human/reviewer'
    }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => store.transaction(() => {
      assert.equal(Record.result(store, result).status, 'recorded')
      assert.equal(Record.recommendation(store, recommendation).status, 'recorded')
      Record.decision(store, { ...decision, decidedBy: '' })
    }), /decision decidedBy must be a non-empty string/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    for (const [kind, id] of [['result', result.id], ['recommendation', recommendation.id],
      ['decision', decision.id]] as const) {
      assert.throws(() => Record.read(store, kind, id), Record.MissingRecordError)
    }
    const recordChain = () => store.transaction(() => [
      Record.result(store, result),
      Record.recommendation(store, recommendation),
      Record.decision(store, decision)
    ])
    assert.deepEqual(recordChain().map(outcome => outcome.status), ['recorded', 'recorded', 'recorded'])
    assert.deepEqual(Record.read(store, 'decision', decision.id), decision)
    const committed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.deepEqual(recordChain().map(outcome => outcome.status), ['existing', 'existing', 'existing'])
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), committed)
  } finally { store.close() }
})

test('reading imported evaluation results validates identity and input integrity', () => {
  const store = open()
  try {
    const valid = evaluation(store)
    const put = (artifact: unknown) => {
      const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
      store.ingest(`scenario-result/evaluation HAS artifact: \`${payload}\` @src:scenario/result`)
    }
    for (const [artifact, message] of [
      [{ ...valid, evaluator: { name: '', version: '1' } }, /evaluator name and version/],
      [{ ...valid, output: undefined }, /evaluation output is required/],
      [{ ...valid, inputs: { ...valid.inputs, scenarioId: 'tampered' } }, /input digest does not match/]
    ] as const) {
      put(artifact)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, 'result', valid.id), message)
      assert.throws(() => Record.recommendation(store, {
        schema: Record.recommendationSchema, id: 'proposal', resultId: valid.id, value: null
      }), message)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      put(valid)
      assert.deepEqual(Record.read(store, 'result', valid.id), valid)
    }
  } finally { store.close() }
})

test('imported governance records enforce required values and statuses on read', () => {
  const store = open()
  try {
    const cases = [
      ['recommendation', 'scenario-recommendation', 'scenario/recommendation',
        { schema: Record.recommendationSchema, id: 'item', resultId: 'result', value: null }, 'value', /recommendation value/],
      ['decision', 'scenario-decision', 'scenario/decision',
        { schema: Record.decisionSchema, id: 'item', resultId: 'result', selected: null, decidedBy: 'reviewer' }, 'decidedBy', /decision decidedBy/],
      ['action', 'scenario-action', 'scenario/action',
        { schema: Record.actionSchema, id: 'item', decisionId: 'decision', name: 'deploy', parameters: null, status: 'validated' }, 'status', /action status/],
      ['external-effect', 'scenario-effect', 'scenario/external-effect',
        { schema: Record.externalEffectSchema, id: 'item', actionId: 'action', kind: 'deployment', status: 'unknown' }, 'status', /external effect status/]
    ] as const
    for (const [kind, prefix, source, valid, field, message] of cases) {
      const put = (artifact: unknown) => {
        const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
        store.ingest(`${prefix}/item HAS artifact: \`${payload}\` @src:${source}`)
      }
      put({ ...valid, [field]: undefined })
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, kind, 'item'), message)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      put(valid)
      assert.deepEqual(Record.read(store, kind, 'item'), valid)
    }
  } finally { store.close() }
})

test('imported governance records reject malformed predecessor identifiers', () => {
  const store = open()
  try {
    const cases = [
      ['recommendation', 'scenario-recommendation', 'scenario/recommendation',
        { schema: Record.recommendationSchema, id: 'item', resultId: 'result', value: null }, 'resultId', /result id/],
      ['decision', 'scenario-decision', 'scenario/decision',
        { schema: Record.decisionSchema, id: 'item', resultId: 'result', selected: null, decidedBy: 'reviewer' }, 'resultId', /result id/],
      ['decision', 'scenario-decision', 'scenario/decision',
        { schema: Record.decisionSchema, id: 'item', resultId: 'result', recommendationId: 'proposal', selected: null, decidedBy: 'reviewer' }, 'recommendationId', /recommendation id/],
      ['action', 'scenario-action', 'scenario/action',
        { schema: Record.actionSchema, id: 'item', decisionId: 'decision', name: 'deploy', parameters: null, status: 'validated' }, 'decisionId', /decision id/],
      ['external-effect', 'scenario-effect', 'scenario/external-effect',
        { schema: Record.externalEffectSchema, id: 'item', actionId: 'action', kind: 'deployment', status: 'unknown' }, 'actionId', /action id/]
    ] as const
    for (const [kind, prefix, source, valid, field, message] of cases) {
      const put = (artifact: unknown) => {
        const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
        store.ingest(`${prefix}/item HAS artifact: \`${payload}\` @src:${source}`)
      }
      for (const value of ['', null, false, 1, [], {}]) {
        put({ ...valid, [field]: value })
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, kind, 'item'), message)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      put(valid)
      assert.deepEqual(Record.read(store, kind, 'item'), valid)
    }
  } finally { store.close() }
})

test('optional governance text rejects non-strings on recording and imported reads', () => {
  const cases = [
    ['recommendation', 'scenario-recommendation', { schema: Record.recommendationSchema, id: 'item', resultId: 'evaluation', value: null }, 'rationale'],
    ['recommendation', 'scenario-recommendation', { schema: Record.recommendationSchema, id: 'item', resultId: 'evaluation', value: null }, 'authoredBy'],
    ['decision', 'scenario-decision', { schema: Record.decisionSchema, id: 'item', resultId: 'evaluation', selected: null, decidedBy: 'reviewer' }, 'rationale'],
    ['action', 'scenario-action', { schema: Record.actionSchema, id: 'item', decisionId: 'parent', name: 'deploy', parameters: null, status: 'validated' }, 'message']
  ] as const
  for (const [kind, prefix, valid, field] of cases) {
    const store = open()
    try {
      Record.result(store, evaluation(store))
      Record.decision(store, { schema: Record.decisionSchema, id: 'parent', resultId: 'evaluation', selected: null, decidedBy: 'reviewer' })
      const expected = new RegExp(`${kind} ${field} must be a string`)
      const put = (value: unknown) => {
        const payload = Buffer.from(JSON.stringify({ ...valid, id: 'imported', [field]: value })).toString('base64url')
        store.ingest(`${prefix}/imported HAS artifact: \`${payload}\` @src:scenario/${kind}`)
      }
      const advance = () => kind === 'recommendation'
        ? Record.decision(store, { schema: Record.decisionSchema, id: 'child', resultId: 'evaluation', recommendationId: 'imported', selected: null, decidedBy: 'reviewer' })
        : kind === 'decision'
          ? Record.action(store, { schema: Record.actionSchema, id: 'child', decisionId: 'imported', name: 'deploy', parameters: null, status: 'validated' })
          : Record.externalEffect(store, { schema: Record.externalEffectSchema, id: 'child', actionId: 'imported', kind: 'deployment', status: 'unknown' })
      for (const value of [null, false, 42, [], {}]) {
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record[kind](store, { ...valid, [field]: value } as never), expected)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        put(value)
        const imported = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, kind, 'imported'), expected)
        assert.throws(advance, expected, 'malformed immediate predecessors cannot support new records')
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), imported)
      }
      assert.equal(Record[kind](store, valid as never).status, 'recorded')
      assert.equal(Record[kind](store, valid as never).status, 'existing')
      for (const value of ['', 'reviewed ✓']) {
        put(value)
        assert.deepEqual(Record.read(store, kind, 'imported'), { ...valid, id: 'imported', [field]: value })
      }
      assert.equal(advance().status, 'recorded', 'corrected predecessor permits the previously rejected child ID')
      const committed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(advance().status, 'existing')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), committed)
    } finally { store.close() }
  }
})

test('reading recorded artifacts rejects malformed UTF-8 and preserves valid replacement characters', () => {
  const store = open()
  try {
    const artifact = { ...evaluation(store), output: 'marker' }
    const json = JSON.stringify(artifact)
    for (const invalid of [Buffer.from([0xff]), Buffer.from([0xc0, 0xaf])]) {
      const [before, after] = json.split('marker')
      const payload = Buffer.concat([Buffer.from(before!), invalid, Buffer.from(after!)]).toString('base64url')
      store.ingest(`scenario-result/evaluation HAS artifact: \`${payload}\` @src:scenario/result`)
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, 'result', 'evaluation'), /not valid base64url JSON/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    }
    const valid = { ...artifact, id: 'valid', output: 'café � 😀' }
    Record.result(store, valid)
    assert.deepEqual(Record.read(store, 'result', 'valid'), valid)
  } finally { store.close() }
})

test('artifact reads validate base64url syntax and padding before decoding', () => {
  const store = open()
  try {
    const artifact = evaluation(store)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    for (const suffix of ['', ' ', '  ']) {
      const encoded = Buffer.from(JSON.stringify(artifact) + suffix).toString('base64url')
      const padding = (4 - encoded.length % 4) % 4
      const invalid = ['!' + encoded, encoded.slice(0, 8) + '%' + encoded.slice(8), encoded + '===']
      if (padding > 0) invalid.push(encoded.slice(0, -1) + alphabet[alphabet.indexOf(encoded.at(-1)!) + 1])
      for (const payload of invalid) {
        store.ingest(`scenario-result/evaluation HAS artifact: \`${payload}\` @src:scenario/result`)
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, 'result', 'evaluation'), /not valid base64url JSON/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      for (const payload of [encoded, encoded + '='.repeat(padding)]) {
        store.ingest(`scenario-result/evaluation HAS artifact: \`${payload}\` @src:scenario/result`)
        assert.deepEqual(Record.read(store, 'result', 'evaluation'), artifact)
      }
    }
  } finally { store.close() }
})

test('recording captures predecessor getters once for validation and storage', () => {
  const store = open()
  try {
    Record.result(store, evaluation(store))
    let reads = 0
    const artifact: Record.Recommendation = {
      schema: Record.recommendationSchema, id: 'recommendation', value: null,
      get resultId() { return ++reads === 1 ? 'evaluation' : 'missing' }
    }
    const outcome = Record.recommendation(store, artifact)
    assert.equal(reads, 1)
    const stored = Record.read<Record.Recommendation>(store, 'recommendation', artifact.id)
    assert.equal(stored.resultId, 'evaluation')
    assert.deepEqual(outcome.artifact, stored)
  } finally { store.close() }
})

test('imported artifacts reject overflowing JSON numbers at any payload depth', () => {
  const store = open()
  try {
    const put = (value: string) => {
      const json = `{"schema":"${Record.recommendationSchema}","id":"overflow","resultId":"result","value":${value}}`
      const payload = Buffer.from(json).toString('base64url')
      store.ingest(`scenario-recommendation/overflow HAS artifact: \`${payload}\` @src:scenario/recommendation`)
    }
    for (const token of ['1e400', '-1e400', '1e309']) {
      for (const value of [token, `{"nested":[${token}]}`]) {
        put(value)
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, 'recommendation', 'overflow'), /not valid base64url JSON/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
    }
    put('{"nested":[1e308,null]}')
    assert.deepEqual((Record.read(store, 'recommendation', 'overflow') as Record.Recommendation).value,
      { nested: [1e308, null] })
  } finally { store.close() }
})

test('imported deeply nested finite JSON remains readable', () => {
  const store = open()
  try {
    const depth = 5000
    const json = `{"schema":"${Record.recommendationSchema}","id":"deep","resultId":"result","value":${'['.repeat(depth)}1${']'.repeat(depth)}}`
    const payload = Buffer.from(json).toString('base64url')
    store.ingest(`scenario-recommendation/deep HAS artifact: \`${payload}\` @src:scenario/recommendation`)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let value: unknown = (Record.read(store, 'recommendation', 'deep') as Record.Recommendation).value
    for (let index = 0; index < depth; index++) {
      assert.ok(Array.isArray(value))
      assert.equal(value.length, 1)
      value = value[0]
    }
    assert.equal(value, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('recording captures identity and returns the stored JSON snapshot', () => {
  const store = open()
  try {
    const original = evaluation(store)
    const output = { score: 1 }
    let reads = 0
    const artifact: Record.Evaluation = { ...original, output,
      get id() { return ++reads === 1 ? 'stable' : 'changed' }
    }
    const outcome = Record.result(store, artifact)
    assert.equal(reads, 1)
    output.score = 2
    const stored = Record.read(store, 'result', 'stable')
    assert.deepEqual(outcome.artifact, stored)
    assert.deepEqual((outcome.artifact as Record.Evaluation).output, { score: 1 })
    assert.throws(() => Record.read(store, 'result', 'changed'), Record.MissingRecordError)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const returnedOutput = (outcome.artifact as Record.Evaluation).output as { score: number }
    returnedOutput.score = 3
    assert.deepEqual(Record.read(store, 'result', 'stable'), stored)
    assert.equal(Record.result(store, stored as Record.Evaluation).status, 'existing')
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('evaluation recording requires a complete evaluator identity', () => {
  const store = open()
  try {
    const artifact = evaluation(store)
    for (const key of ['name', 'version']) {
      for (const value of [undefined, null, '', 1, true]) {
        const invalid = { ...artifact, evaluator: { ...artifact.evaluator, [key]: value } } as unknown as Record.Evaluation
        assert.throws(() => Record.result(store, invalid), /evaluator name and version/)
        assert.equal(count(store), 0)
      }
    }
    for (const evaluator of [null, undefined]) {
      assert.throws(() => Record.result(store, { ...artifact, evaluator } as unknown as Record.Evaluation),
        /evaluator name and version/)
      assert.equal(count(store), 0)
    }
  } finally { store.close() }
})

test('evaluation recording verifies the input content digest', () => {
  const store = open()
  try {
    const artifact = evaluation(store)
    const changed = { ...artifact, inputs: { ...artifact.inputs, scenarioId: 'changed' } }
    assert.throws(() => Record.result(store, changed), /input digest does not match/)
    assert.equal(count(store), 0)
    assert.equal(Record.result(store, artifact).status, 'recorded')
    assert.deepEqual(Record.read(store, 'result', artifact.id), artifact)
  } finally { store.close() }
})

test('evaluation output is required and explicit null remains valid', () => {
  const store = open()
  try {
    const artifact = evaluation(store)
    assert.throws(() => Record.result(store, { ...artifact, output: undefined } as unknown as Record.Evaluation),
      /evaluation output is required/)
    assert.equal(count(store), 0)
    assert.equal(Record.result(store, artifact).status, 'recorded')
    assert.equal(Record.read<Record.Evaluation>(store, 'result', artifact.id).output, null)
  } finally { store.close() }
})

test('governance records reject missing payloads, identities and invalid statuses', async t => {
  const store = open()
  try {
    Record.result(store, evaluation(store))
    const decision: Record.Decision = { schema: Record.decisionSchema, id: 'decision',
      resultId: 'evaluation', selected: null, decidedBy: 'reviewer' }
    Record.decision(store, decision)
    const action: Record.Action = { schema: Record.actionSchema, id: 'action',
      decisionId: 'decision', name: 'inspect', parameters: null, status: 'validated' }
    Record.action(store, action)
    const recommendation: Record.Recommendation = { schema: Record.recommendationSchema,
      id: 'recommendation', resultId: 'evaluation', value: null }
    const effect: Record.ExternalEffect = { schema: Record.externalEffectSchema,
      id: 'effect', actionId: 'action', kind: 'inspection', status: 'unknown' }
    const cases = [
      [Record.recommendation, recommendation, 'value', [undefined]],
      [Record.decision, decision, 'selected', [undefined]],
      [Record.decision, decision, 'decidedBy', [undefined, null, '', 1]],
      [Record.action, action, 'parameters', [undefined]],
      [Record.action, action, 'name', [undefined, null, '', 1]],
      [Record.action, action, 'status', [undefined, 'succeeded', 'typo']],
      [Record.externalEffect, effect, 'kind', [undefined, null, '', 1]],
      [Record.externalEffect, effect, 'status', [undefined, 'executed', 'typo']]
    ] as const
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const [method, artifact, field, values] of cases) {
      await t.test(`${artifact.schema} requires valid ${field}`, () => {
        for (const value of values) {
          const invoke = method as (store: ReturnType<typeof open>, artifact: unknown) => Record.RecordOutcome
          assert.throws(() => invoke(store, { ...artifact, id: 'invalid-record', [field]: value }), TypeError)
          assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
      })
    }
    Record.recommendation(store, recommendation)
    assert.equal(Record.read<Record.Recommendation>(store, 'recommendation', recommendation.id).value, null)
    for (const status of ['validated', 'executed', 'failed'] as const) {
      const valid = { ...action, id: `action-${status}`, status }
      Record.action(store, valid)
      assert.deepEqual(Record.read(store, 'action', valid.id), valid)
    }
    for (const status of ['succeeded', 'failed', 'unknown'] as const) {
      const valid = { ...effect, id: `effect-${status}`, status }
      Record.externalEffect(store, valid)
      assert.deepEqual(Record.read(store, 'external-effect', valid.id), valid)
    }
  } finally { store.close() }
})

test('recording methods reject mismatched artifact schemas before opening a transaction', t => {
  const store = open()
  try {
    const transaction = store.transaction.bind(store)
    let transactions = 0
    t.mock.method(store, 'transaction', <T>(body: () => T): T => {
      transactions += 1
      return transaction(body)
    })
    const methods = [Record.result, Record.recommendation, Record.decision, Record.action, Record.externalEffect]
    for (const method of methods) {
      const wrongSchema = method === Record.result ? Record.actionSchema : Record.resultSchema
      const invoke = method as (store: ReturnType<typeof open>, artifact: unknown) => Record.RecordOutcome
      for (const schema of [wrongSchema, 'cave.scenario/unknown@1', undefined]) {
        assert.throws(() => invoke(store, { schema, id: 'wrong-method', decisionId: 'missing',
          name: 'deploy', parameters: {}, status: 'executed' }), /unsupported .* artifact schema/)
      }
      for (const artifact of [null, undefined, 'artifact', 1]) {
        assert.throws(() => invoke(store, artifact), /unsupported .* artifact schema/)
      }
    }
    assert.equal(transactions, 0)
    assert.equal(count(store), 0)
  } finally { store.close() }
})

test('artifact serialization rejects lossy non-JSON values without writing', async () => {
  const store = open()
  try {
    Record.result(store, { schema: Record.resultSchema, id: 'json-run', report: await report() })
    const cycle: { [key: string]: unknown } = {}
    cycle['self'] = cycle
    for (const value of [new Array(1), [undefined], new Date(0), new Map([['a', 1]]), new Set([1]), cycle, NaN, 1n]) {
      assert.throws(() => Record.recommendation(store, {
        schema: Record.recommendationSchema, id: 'json-proposal', resultId: 'json-run',
        value: value as Explain.Json
      }), TypeError)
      assert.equal(count(store), 1)
    }
    const shared = { answer: 42 }
    const value = { b: shared, a: shared, optional: undefined }
    const artifact: Record.Recommendation = {
      schema: Record.recommendationSchema, id: 'json-proposal', resultId: 'json-run', value
    }
    assert.equal(Record.recommendation(store, artifact).status, 'recorded')
    assert.equal(Record.recommendation(store, { ...artifact, value: { a: { answer: 42 }, b: { answer: 42 } } }).status, 'existing')
    assert.deepEqual(Record.read<Record.Recommendation>(store, 'recommendation', artifact.id).value,
      { a: { answer: 42 }, b: { answer: 42 } })
  } finally {
    store.close()
  }
})

test('artifact arrays use indexed JSON values instead of custom iterators', () => {
  const store = open()
  try {
    const base = evaluation(store)
    let iterations = 0
    const dense = [1, 2]
    dense[Symbol.iterator] = () => { iterations++; return [99].values() }
    const outcome = Record.result(store, { ...base, output: dense })
    assert.deepEqual((outcome.artifact as Record.Evaluation).output, [1, 2])
    assert.deepEqual(Record.read<Record.Evaluation>(store, 'result', base.id).output, [1, 2])
    const sparse = new Array<number>(1)
    sparse[Symbol.iterator] = () => { iterations++; return [99].values() }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.result(store, { ...base, id: 'sparse', output: sparse }), /artifact.output\[0\] is not JSON/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(iterations, 0)
  } finally { store.close() }
})

test('artifact identities cannot introduce extra claims or change their stored subject', async () => {
  const store = open()
  try {
    const explanation = await report()
    for (const id of ['run IS service\ninjected', 'run ; hidden suffix', ' run', 'run\n', 'run\tname']) {
      assert.throws(() => Record.result(store, { schema: Record.resultSchema, id, report: explanation }), TypeError, id)
      assert.equal(count(store), 0, id)
    }
    const artifact: Record.Result = { schema: Record.resultSchema, id: 'team/run-1', report: explanation }
    assert.equal(Record.result(store, artifact).status, 'recorded')
    assert.deepEqual(Record.read(store, 'result', artifact.id), artifact)
    assert.throws(() => Record.read(store, 'result', 'team/run-1 IS service\nother'), TypeError)
    assert.throws(() => Record.recommendation(store, {
      schema: Record.recommendationSchema,
      id: 'proposal IS service\ninjected', resultId: artifact.id, value: 'keep'
    }), TypeError)
    assert.equal(count(store), 1, 'invalid reads and successor writes preserve the valid result')
  } finally {
    store.close()
  }
})

test('solver evaluation is ephemeral until result recording is explicit', async () => {
  const store = open()
  const evaluated = await report()
  assert.equal(count(store), 0)

  const artifact: Record.Result = {
    schema: Record.resultSchema,
    id: 'architecture-2026-07-15',
    report: evaluated
  }
  const first = Record.result(store, artifact)
  assert.equal(first.status, 'recorded')
  assert.equal(count(store), 1)

  const again = Record.result(store, artifact)
  assert.equal(again.status, 'existing')
  assert.equal(again.rowId, first.rowId)
  assert.equal(count(store), 1, 'idempotent recording appends no duplicate row')
  assert.deepEqual(Record.read<Record.Result>(store, 'result', artifact.id), artifact)
  store.close()
})

test('ordinary deterministic evaluation drives an explicit recommendation and decision', async () => {
  const store = open()
  store.ingest('system HAS team-size: 8 people')
  const definition: ScenarioModel.Definition = {
    id: 'architecture-choice',
    modelDigest: `sha256:${'1'.repeat(64)}`,
    snapshot: {
      aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5
    },
    overlay: 'system HAS team-size: 12 people',
    bindings: [{
      id: 'team-size',
      query: 'system HAS team-size: ?n',
      select: 'n',
      expected: { kind: 'integer', unit: 'people' },
      cardinality: 'one',
      scenarioOverride: true,
      policies: {
        missing: 'reject', contested: 'reject', retracted: 'exclude', unresolved: 'reject'
      }
    }]
  }

  const evaluation = await run(store, definition, inputs => {
    const teamSize = inputs.values['team-size'] as Extract<ScenarioModel.Value, { kind: 'integer' }>
    return {
      schema: Record.evaluationSchema,
      id: 'architecture-evaluation',
      inputs,
      evaluator: { name: 'architecture-threshold', version: '1.0.0' },
      output: { architecture: BigInt(teamSize.value) <= 15n ? 'monolith' : 'services' }
    } satisfies Record.Evaluation
  })

  assert.equal(store.currentBeliefs().find(row => row.attribute === 'team-size')?.value_text, '8 people',
    'the hypothetical team size rolled back before evaluation returned')
  Record.result(store, evaluation)
  Record.recommendation(store, {
    schema: Record.recommendationSchema,
    id: 'architecture-recommendation',
    resultId: evaluation.id,
    value: evaluation.output,
    rationale: 'small teams minimize coordination overhead in one deployment unit'
  })
  Record.decision(store, {
    schema: Record.decisionSchema,
    id: 'architecture-decision',
    resultId: evaluation.id,
    recommendationId: 'architecture-recommendation',
    selected: evaluation.output,
    decidedBy: 'human/mirek'
  })

  assert.equal(Record.read<Record.Evaluation>(store, 'result', evaluation.id).inputs.digest,
    evaluation.inputs.digest)
  assert.deepEqual(Record.read<Record.Decision>(store, 'decision', 'architecture-decision').selected,
    { architecture: 'monolith' })
  assert.throws(() => Record.replay(store, evaluation.id, {
    modelDigest: evaluation.inputs.modelDigest
  }), /external evaluation, not a solver result/)
  store.close()
})

test('a run identity cannot be reused for different solver content', async () => {
  const store = open()
  const artifact: Record.Result = {
    schema: Record.resultSchema,
    id: 'architecture-run',
    report: await report()
  }
  Record.result(store, artifact)
  assert.throws(
    () => Record.result(store, {
      ...artifact,
      report: { ...artifact.report, run: { ...artifact.report.run, elapsedMs: 3 } }
    }),
    Record.RecordConflictError
  )
  assert.equal(count(store), 1)
  store.close()
})

test('retraction keeps artifact identity reserved and only identical content can be restored', async () => {
  const store = open()
  try {
    const artifact: Record.Result = { schema: Record.resultSchema, id: 'retired-run', report: await report() }
    Record.result(store, artifact)
    const original = store.toClaim(store.currentBeliefs()[0]!)
    store.ingest(emitClaim({ ...original, conf: 0 }))
    assert.throws(() => Record.read(store, 'result', artifact.id), Record.MissingRecordError)
    assert.throws(() => Record.result(store, {
      ...artifact, report: { ...artifact.report, run: { ...artifact.report.run, elapsedMs: 99 } }
    }), Record.RecordConflictError)
    assert.equal(count(store), 2)
    assert.equal(Record.result(store, artifact).status, 'recorded')
    assert.deepEqual(Record.read(store, 'result', artifact.id), artifact)
    assert.equal(Record.result(store, artifact).status, 'existing')
    assert.equal(count(store), 3)
    store.ingest(emitClaim(original).replace(/`[^`]*`/, '`e30`'))
    store.ingest(emitClaim(original))
    assert.throws(() => Record.result(store, artifact), Record.RecordConflictError,
      'a matching current payload cannot hide contradictory older history')
    assert.equal(count(store), 5)
  } finally {
    store.close()
  }
})

test('result, recommendation, decision, action and external effect stay separate', async () => {
  const store = open()
  const result: Record.Result = {
    schema: Record.resultSchema,
    id: 'run-1',
    report: await report()
  }
  const recommendation: Record.Recommendation = {
    schema: Record.recommendationSchema,
    id: 'recommendation-1',
    resultId: result.id,
    value: { architecture: 'monolith' },
    rationale: 'lowest operational complexity'
  }
  const decision: Record.Decision = {
    schema: Record.decisionSchema,
    id: 'decision-1',
    resultId: result.id,
    recommendationId: recommendation.id,
    selected: { architecture: 'monolith' },
    decidedBy: 'human/mirek'
  }
  const action: Record.Action = {
    schema: Record.actionSchema,
    id: 'action-1',
    decisionId: decision.id,
    name: 'adopt-architecture',
    parameters: { architecture: 'monolith' },
    status: 'executed'
  }
  const effect: Record.ExternalEffect = {
    schema: Record.externalEffectSchema,
    id: 'effect-1',
    actionId: action.id,
    kind: 'repository-change',
    status: 'succeeded',
    details: { pullRequest: 72 }
  }

  Record.result(store, result)
  Record.recommendation(store, recommendation)
  Record.decision(store, decision)
  Record.action(store, action)
  Record.externalEffect(store, effect)

  assert.deepEqual(store.currentBeliefs().map(row => row.subject), [
    'scenario-result/run-1',
    'scenario-recommendation/recommendation-1',
    'scenario-decision/decision-1',
    'scenario-action/action-1',
    'scenario-effect/effect-1'
  ])
  assert.equal(count(store), 5, 'audit records do not synthesize action effects')
  store.close()
})

test('lifecycle references are checked atomically and missing predecessors permit same-ID retry', async () => {
  const store = open()
  try {
    const result: Record.Result = { schema: Record.resultSchema, id: 'run-1', report: await report() }
    Record.result(store, result)
    const decision: Record.Decision = {
      schema: Record.decisionSchema,
      id: 'decision-with-missing-recommendation',
      resultId: result.id,
      recommendationId: 'missing',
      selected: 'monolith',
      decidedBy: 'human/mirek'
    }
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => Record.decision(store, decision), Record.MissingRecordError)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.throws(() => Record.read(store, 'decision', decision.id), Record.MissingRecordError)
    Record.recommendation(store, {
      schema: Record.recommendationSchema, id: 'missing', resultId: result.id, value: 'monolith'
    })
    const recorded = Record.decision(store, decision)
    assert.equal(recorded.status, 'recorded')
    assert.deepEqual(Record.read(store, 'decision', decision.id), decision)
    const committed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const repeated = Record.decision(store, decision)
    assert.equal(repeated.status, 'existing')
    assert.equal(repeated.rowId, recorded.rowId)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), committed)
    assert.equal(count(store), 3)
  } finally { store.close() }
})

test('solver records require replay identity before recording and reading imports', async () => {
  const store = open()
  try {
    const valid: Record.Result = { schema: Record.resultSchema, id: 'identity', report: await report() }
    const cases = [
      [{ ...valid.report.run, modelDigest: '' }, /solver model digest/],
      [{ ...valid.report.run, modelDigest: null }, /solver model digest/],
      [{ ...valid.report.run, backend: null }, /solver backend name/],
      [{ ...valid.report.run, backend: { name: '', version: '1' } }, /solver backend name/],
      [{ ...valid.report.run, backend: { name: 'fixture', version: 1 } }, /solver backend version/]
    ] as const
    for (const [run, message] of cases) {
      const artifact = { ...valid, report: { ...valid.report, run } } as unknown as Record.Result
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.result(store, artifact), message)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
      store.ingest(`scenario-result/identity HAS artifact: \`${payload}\` @src:scenario/result`)
      const imported = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, 'result', valid.id), message)
      assert.throws(() => Record.replay(store, valid.id, { modelDigest: valid.report.run.modelDigest }), message)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), imported)
    }
    const payload = Buffer.from(JSON.stringify(valid)).toString('base64url')
    store.ingest(`scenario-result/identity HAS artifact: \`${payload}\` @src:scenario/result`)
    assert.equal(Record.replay(store, valid.id, { modelDigest: valid.report.run.modelDigest }).compatible, true)
  } finally { store.close() }
})

test('replay rejects malformed expected identities before store reads and accepts corrected expectations', async t => {
  const store = open()
  try {
    const artifact: Record.Result = { schema: Record.resultSchema, id: 'expected-identity', report: await report() }
    Record.result(store, artifact)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const valid = { modelDigest: artifact.report.run.modelDigest, backend: artifact.report.run.backend }
    const cases: [unknown, RegExp][] = [
      ...[null, [], 1, 'model'].map(value => [value, /replay expectations must be an object/] as [unknown, RegExp]),
      ...[undefined, null, '', 1, false, {}, []].map(value => [{ ...valid, modelDigest: value }, /expected model digest/] as [unknown, RegExp]),
      ...[null, [], 1, 'solver'].map(value => [{ ...valid, backend: value }, /expected backend must be an object/] as [unknown, RegExp]),
      ...['name', 'version'].flatMap(field => [undefined, null, '', 1, false, {}, []].map(value =>
        [{ ...valid, backend: { ...valid.backend, [field]: value } }, new RegExp(`expected backend ${field}`)] as [unknown, RegExp]))
    ]
    const blocked = t.mock.method(store.db, 'prepare', () => { throw new Error('invalid expectations must not read the store') })
    for (const [expected, message] of cases) {
      assert.throws(() => Record.replay(store, artifact.id, expected as Record.ReplayExpectation), message)
    }
    blocked.mock.restore()
    assert.equal(Record.replay(store, artifact.id, valid).compatible, true)
    assert.equal(Record.replay(store, artifact.id, { modelDigest: valid.modelDigest }).compatible, true)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { t.mock.restoreAll(); store.close() }
})

test('replay captures compatibility expectations once for checks and diagnostics', async () => {
  const store = open()
  try {
    const artifact: Record.Result = { schema: Record.resultSchema, id: 'captured-replay', report: await report() }
    Record.result(store, artifact)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let models = 0, backends = 0, names = 0, versions = 0
    const backend = {
      get name() { names++; return names === 1 ? 'other-solver' : artifact.report.run.backend.name },
      get version() { versions++; return versions === 1 ? 'other-version' : artifact.report.run.backend.version }
    }
    const expected: Record.ReplayExpectation = {
      get modelDigest() { models++; return models === 1 ? 'different-model' : artifact.report.run.modelDigest },
      get backend() { backends++; return backends === 1 ? backend : undefined }
    }
    const ordinary = Record.replay(store, artifact.id, {
      modelDigest: 'different-model', backend: { name: 'other-solver', version: 'other-version' }
    })
    assert.deepEqual(Record.replay(store, artifact.id, expected), ordinary)
    assert.deepEqual([models, backends, names, versions], [1, 1, 1, 1])
    const fresh = Record.replay(store, artifact.id, expected)
    assert.equal(fresh.compatible, true)
    assert.deepEqual(fresh.reasons, [])
    assert.deepEqual([models, backends, names, versions], [2, 2, 1, 1])
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('replay reports model and solver incompatibility without re-evaluating', async () => {
  const store = open()
  const artifact: Record.Result = { schema: Record.resultSchema, id: 'run-1', report: await report() }
  Record.result(store, artifact)

  const compatible = Record.replay(store, artifact.id, {
    modelDigest: artifact.report.run.modelDigest,
    backend: artifact.report.run.backend
  })
  assert.equal(compatible.compatible, true)
  assert.deepEqual(compatible.reasons, [])
  assert.equal(count(store), 1)

  const incompatible = Record.replay(store, artifact.id, {
    modelDigest: `sha256:${'0'.repeat(64)}`,
    backend: { name: 'test-solver', version: '2.0.0' }
  })
  assert.equal(incompatible.compatible, false)
  assert.match(incompatible.reasons.join('\n'), /model digest/)
  assert.match(incompatible.reasons.join('\n'), /solver version/)
  assert.equal(count(store), 1, 'replay never writes or solves again')
  store.close()
})


test('solver records reject unproved outcomes before recording, replay or decision transitions', async () => {
  const base = await report()
  for (const status of ['optimal', 'unsatisfied'] as const) {
    const field = status === 'optimal' ? 'optimalityProved' : 'infeasibilityProved'
    const outcome = status === 'optimal'
      ? { ...base.outcome, status, objectives: [], optimalityProved: true }
      : { status, coreMinimal: false, infeasibilityProved: true }
    const valid = { schema: Record.resultSchema, id: 'proof', report: { ...base, outcome } } as Record.Result
    for (const marker of [undefined, false, 1, 'true', null]) {
      const invalid = { ...valid, report: { ...base, outcome: { ...outcome, [field]: marker } } } as unknown as Record.Result
      const store = open()
      try {
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.result(store, invalid), new RegExp(`${field}: true`))
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.equal(Record.result(store, valid).status, 'recorded')
        assert.equal(Record.replay(store, 'proof', { modelDigest: base.run.modelDigest }).compatible, true)
      } finally { store.close() }
      const imported = open()
      try {
        const payload = Buffer.from(JSON.stringify(invalid)).toString('base64url')
        imported.ingest(`scenario-result/proof HAS artifact: \`${payload}\` @src:scenario/result`)
        const before = imported.exportText({ tx: true, maxSensitivity: 'restricted' })
        for (const read of [
          () => Record.read(imported, 'result', 'proof'),
          () => Record.replay(imported, 'proof', { modelDigest: base.run.modelDigest }),
          () => Record.recommendation(imported, { schema: Record.recommendationSchema, id: 'proposal', resultId: 'proof', value: null }),
          () => Record.decision(imported, { schema: Record.decisionSchema, id: 'decision', resultId: 'proof', selected: null, decidedBy: 'reviewer' })
        ]) assert.throws(read, new RegExp(`${field}: true`))
        assert.equal(imported.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      } finally { imported.close() }
    }
  }
})

test('solver records reject missing and unsupported outcomes', async () => {
  const base = await report()
  const store = open()
  try {
    for (const outcome of [undefined, null, {}, { status: 'success' }, { status: false }]) {
      const artifact = { schema: Record.resultSchema, id: 'invalid', report: { ...base, outcome } } as unknown as Record.Result
      assert.throws(() => Record.result(store, artifact), /solver explanation status must be/)
      assert.equal(count(store), 0)
    }
    assert.equal(Record.result(store, { schema: Record.resultSchema, id: 'invalid', report: base }).status, 'recorded')
  } finally { store.close() }
})


test('recording and replay preserve indeterminate explanation reasons', () => {
  const explanation = Explain.report(model, {
    status: 'satisfied', backend: adapter.backend, diagnostics: [], elapsedMs: 0, assignment: {}
  }, Adapter.defaultLimits)
  const artifact: Record.Result = { schema: Record.resultSchema, id: 'missing-assignment', report: explanation }
  const store = open()
  try {
    assert.equal(Record.result(store, artifact).status, 'recorded')
    const replay = Record.replay(store, artifact.id, { modelDigest: explanation.run.modelDigest })
    assert.equal(replay.compatible, true)
    assert.deepEqual(replay.artifact, artifact)
    assert.ok(Explain.render(replay.artifact.report).includes('assignment omits'))
    assert.equal(Record.result(store, artifact).status, 'existing')
    assert.equal(count(store), 1)
  } finally { store.close() }
})


test('deep artifact recording preserves imported payload identity and idempotent retry', () => {
  const store = open()
  try {
    Record.result(store, evaluation(store))
    const depth = 10000
    const nested = '{"child":['.repeat(depth) + '7' + ']}'.repeat(depth)
    const json = `{"id":"deep-write","resultId":"evaluation","schema":"${Record.recommendationSchema}","value":${nested}}`
    const payload = Buffer.from(json).toString('base64url')
    store.ingest(`scenario-recommendation/deep-write HAS artifact: \`${payload}\` @src:scenario/recommendation`)
    const artifact = Record.read<Record.Recommendation>(store, 'recommendation', 'deep-write')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(Record.recommendation(store, artifact).status, 'existing')
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const fresh = Record.recommendation(store, { ...artifact, id: 'fresh-deep' })
    assert.equal(fresh.status, 'recorded')
    let value: unknown = (fresh.artifact as Record.Recommendation).value
    for (let index = 0; index < depth; index++) value = (value as { child: unknown[] }).child[0]
    assert.equal(value, 7)
  } finally { store.close() }
})


test('artifact serialization retains existing numeric-key ordering and escaped payload bytes', () => {
  const store = open()
  try {
    Record.result(store, evaluation(store))
    const value = JSON.parse('{"z":{"a":1},"10":"ten","2":"two","__proto__":{"a":1},"a":[null,0,"line\\nend"]}')
    value.omitted = undefined
    value.a[1] = -0
    const expected = `{"id":"compat","resultId":"evaluation","schema":"${Record.recommendationSchema}","value":{"2":"two","10":"ten","__proto__":{"a":1},"a":[null,0,"line\\nend"],"z":{"a":1}}}`
    const payload = Buffer.from(expected).toString('base64url')
    store.ingest(`scenario-recommendation/compat HAS artifact: \`${payload}\` @src:scenario/recommendation`)
    assert.equal(Record.recommendation(store, { schema: Record.recommendationSchema, id: 'compat', resultId: 'evaluation', value }).status, 'existing')
  } finally { store.close() }
})

test('deep invalid artifact values reject before writes without stack overflow', () => {
  const store = open()
  try {
    Record.result(store, evaluation(store))
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const kind of ['cycle', 'undefined', 'infinite']) {
      const root: unknown[] = []
      let leaf = root
      for (let index = 0; index < 10000; index++) {
        const child: unknown[] = []
        leaf.push(child)
        leaf = child
      }
      leaf.push(kind === 'cycle' ? root : kind === 'undefined' ? undefined : Infinity)
      assert.throws(() => Record.recommendation(store, { schema: Record.recommendationSchema, id: 'invalid-deep', resultId: 'evaluation', value: root as Explain.Json }),
        error => error instanceof TypeError && /contains a cycle|is not JSON|must be finite/.test(error.message))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
  } finally { store.close() }
})


test('solver record collections reject malformed arrays before storage and imported replay', async () => {
  const base = await report()
  const cases = [
    ['run', 'inputs', base], ['run', 'diagnostics', base],
    ['outcome', 'assignments', base], ['outcome', 'hardConstraints', base], ['outcome', 'softConstraints', base],
    ['outcome', 'objectives', { ...base, outcome: { ...base.outcome, status: 'optimal', optimalityProved: true, objectives: [] } }],
    ['outcome', 'core', { ...base, outcome: { status: 'unsatisfied', infeasibilityProved: true, coreMinimal: false, core: [] } }]
  ] as const
  for (const [scope, field, valid] of cases) {
    for (const value of [undefined, null, {}, 'not-an-array']) {
      if (field === 'core' && value === undefined) continue
      const artifact = { schema: Record.resultSchema, id: 'collection', report: { ...valid, [scope]: { ...valid[scope], [field]: value } } } as unknown as Record.Result
      const message = new RegExp(`solver explanation ${field} must be an array`)
      const store = open()
      try {
        assert.throws(() => Record.result(store, artifact), message)
        assert.equal(count(store), 0)
        const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
        store.ingest(`scenario-result/collection HAS artifact: \`${payload}\` @src:scenario/result`)
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, 'result', artifact.id), message)
        assert.throws(() => Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }), message)
        assert.throws(() => Record.recommendation(store, { schema: Record.recommendationSchema, id: 'proposal', resultId: artifact.id, value: null }), message)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      } finally { store.close() }
    }
    const store = open()
    try {
      const artifact = { schema: Record.resultSchema, id: 'valid-collection', report: valid } as Record.Result
      assert.equal(Record.result(store, artifact).status, 'recorded')
      assert.equal(Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }).compatible, true)
      assert.doesNotThrow(() => Explain.render(Record.read<Record.Result>(store, 'result', artifact.id).report))
    } finally { store.close() }
  }
})

test('recorded unknown outcomes validate reasons before replay or predecessor use', async () => {
  const base = await report()
  for (const reason of [undefined, null, {}, { kind: 'other', message: 'detail' },
    { kind: 'timeout', message: null }, { kind: 'resource-limit', message: 'detail', limit: 'unknown' }]) {
    const artifact = { schema: Record.resultSchema, id: 'unknown-reason', report: { ...base, outcome: { status: 'unknown', reason } } } as unknown as Record.Result
    const store = open()
    try {
      assert.throws(() => Record.result(store, artifact), /unknown solver reason/)
      assert.equal(count(store), 0)
      const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
      store.ingest(`scenario-result/unknown-reason HAS artifact: \`${payload}\` @src:scenario/result`)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, 'result', artifact.id), /unknown solver reason/)
      assert.throws(() => Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }), /unknown solver reason/)
      assert.throws(() => Record.recommendation(store, { schema: Record.recommendationSchema, id: 'proposal', resultId: artifact.id, value: null }), /unknown solver reason/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  }
})

test('solver record metadata rejects malformed time and diagnostic entries on replay', async () => {
  const base = await report()
  for (const metadata of [{ elapsedMs: -1 }, { elapsedMs: null }, { elapsedMs: '1' },
    { diagnostics: [null] }, { diagnostics: [{ level: 'debug', code: 'x', message: '' }] },
    { diagnostics: [{ level: 'warning', code: 'x', message: null }] }]) {
    const artifact = { schema: Record.resultSchema, id: 'metadata', report: { ...base, run: { ...base.run, ...metadata } } } as unknown as Record.Result
    const store = open()
    try {
      assert.throws(() => Record.result(store, artifact), /solver (?:elapsedMs|diagnostics)/)
      assert.equal(count(store), 0)
      const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
      store.ingest(`scenario-result/metadata HAS artifact: \`${payload}\` @src:scenario/result`)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, 'result', artifact.id), /solver (?:elapsedMs|diagnostics)/)
      assert.throws(() => Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }), /solver (?:elapsedMs|diagnostics)/)
      assert.throws(() => Record.decision(store, { schema: Record.decisionSchema, id: 'decision', resultId: artifact.id, selected: null, decidedBy: 'reviewer' }), /solver (?:elapsedMs|diagnostics)/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  }
})

test('solver record entries validate identities, provenance and evaluation fields', async () => {
  const base = await report()
  const element = { id: 'item', evidenceRowIds: [], scenarioInputIds: [] }
  const entries: [string, { [key: string]: unknown }, { [key: string]: unknown }[]][] = [
    ['inputs', { id: 'input', evidenceRowIds: [], scenarioClaimIds: [] }, [{ scenarioClaimIds: null }, { query: 1 }]],
    ['assignments', { ...element, declared: true, value: { sort: 'bool', value: true } }, [{ declared: 'true' }]],
    ['hardConstraints', { ...element, evaluation: 'satisfied' }, [{ evaluation: 'accepted' }, { evaluationReason: 1 }]],
    ['softConstraints', { ...element, evaluation: 'accepted', weight: { numerator: '1', denominator: '1' } },
      [{ evaluation: 'satisfied' }, { evaluationReason: null }, { weight: null }, { weight: { numerator: 1, denominator: '1' } }]],
    ['objectives', { ...element, declared: true, direction: 'minimize', value: { sort: 'int', value: '1' } }, [{ direction: 'other' }, { declared: null }]],
    ['core', { ...element, declared: false }, [{ declared: 1 }]]
  ]
  const explanation = (field: string, entry: unknown): Explain.Report => {
    if (field === 'inputs') return { ...base, run: { ...base.run, inputs: [entry] } } as unknown as Explain.Report
    const outcome = field === 'core' ? { status: 'unsatisfied', infeasibilityProved: true, coreMinimal: false, core: [entry] }
      : field === 'objectives' ? { ...base.outcome, status: 'optimal', optimalityProved: true, objectives: [entry] }
      : { ...base.outcome, [field]: [entry] }
    return { ...base, outcome } as unknown as Explain.Report
  }
  for (const [field, entry, specific] of entries) {
    const variants = [null, [], {}, { ...entry, id: 1 }, { ...entry, evidenceRowIds: null },
      { ...entry, evidenceRowIds: [1] }, ...specific.map(change => ({ ...entry, ...change })),
      ...(field === 'inputs' ? [] : [{ ...entry, scenarioInputIds: null }, { ...entry, description: 1 },
        { ...entry, declaration: null }, { ...entry, declaration: { uri: 'source', line: 0 } }])]
    for (const invalid of variants) {
      const store = open()
      try {
        const artifact: Record.Result = { schema: Record.resultSchema, id: 'entry', report: explanation(field, invalid) }
        assert.throws(() => Record.result(store, artifact), /solver explanation.*\[0\]/)
        assert.equal(count(store), 0)
        const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
        store.ingest(`scenario-result/entry HAS artifact: \`${payload}\` @src:scenario/result`)
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.throws(() => Record.read(store, 'result', 'entry'), /solver explanation.*\[0\]/)
        assert.throws(() => Record.replay(store, 'entry', { modelDigest: base.run.modelDigest }), /solver explanation.*\[0\]/)
        assert.throws(() => Record.recommendation(store, { schema: Record.recommendationSchema, id: 'proposal', resultId: 'entry', value: null }), /solver explanation.*\[0\]/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      } finally { store.close() }
    }
    const store = open()
    try {
      const artifact: Record.Result = { schema: Record.resultSchema, id: 'valid', report: explanation(field, entry) }
      assert.equal(Record.result(store, artifact).status, 'recorded')
      assert.equal(Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }).compatible, true)
      assert.doesNotThrow(() => Explain.render(Record.read<Record.Result>(store, 'result', artifact.id).report))
    } finally { store.close() }
  }
})

test('entry validation retains malformed backend values for recorded inspection', () => {
  const input: Model.t = { ...model, objectives: [{ id: 'cost', direction: 'minimize', expression: { kind: 'literal', sort: 'int', value: 1 } }] }
  const explanation = Explain.report(input, { status: 'optimal', optimalityProved: true,
    backend: adapter.backend, elapsedMs: 0, diagnostics: [], assignment: { architecture: null },
    objectives: [{ objectiveId: 'cost', value: null }] } as unknown as Adapter.Result, Adapter.defaultLimits)
  const store = open()
  try {
    const artifact: Record.Result = { schema: Record.resultSchema, id: 'raw-values', report: explanation }
    assert.equal(Record.result(store, artifact).status, 'recorded')
    const replay = Record.replay(store, artifact.id, { modelDigest: explanation.run.modelDigest })
    assert.deepEqual(replay.artifact, artifact)
    assert.equal(replay.compatible, true)
    assert.equal(Explain.render(replay.artifact.report).split('(invalid backend value)').length - 1, 2)
  } finally { store.close() }
})

test('recorded run policies reject malformed limits and explanation context', async () => {
  const base = await report()
  const input = { id: 'input', evidenceRowIds: [], scenarioClaimIds: [] }
  for (const change of [
    ...[undefined, null, [], 'limits', { timeoutMs: 0 }, { timeoutMs: '1' }, { unexpected: 1 }].map(limits => ({ limits })),
    ...[null, {}, { transactionTime: null, aliases: 'other' }, { transactionTime: null, resolution: 'other' },
      { transactionTime: null, minimumConfidence: 2 }, { transactionTime: null, validTime: '' }].map(snapshot => ({ snapshot })),
    ...[null, { id: 'scenario', inputDigest: 'input' }, { id: '', inputDigest: 'input', overlayDigest: 'overlay' }].map(scenario => ({ scenario })),
    { inputs: [input, input] }, { inputs: [{ ...input, id: '' }] }
  ]) {
    const artifact = { schema: Record.resultSchema, id: 'policies', report: { ...base, run: { ...base.run, ...change } } } as unknown as Record.Result
    const store = open()
    try {
      assert.throws(() => Record.result(store, artifact), /solver limit|explanation (limits|snapshot|scenario|inputs)/)
      assert.equal(count(store), 0)
      const payload = Buffer.from(JSON.stringify(artifact)).toString('base64url')
      store.ingest(`scenario-result/policies HAS artifact: \`${payload}\` @src:scenario/result`)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(store, 'result', artifact.id), /solver limit|explanation (limits|snapshot|scenario|inputs)/)
      assert.throws(() => Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }), /solver limit|explanation (limits|snapshot|scenario|inputs)/)
      assert.throws(() => Record.recommendation(store, { schema: Record.recommendationSchema, id: 'proposal', resultId: artifact.id, value: null }), /solver limit|explanation (limits|snapshot|scenario|inputs)/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  }
})

test('historical declared limits remain unchanged after run policy validation', async () => {
  const base = await report()
  const artifact = { schema: Record.resultSchema, id: 'historical-limits', report: { ...base,
    run: { ...base.run, limits: { timeoutMs: 1000 }, snapshot: { transactionTime: null, aliases: 'closure', resolution: 'winner', minimumConfidence: 0.5 },
      scenario: { id: 'scenario', inputDigest: 'input', overlayDigest: 'overlay' } } } } as unknown as Record.Result
  const store = open()
  try {
    assert.equal(Record.result(store, artifact).status, 'recorded')
    assert.deepEqual(Record.replay(store, artifact.id, { modelDigest: base.run.modelDigest }).artifact, artifact)
    assert.equal(Record.result(store, artifact).status, 'existing')
  } finally { store.close() }
})

test('unsatisfied records retain the explicit nonminimal-core contract', async () => {
  const base = await report()
  const valid: Record.Result = { schema: Record.resultSchema, id: 'core-policy', report: { ...base,
    outcome: { status: 'unsatisfied', infeasibilityProved: true, coreMinimal: false } } }
  for (const coreMinimal of [undefined, true, null, 0, 'false']) {
    const invalid = { ...valid, report: { ...valid.report, outcome: { ...valid.report.outcome, coreMinimal } } } as unknown as Record.Result
    const store = open()
    try {
      assert.throws(() => Record.result(store, invalid), /coreMinimal: false/)
      assert.equal(count(store), 0)
      assert.equal(Record.result(store, valid).status, 'recorded')
      assert.deepEqual(Record.replay(store, valid.id, { modelDigest: base.run.modelDigest }).artifact, valid)
    } finally { store.close() }
    const imported = open()
    try {
      const payload = Buffer.from(JSON.stringify(invalid)).toString('base64url')
      imported.ingest(`scenario-result/core-policy HAS artifact: \`${payload}\` @src:scenario/result`)
      const before = imported.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => Record.read(imported, 'result', valid.id), /coreMinimal: false/)
      assert.throws(() => Record.replay(imported, valid.id, { modelDigest: base.run.modelDigest }), /coreMinimal: false/)
      assert.throws(() => Record.recommendation(imported, { schema: Record.recommendationSchema, id: 'proposal', resultId: valid.id, value: null }), /coreMinimal: false/)
      assert.equal(imported.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { imported.close() }
  }
})

for (const status of ['satisfied', 'optimal'] as const) for (const field of ['maxExplanationBits', 'maxExplanationWork'] as const) {
  test(`explanation ${field} budget survives solve, recording and imported replay (${status})`, async () => {
    let expression: Model.Expression = { kind: 'variable', id: 'x' }
    for (let depth = 0; depth < 6; depth++) expression = { kind: 'multiply', operands: [expression, expression] }
    const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [
      { id: 'growth', expression: { kind: 'gt', left: expression, right: { kind: 'literal', sort: 'real', value: '1' } } }
    ] }
    const recoveredLimit = field === 'maxExplanationBits' ? 1024 : 1000000
    const options = { limits: { [field]: 64 } }
    const received: number[] = []
    const backend: Adapter.t = { backend: { name: 'budget-fixture', version: '1' },
      capabilities: new Set(Adapter.capabilities), solve: async (_model, request) => {
        received.push(request.limits[field])
        assert.ok(Object.isFrozen(request.limits))
        options.limits[field] = recoveredLimit
        await Promise.resolve()
        const common = { backend: { name: 'budget-fixture', version: '1' }, elapsedMs: 0, diagnostics: [],
          assignment: { x: { sort: 'real' as const, numerator: '3', denominator: '2' } } }
        return status === 'optimal' ? { ...common, status, optimalityProved: true, objectives: [] } : { ...common, status }
      } }
    const first = await Solve.runWithExplanation(backend, input, options)
    assert.equal(first.outcome.status, status)
    if (first.outcome.status !== 'satisfied' && first.outcome.status !== 'optimal') assert.fail('expected feasible report')
    assert.equal(first.run.limits[field], 64)
    assert.equal(first.outcome.hardConstraints[0]!.evaluation, 'indeterminate')
    assert.match(first.outcome.hardConstraints[0]!.evaluationReason!, new RegExp(field))
    const artifact: Record.Result = { schema: Record.resultSchema, id: 'limited', report: first }
    const store = open(), imported = open()
    try {
      assert.equal(Record.result(store, artifact).status, 'recorded')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const recovered = await Solve.runWithExplanation(backend, input, options)
      assert.equal(recovered.run.limits[field], recoveredLimit)
      assert.equal(recovered.run.modelDigest, first.run.modelDigest)
      if (recovered.outcome.status !== 'satisfied' && recovered.outcome.status !== 'optimal') assert.fail('expected feasible report')
      assert.equal(recovered.outcome.hardConstraints[0]!.evaluation, 'satisfied')
      assert.deepEqual(received, [64, recoveredLimit])
      assert.throws(() => Record.result(store, { ...artifact, report: recovered }), Record.RecordConflictError)
      assert.deepEqual(Record.replay(store, artifact.id, { modelDigest: first.run.modelDigest }).artifact, artifact)
      assert.equal(Record.result(store, artifact).status, 'existing')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      imported.ingest(before)
      const importedBefore = imported.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.deepEqual(Record.replay(imported, artifact.id, { modelDigest: first.run.modelDigest }).artifact, artifact)
      assert.equal(imported.exportText({ tx: true, maxSensitivity: 'restricted' }), importedBefore)
      assert.deepEqual(received, [64, recoveredLimit], 'replay must not invoke the backend')
      assert.equal(Record.result(store, { ...artifact, id: 'recovered', report: recovered }).status, 'recorded')
      assert.deepEqual(Record.read(store, 'result', artifact.id), artifact)
    } finally { imported.close(); store.close() }
  })
}
