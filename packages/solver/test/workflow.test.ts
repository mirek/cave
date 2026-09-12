import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Canonical, Model, Workflow } from '@cavelang/solver'

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

test('workflow scope and execution use one captured model', async () => {
  for (const kind of ['feasibility', 'optimization', 'counterexample', 'sensitivity']) {
    let reads = 0, calls = 0
    const input: Model.t = {
      schema: Model.schema, variables: [{ id: 'flag', sort: 'bool' }],
      objectives: [{ id: 'constant', direction: 'minimize', expression: int(0) }],
      get constraints() {
        reads++
        return [{ id: 'invariant', expression: reads === 1
          ? { kind: 'literal' as const, sort: 'bool' as const, value: true }
          : ref('missing') }]
      }
    }
    const adapter: Adapter.t = {
      backend: common.backend, capabilities: new Set(Adapter.capabilities),
      solve: async () => {
        calls++
        return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }
      }
    }
    if (kind === 'counterexample') await Workflow.counterexample(adapter, input, 'invariant')
    else if (kind === 'sensitivity') await Workflow.sensitivity(adapter, input,
      { variableId: 'flag', operation: 'feasibility', samples: [{ sort: 'bool', value: false }] })
    else if (kind === 'optimization') await Workflow.optimization(adapter, input)
    else await Workflow.feasibility(adapter, input)
    assert.equal(reads, 1, kind)
    assert.equal(calls, 1, kind)
  }
})

test('workflow scope includes arithmetic from expressions without matching variable declarations', async () => {
  const input: Model.t = {
    schema: Model.schema, variables: [],
    constraints: [{ id: 'half', expression: {
      kind: 'lt',
      left: { kind: 'divide', left: int(1), right: int(2) },
      right: int(1),
    } }],
  }
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => ({ ...common, status: 'satisfied', assignment: {} }),
  }
  const report = await Workflow.feasibility(adapter, input)
  assert.deepEqual(report.scope.domains, [])
  assert.deepEqual(report.scope.theories, ['booleans', 'bounded-integers', 'exact-rationals'])
})

test('sensitivity preserves the complete submitted inputs across backend calls', async () => {
  const input = { schema: Model.schema, variables: [{ id: 'flag', sort: 'bool' as const, description: 'submitted' }], constraints: [] }
  const digest = Canonical.digest(input)
  const request = { variableId: 'flag', operation: 'feasibility' as const, samples: [{ sort: 'bool' as const, value: false }, { sort: 'bool' as const, value: true }] }
  const options = { limits: { timeoutMs: 100 } }
  const context = { inputs: [{ id: 'evidence', value: 'submitted', evidenceRowIds: ['row:submitted'], scenarioClaimIds: [] }] }
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const submissions: { model: Model.t, timeout: number }[] = []
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async (candidate, limits) => {
      submissions.push({ model: candidate, timeout: limits.limits.timeoutMs })
      if (submissions.length === 1) await pending
      return { ...common, status: 'satisfied', assignment: { flag: { sort: 'bool', value: true } } }
    },
  }
  const result = Workflow.sensitivity(adapter, input, request, options, context)
  input.variables[0]!.description = 'edited'
  request.variableId = 'other'
  options.limits.timeoutMs = 200
  context.inputs[0]!.value = 'edited'
  context.inputs[0]!.evidenceRowIds.push('row:later')
  finish()
  const report = await result
  assert.equal(report.variableId, 'flag')
  assert.equal(report.modelDigest, digest)
  assert.equal(report.points.length, 2)
  assert.deepEqual(submissions.map(value => value.timeout), [100, 100])
  assert.deepEqual(submissions.map(value => value.model.variables[0]!.description), ['submitted', 'submitted'])
  for (const point of report.points) {
    assert.equal(point.report.explanation.run.inputs[0]!.value, 'submitted')
    assert.deepEqual(point.report.explanation.run.inputs[0]!.evidenceRowIds, ['row:submitted'])
  }
})

