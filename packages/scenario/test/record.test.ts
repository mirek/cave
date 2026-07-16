import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Adapter, Explain, Model, Solve } from '@cavelang/solver'
import { Model as ScenarioModel, Record, run } from '@cavelang/scenario'

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

test('lifecycle references are checked atomically', async () => {
  const store = open()
  const result: Record.Result = { schema: Record.resultSchema, id: 'run-1', report: await report() }
  Record.result(store, result)
  const before = count(store)
  assert.throws(() => Record.decision(store, {
    schema: Record.decisionSchema,
    id: 'decision-with-missing-recommendation',
    resultId: result.id,
    recommendationId: 'missing',
    selected: 'monolith',
    decidedBy: 'human/mirek'
  }), Record.MissingRecordError)
  assert.equal(count(store), before)
  store.close()
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
