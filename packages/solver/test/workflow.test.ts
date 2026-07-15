import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Model, Workflow } from '@cavelang/solver'

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const int = (value: Model.Integer): Model.Expression => ({ kind: 'literal', sort: 'int', value })

const common = {
  backend: { name: 'fake', version: '1' },
  diagnostics: [],
  elapsedMs: 1
} as const

const model = (): Model.t => ({
  schema: Model.schema,
  enums: [{ id: 'architecture', values: ['microservices', 'monolith'] }],
  variables: [
    { id: 'enabled', sort: 'bool' },
    { id: 'architecture', sort: 'enum', domain: 'architecture' },
    { id: 'cost', sort: 'int', min: 0, max: 100 },
    { id: 'ratio', sort: 'real', min: '0', max: '1' }
  ],
  constraints: [{ id: 'must-be-disabled', expression: { kind: 'not', value: ref('enabled') } }],
  softConstraints: [{ id: 'prefer-enabled', expression: ref('enabled'), weight: '2.5' }],
  objectives: [{ id: 'least-cost', direction: 'minimize', expression: ref('cost') }]
})

const assignment: Model.Assignment = {
  enabled: { sort: 'bool', value: true },
  architecture: { sort: 'enum', domain: 'architecture', value: 'microservices' },
  cost: { sort: 'int', value: '4' },
  ratio: { sort: 'real', numerator: '1', denominator: '2' }
}

test('feasibility ignores preferences and deterministically breaks ties by variable ID', async () => {
  let submitted: Model.t | undefined
  const adapter: Adapter.t = {
    backend: common.backend,
    capabilities: new Set(Adapter.capabilities),
    solve: async candidate => {
      submitted = candidate
      return {
        ...common,
        status: 'optimal',
        assignment,
        objectives: (candidate.objectives ?? []).map(objective => ({
          objectiveId: objective.id,
          value: { sort: 'int', value: '0' }
        })),
        optimalityProved: true
      }
    }
  }

  const result = await Workflow.feasibility(adapter, model())
  assert.deepEqual(submitted?.softConstraints, [])
  assert.deepEqual(submitted?.objectives?.map(objective => objective.id), [
    'cave.workflow/tie/architecture',
    'cave.workflow/tie/cost',
    'cave.workflow/tie/enabled',
    'cave.workflow/tie/ratio'
  ])
  assert.deepEqual(result.tieBreak, [
    { variableId: 'architecture', preference: 'lexical-first' },
    { variableId: 'cost', preference: 'smallest-first' },
    { variableId: 'enabled', preference: 'false-first' },
    { variableId: 'ratio', preference: 'smallest-first' }
  ])
  assert.equal(result.explanation.outcome.status, 'satisfied')
})

test('optimization orders authored objectives, explicit soft score, then deterministic ties', async () => {
  let objectiveIds: readonly string[] = []
  const adapter: Adapter.t = {
    backend: common.backend,
    capabilities: new Set(Adapter.capabilities),
    solve: async candidate => {
      objectiveIds = (candidate.objectives ?? []).map(objective => objective.id)
      return {
        ...common,
        status: 'optimal',
        assignment,
        objectives: objectiveIds.map(id => ({ objectiveId: id, value: { sort: 'int', value: '0' } })),
        optimalityProved: true
      }
    }
  }

  const result = await Workflow.optimization(adapter, model())
  assert.deepEqual(objectiveIds, [
    'least-cost',
    'cave.workflow/soft-score',
    'cave.workflow/tie/architecture',
    'cave.workflow/tie/cost',
    'cave.workflow/tie/enabled',
    'cave.workflow/tie/ratio'
  ])
  assert.equal(result.explanation.outcome.status, 'optimal')
  if (result.explanation.outcome.status !== 'optimal') return
  assert.deepEqual(result.explanation.outcome.objectives.map(objective => objective.id), ['least-cost'])
  assert.equal(result.explanation.outcome.softConstraints[0]?.evaluation, 'accepted')
})

test('optimization never promotes a merely feasible backend result to optimal', async () => {
  const adapter: Adapter.t = {
    backend: common.backend,
    capabilities: new Set(Adapter.capabilities),
    solve: async () => ({ ...common, status: 'satisfied', assignment })
  }
  const result = await Workflow.optimization(adapter, model())
  assert.equal(result.explanation.outcome.status, 'unknown')
  if (result.explanation.outcome.status !== 'unknown') return
  assert.match(result.explanation.outcome.reason.message, /without proving optimality/)
})