for (const kind of ['feasibility', 'optimization', 'counterexample'] as const) {
  test(`${kind} reports the model and context captured before awaiting the adapter`, async () => {
    const input = { ...model() }
    const digest = Canonical.digest(input)
    const context = { inputs: [{ id: 'evidence', value: 'submitted', evidenceRowIds: [], scenarioClaimIds: [] }] }
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const adapter: Adapter.t = {
      backend: common.backend, capabilities: new Set(Adapter.capabilities),
      solve: async () => {
        await pending
        return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }
      },
    }
    const result = kind === 'counterexample'
      ? Workflow.counterexample(adapter, input, 'must-be-disabled', {}, context)
      : Workflow[kind](adapter, input, {}, context)
    input.variables = [...input.variables, { id: 'later', sort: 'bool' }]
    context.inputs[0]!.value = 'edited'
    finish()
    const report = await result
    assert.equal(report.modelDigest, digest)
    assert.equal(report.explanation.run.modelDigest, digest)
    assert.equal(report.explanation.run.inputs[0]!.value, 'submitted')
  })

  test(`${kind} rejects a replay mismatch before backend execution`, async () => {
    let invoked = false
    const adapter: Adapter.t = {
      backend: common.backend, capabilities: new Set(Adapter.capabilities),
      solve: async () => { invoked = true; throw new Error('must not execute') },
    }
    const context = { modelDigest: `sha256:${'0'.repeat(64)}` }
    const result = kind === 'counterexample'
      ? Workflow.counterexample(adapter, model(), 'must-be-disabled', {}, context)
      : Workflow[kind](adapter, model(), {}, context)
    await assert.rejects(result, /does not match/)
    assert.equal(invoked, false)
  })
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

test('sensitivity preflights every generated model before starting the batch', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } } }
  }
  const input: Model.t = {
    schema: Model.schema, variables: [{ id: 'cost', sort: 'int', min: 0, max: 1000 }], constraints: []
  }
  const request: Workflow.SensitivityRequest = {
    variableId: 'cost', samples: [{ sort: 'int', value: '1' }, { sort: 'int', value: '1000' }],
    operation: 'feasibility'
  }
  await assert.rejects(Workflow.sensitivity(adapter, input, request, { limits: { maxNumericDigits: 8 } }), error => {
    assert.equal(calls, 0, 'a later generated-model limit must fail before earlier backend calls')
    assert.ok(error instanceof Error)
    assert.match(error.message, /maxNumericDigits/)
    return true
  })
  const report = await Workflow.sensitivity(adapter, input, request, { limits: { maxNumericDigits: 9 } })
  assert.equal(calls, 2)
  assert.deepEqual(report.points.map(point => point.value), request.samples)
})

test('sensitivity duplicate detection uses semantic Boolean and enum values', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } } }
  }
  for (const request of [
    { variableId: 'enabled', samples: [{ sort: 'bool', value: false }, { value: false, sort: 'bool' }] },
    { variableId: 'enabled', samples: [{ sort: 'bool', value: false }, { sort: 'bool', value: false, note: 'same' }] },
    { variableId: 'architecture', samples: [
      { sort: 'enum', domain: 'architecture', value: 'monolith' },
      { value: 'monolith', domain: 'architecture', sort: 'enum' }
    ] },
    { variableId: 'architecture', samples: [
      { sort: 'enum', domain: 'architecture', value: 'monolith' },
      { sort: 'enum', domain: 'architecture', value: 'monolith', note: 'same' }
    ] }
  ]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), {
      ...request, operation: 'feasibility'
    } as Workflow.SensitivityRequest), /sensitivity samples contain duplicate values/)
    assert.equal(calls, 0)
  }
  const result = await Workflow.sensitivity(adapter, model(), {
    variableId: 'enabled', samples: [{ value: false, sort: 'bool' }, { sort: 'bool', value: true, note: 'extra' }],
    fixed: [{ variableId: 'architecture', value: { value: 'monolith', domain: 'architecture', sort: 'enum', note: 'extra' } }],
    operation: 'feasibility'
  } as unknown as Workflow.SensitivityRequest)
  assert.equal(calls, 2)
  assert.deepEqual(result.points.map(point => point.value), [{ sort: 'bool', value: false }, { sort: 'bool', value: true }])
  assert.deepEqual(result.fixed, [{ variableId: 'architecture', value: { sort: 'enum', domain: 'architecture', value: 'monolith' } }])
})

