import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Canonical, Explain, Model, Solve } from '@cavelang/solver'

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const int = (value: Model.Integer): Model.Expression => ({ kind: 'literal', sort: 'int', value })

const model = (): Model.t => ({
  schema: Model.schema,
  variables: [{
    id: 'replicas', sort: 'int', min: 1, max: 10,
    description: 'Chosen replica count',
    declaration: { uri: 'models/deployment.ts', line: 7 },
    scenarioInputIds: ['expected-load']
  }],
  constraints: [{
    id: 'capacity',
    expression: { kind: 'gte', left: ref('replicas'), right: int(3) },
    description: 'Enough replicas for forecast load',
    declaration: { uri: 'models/deployment.ts', line: 12, column: 3 },
    evidenceRowIds: ['row:forecast'],
    scenarioInputIds: ['expected-load']
  }],
  softConstraints: [{
    id: 'prefer-four',
    expression: { kind: 'eq', left: ref('replicas'), right: int(4) },
    weight: '2.5',
    scenarioInputIds: ['operations-budget']
  }],
  objectives: [{
    id: 'fewest-replicas', direction: 'minimize', expression: ref('replicas'),
    evidenceRowIds: ['row:cost'], scenarioInputIds: ['operations-budget']
  }]
})

const adapter = (result: Adapter.Result): Adapter.t => ({
  backend: result.backend,
  capabilities: new Set(Adapter.capabilities),
  solve: async () => result
})

const common = { backend: { name: 'fake', version: '1.2.3' }, diagnostics: [], elapsedMs: 4 } as const

test('optimal explanations map values, constraints, objectives, and run metadata to model provenance', async () => {
  const input = model()
  const result: Adapter.Result = {
    ...common,
    status: 'optimal',
    assignment: { replicas: { sort: 'int', value: '3' } },
    objectives: [{ objectiveId: 'fewest-replicas', value: { sort: 'int', value: '3' } }],
    optimalityProved: true
  }
  const report = await Solve.runWithExplanation(adapter(result), input, { limits: { timeoutMs: 321 } }, {
    modelDigest: Canonical.digest(input),
    scenario: { id: 'scale-api', inputDigest: `sha256:${'1'.repeat(64)}`, overlayDigest: `sha256:${'2'.repeat(64)}` },
    snapshot: {
      transactionTime: '2026-07-15T04:00:00.000Z', validTime: '2026-08-01',
      aliases: 'exact', resolution: 'winner', minimumConfidence: 0.7
    },
    inputs: [{
      id: 'expected-load', query: 'api HAS expected-load: ?load',
      value: { kind: 'integer', value: '3000', unit: 'rps' }, authoredValue: '3K rps',
      evidenceRowIds: ['row:forecast'], scenarioClaimIds: []
    }]
  })

  assert.equal(report.schema, Explain.schema)
  assert.equal(report.run.modelDigest, Canonical.digest(input))
  assert.equal(report.run.limits.timeoutMs, 321)
  assert.equal(report.run.inputs[0]!.query, 'api HAS expected-load: ?load')
  assert.equal(report.outcome.status, 'optimal')
  if (report.outcome.status !== 'optimal') return
  assert.deepEqual(report.outcome.assignments[0], {
    id: 'replicas', description: 'Chosen replica count',
    declaration: { uri: 'models/deployment.ts', line: 7 },
    evidenceRowIds: [], scenarioInputIds: ['expected-load'], declared: true,
    value: { sort: 'int', value: '3' }
  })
  assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied')
  assert.deepEqual(report.outcome.hardConstraints[0]!.evidenceRowIds, ['row:forecast'])
  assert.equal(report.outcome.softConstraints[0]!.evaluation, 'violated')
  assert.deepEqual(report.outcome.softConstraints[0]!.weight, { numerator: '5', denominator: '2' })
  assert.deepEqual(report.outcome.objectives[0]!.evidenceRowIds, ['row:cost'])
  assert.equal(report.outcome.objectives[0]!.declared, true)
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report)

  const text = Explain.render(report)
  assert.match(text, /Solver result: optimal/)
  assert.match(text, /models\/deployment\.ts:12:3; rows row:forecast; inputs expected-load/)
  assert.match(text, /Objective fewest-replicas \(minimize\) = 3/)
})

test('unsatisfied explanations map a backend core to declarations and mark it non-minimal', async () => {
  const input = model()
  const result: Adapter.Result = {
    ...common,
    status: 'unsatisfied',
    core: ['capacity', 'backend/unknown'],
    infeasibilityProved: true
  }
  const report = await Solve.runWithExplanation(adapter(result), input, { unsatCore: true })
  assert.equal(report.outcome.status, 'unsatisfied')
  if (report.outcome.status !== 'unsatisfied') return
  assert.equal(report.outcome.coreMinimal, false)
  assert.deepEqual(report.outcome.core?.map(item => [item.id, item.declared]), [
    ['capacity', true], ['backend/unknown', false]
  ])
  assert.deepEqual(report.outcome.core?.[0]?.evidenceRowIds, ['row:forecast'])
  assert.match(Explain.render(report), /not necessarily minimal/)
})

test('unknown explanations preserve the structured reason and reject a mismatched replay digest', () => {
  const input = model()
  const result: Adapter.Result = {
    ...common,
    status: 'unknown',
    reason: { kind: 'timeout', message: 'deadline reached', limit: 'timeoutMs' }
  }
  const report = Explain.report(input, result, Adapter.defaultLimits)
  assert.deepEqual(report.outcome, {
    status: 'unknown', reason: { kind: 'timeout', message: 'deadline reached', limit: 'timeoutMs' }
  })
  assert.match(Explain.render(report), /Unknown: timeout — deadline reached/)
  assert.throws(
    () => Explain.report(input, result, Adapter.defaultLimits, { modelDigest: `sha256:${'0'.repeat(64)}` }),
    /does not match/
  )
})