test('counterexample negates one declared invariant and reports its bounded scope', async () => {
  let submitted: Model.t | undefined
  const adapter: Adapter.t = {
    backend: common.backend,
    capabilities: new Set(Adapter.capabilities),
    solve: async candidate => {
      submitted = candidate
      return {
        ...common,
        status: 'optimal',
        assignment,
        objectives: (candidate.objectives ?? []).map(objective => ({
          objectiveId: objective.id,
          value: { sort: 'int', value: '0' }
        })),
        optimalityProved: true
      }
    }
  }

  const result = await Workflow.counterexample(adapter, model(), 'must-be-disabled')
  assert.equal(submitted?.constraints[0]?.expression.kind, 'not')
  assert.equal((submitted?.constraints[0]?.expression as { value?: Model.Expression }).value?.kind, 'not')
  assert.deepEqual(result.operation, {
    kind: 'counterexample', invariantId: 'must-be-disabled', verdict: 'counterexample'
  })
  assert.deepEqual(result.scope.assumptions, [])
  assert.deepEqual(result.scope.theories, ['booleans', 'bounded-integers', 'exact-rationals', 'finite-enums'])
  assert.deepEqual(result.scope.domains.find(domain => domain.variableId === 'architecture'), {
    variableId: 'architecture', kind: 'finite', sort: 'enum', domain: 'architecture',
    values: ['microservices', 'monolith']
  })
  assert.equal(result.explanation.outcome.status, 'satisfied')
  if (result.explanation.outcome.status !== 'satisfied') return
  assert.equal(result.explanation.outcome.hardConstraints[0]?.evaluation, 'violated')
})

test('bounded sensitivity reports preferred-assignment transitions and unknown regions', async () => {
  const input: Model.t = {
    schema: Model.schema,
    enums: [{ id: 'architecture', values: ['monolith', 'microservices'] }],
    variables: [
      { id: 'architecture', sort: 'enum', domain: 'architecture' },
      { id: 'team-size', sort: 'int', min: 1, max: 3 }
    ],
    constraints: [],
    objectives: [{ id: 'choice', direction: 'minimize', expression: int(0) }]
  }
  const adapter: Adapter.t = {
    backend: common.backend,
    capabilities: new Set(Adapter.capabilities),
    solve: async candidate => {
      const sample = candidate.constraints.find(constraint => constraint.id.includes('/sample/'))
      const value = sample?.expression.kind === 'eq' && sample.expression.right.kind === 'literal' &&
        sample.expression.right.sort === 'int' ? Number(sample.expression.right.value) : 0
      if (value === 2) {
        return {
          ...common,
          status: 'unknown',
          reason: { kind: 'timeout', message: 'sample timed out', limit: 'timeoutMs' }
        }
      }
      return {
        ...common,
        status: 'optimal',
        assignment: {
          'team-size': { sort: 'int', value: String(value) },
          architecture: {
            sort: 'enum', domain: 'architecture', value: value < 3 ? 'monolith' : 'microservices'
          }
        },
        objectives: (candidate.objectives ?? []).map(objective => ({
          objectiveId: objective.id, value: { sort: 'int', value: '0' }
        })),
        optimalityProved: true
      }
    }
  }

  const result = await Workflow.sensitivity(adapter, input, {
    variableId: 'team-size',
    samples: [1, 2, 3].map(value => ({ sort: 'int' as const, value: String(value) })),
    observe: ['architecture']
  })
  assert.equal(result.points.length, 3)
  assert.deepEqual(result.unknownRegions, [{
    startIndex: 1, endIndex: 1,
    from: { sort: 'int', value: '2' }, to: { sort: 'int', value: '2' }
  }])
  assert.equal(result.transitions.length, 2)
  assert.match(result.transitions[0]!.fromSignature, /monolith/)
  assert.equal(result.transitions[0]!.toSignature, 'unknown')
  assert.match(result.transitions[1]!.toSignature, /microservices/)
})

test('workflow validation rejects unbounded models, duplicate samples, and excessive runs', async () => {
  const unbounded: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'x', sort: 'real' }],
    constraints: []
  }
  const adapter: Adapter.t = {
    backend: common.backend,
    capabilities: new Set(Adapter.capabilities),
    solve: async () => assert.fail('adapter must not run')
  }
  await assert.rejects(Workflow.feasibility(adapter, unbounded), /needs explicit min and max bounds/)
  await assert.rejects(
    Workflow.sensitivity(adapter, model(), {
      variableId: 'cost',
      samples: [{ sort: 'int', value: '1' }, { sort: 'int', value: '01' }],
      operation: 'feasibility'
    }),
    /duplicate values/
  )
  await assert.rejects(
    Workflow.sensitivity(adapter, model(), {
      variableId: 'cost',
      samples: [{ sort: 'int', value: '1' }, { sort: 'int', value: '2' }],
      maxRuns: 1,
      operation: 'feasibility'
    }),
    /exceed maxRuns/
  )
})