test('sensitivity validates every Boolean payload before any sample is solved', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } } }
  }
  for (const value of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
    for (const request of [
      { variableId: 'enabled', samples: [{ sort: 'bool', value: false }, { sort: 'bool', value }] },
      { variableId: 'cost', samples: [{ sort: 'int', value: '1' }],
        fixed: [{ variableId: 'enabled', value: { sort: 'bool', value } }] }
    ]) {
      await assert.rejects(Workflow.sensitivity(adapter, model(), {
        ...request, operation: 'feasibility'
      } as unknown as Workflow.SensitivityRequest), error => {
        assert.equal(calls, 0, 'invalid later samples must not run earlier samples')
        assert.ok(error instanceof Error)
        assert.match(error.message, /value for variable "enabled" must be a boolean/)
        return true
      })
    }
  }
  const result = await Workflow.sensitivity(adapter, model(), {
    variableId: 'enabled', samples: [{ sort: 'bool', value: false }, { sort: 'bool', value: true }],
    operation: 'feasibility'
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.points.map(point => point.value), [{ sort: 'bool', value: false }, { sort: 'bool', value: true }])
})

test('sensitivity budgets sample and fixed numeric text before normalization', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } } }
  }
  const padded = (value: string) => value.padStart(20, '0')
  for (const request of [
    { variableId: 'cost', samples: [{ sort: 'int', value: padded('1') }, { sort: 'int', value: padded('2') }] },
    { variableId: 'cost', samples: [{ sort: 'int', value: padded('1') }],
      fixed: [{ variableId: 'ratio', value: { sort: 'real', numerator: padded('1'), denominator: '1' } }] },
    { variableId: 'enabled', samples: [{ sort: 'bool', value: false }],
      fixed: [{ variableId: 'cost', value: { sort: 'int', value: '1'.padStart(40, '0') } }] },
    { variableId: 'ratio', samples: [{ sort: 'real', numerator: '1', denominator: '1'.padStart(40, '0') }] }
  ] as Workflow.SensitivityRequest[]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), request, { limits: { maxNumericDigits: 32 } }),
      /sensitivity request exceeds maxNumericDigits/)
  }
  assert.equal(calls, 0)
  await Workflow.sensitivity(adapter, model(), {
    variableId: 'cost', samples: [{ sort: 'int', value: padded('1') }], operation: 'feasibility'
  }, { limits: { maxNumericDigits: 32 } })
  assert.equal(calls, 1)
  await Workflow.sensitivity(adapter, model(), {
    variableId: 'cost', samples: [{ sort: 'int', value: padded('1') }, { sort: 'int', value: padded('2') }],
    operation: 'feasibility'
  }, { limits: { maxNumericDigits: 64 } })
  assert.equal(calls, 3)
})

test('sensitivity validates missing sample values and fixed-binding entries before solving', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'satisfied', assignment: {} } }
  }
  for (const samples of [[null], [undefined], [1], [[]], new Array(1)]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), {
      variableId: 'cost', samples
    } as unknown as Workflow.SensitivityRequest), /value for variable "cost" must be an object/)
  }
  for (const fixed of [[null], [undefined], [1], [[]], new Array(1)]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), {
      variableId: 'cost', samples: [{ sort: 'int', value: '1' }], fixed
    } as unknown as Workflow.SensitivityRequest), /fixed binding at index 0 must be an object/)
  }
  assert.equal(calls, 0)
})

test('sensitivity rejects malformed optional list containers before solving', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } } }
  }
  for (const field of ['observe', 'fixed'] as const) {
    for (const value of ['', 'cost', null, 1, {}, { length: 0 }]) {
      await assert.rejects(Workflow.sensitivity(adapter, model(), {
        variableId: 'cost', samples: [{ sort: 'int', value: '1' }],
        [field]: value
      } as unknown as Workflow.SensitivityRequest), new RegExp(`sensitivity ${field} must be an array`))
    }
  }
  assert.equal(calls, 0)
  await Workflow.sensitivity(adapter, model(), {
    variableId: 'cost', samples: [{ sort: 'int', value: '1' }],
    fixed: [], observe: [], operation: 'feasibility'
  })
  assert.equal(calls, 1)
})

test('sensitivity validates request and sample containers before solving', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'satisfied', assignment: {} } }
  }
  for (const request of [null, undefined, [], 'request', 1]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), request as unknown as Workflow.SensitivityRequest),
      /sensitivity request must be an object/)
  }
  for (const samples of [undefined, null, '1', {}, { length: 1, 0: { sort: 'int', value: '1' } }]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), {
      variableId: 'cost', samples: samples as unknown as Workflow.SensitivityRequest['samples']
    }), /sensitivity samples must be an array/)
  }
  await assert.rejects(Workflow.sensitivity(adapter, model(), { variableId: 'cost', samples: [] }),
    /sensitivity needs at least one sample/)
  assert.equal(calls, 0)
})

test('sensitivity names invalid object run limits before backend execution', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { ...common, status: 'satisfied', assignment: {} } }
  }
  for (const maxRuns of [{ toString: null }, { toString: 1, valueOf: null }]) {
    await assert.rejects(Workflow.sensitivity(adapter, model(), {
      variableId: 'cost', samples: [{ sort: 'int', value: '1' }],
      maxRuns: maxRuns as unknown as number
    }), /maxRuns must be a positive safe integer/)
  }
  assert.equal(calls, 0)
})

test('sensitivity rejects unknown operation names before solving', async () => {
  let invoked = false
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { invoked = true; return { ...common, status: 'satisfied', assignment } },
  }
  await assert.rejects(Workflow.sensitivity(adapter, model(), {
    variableId: 'cost', samples: [{ sort: 'int', value: '1' }],
    operation: 'optimisation' as Workflow.SensitivityRequest['operation'],
  }), /operation/)
  assert.equal(invoked, false)
})

test('workflow option validation happens before defaulting unsatCore', async () => {
  let invoked = false
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { invoked = true; return { ...common, status: 'satisfied', assignment } },
  }
  for (const kind of ['feasibility', 'optimization', 'counterexample', 'sensitivity'] as const) {
    const options = { unsatCore: null } as unknown as Adapter.Options
    const result = kind === 'counterexample'
      ? Workflow.counterexample(adapter, model(), 'must-be-disabled', options)
      : kind === 'sensitivity'
        ? Workflow.sensitivity(adapter, model(), { variableId: 'cost', samples: [{ sort: 'int', value: '1' }] }, options)
        : Workflow[kind](adapter, model(), options)
    await assert.rejects(result, TypeError)
  }
  assert.equal(invoked, false)
})

test('workflows carry custom size limits through report identity and replay checks', async () => {
  const input: Model.t = { schema: Model.schema, variables: Array.from({ length: 1001 }, (_, index) => ({ id: `flag${index}`, sort: 'bool' })), constraints: [] }
  const adapter: Adapter.t = {
    backend: common.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => ({ ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }),
  }
  const options = { limits: { maxVariables: 1001, maxObjectives: 1001 } }
  const report = await Workflow.feasibility(adapter, input, options)
  const replay = await Workflow.feasibility(adapter, input, options, { modelDigest: report.modelDigest })
  assert.equal(replay.modelDigest, report.modelDigest)
  const sweep = await Workflow.sensitivity(adapter, input, { variableId: 'flag0', samples: [{ sort: 'bool', value: true }], operation: 'feasibility' }, options)
  const expected = Canonical.digest(input, options.limits)
  assert.equal(report.modelDigest, expected)
  assert.equal(report.explanation.run.modelDigest, expected)
  assert.equal(sweep.modelDigest, expected)
  for (const point of sweep.points) {
    assert.equal(point.report.modelDigest, expected)
    assert.equal(point.report.explanation.run.modelDigest, expected)
  }
})
