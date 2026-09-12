import { after, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Adapter, Canonical, Model, Solve, Workflow } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const run = promisify(execFile)
const runtimePromise = create()

after(async () => (await runtimePromise).close())

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const int = (value: Model.Integer): Model.Expression => ({ kind: 'literal', sort: 'int', value })
const real = (value: Model.Rational): Model.Expression => ({ kind: 'literal', sort: 'real', value })

test('real sensitivity preflights limits and retains source identity across distinct sample models', async () => {
  const runtime = await runtimePromise
  const input: Model.t = {
    schema: Model.schema, variables: [{ id: 'cost', sort: 'int', min: 0, max: 1000 }], constraints: []
  }
  const sourceDigest = Canonical.digest(input)
  const submitted: string[] = []
  const adapter: Adapter.t = {
    backend: runtime.backend, capabilities: runtime.capabilities,
    solve: async (model, options) => {
      submitted.push(Canonical.digest(model, options.limits))
      return runtime.solve(model, options)
    }
  }
  const request: Workflow.SensitivityRequest = {
    variableId: 'cost', samples: [{ sort: 'int', value: '1' }, { sort: 'int', value: '1000' }],
    observe: ['cost'], operation: 'feasibility'
  }
  await assert.rejects(Workflow.sensitivity(adapter, input, request, { limits: { maxNumericDigits: 8 } }), /maxNumericDigits/)
  assert.equal(submitted.length, 0)
  const report = await Workflow.sensitivity(adapter, input, request, { limits: { maxNumericDigits: 9 } })
  assert.equal(submitted.length, 2)
  assert.notEqual(submitted[0], submitted[1])
  assert.ok(submitted.every(digest => digest !== sourceDigest))
  assert.equal(report.modelDigest, sourceDigest)
  for (const [index, point] of report.points.entries()) {
    assert.equal(point.report.modelDigest, sourceDigest)
    assert.equal(point.report.explanation.run.modelDigest, sourceDigest)
    const outcome = point.report.explanation.outcome
    assert.equal(outcome.status, 'satisfied')
    if (outcome.status !== 'satisfied') throw new Error('expected real feasible assignment')
    assert.deepEqual(outcome.assignments.find(value => value.id === 'cost')?.value, request.samples[index])
  }
  assert.equal(report.transitions.length, 1)
  assert.equal(report.transitions[0]!.afterIndex, 0)
  assert.deepEqual(report.unknownRegions, [])
})

test('rejects overflowing deadlines without poisoning subsequent checks', async () => {
  const runtime = await runtimePromise
  const model: Model.t = { schema: Model.schema, variables: [], constraints: [] }
  for (const timeoutMs of [2147483648, Number.MAX_SAFE_INTEGER]) {
    const result = await Solve.run(runtime, model, { limits: { timeoutMs } })
    assert.equal(result.status, 'unknown')
    if (result.status !== 'unknown') return
    assert.equal(result.reason.kind, 'backend-error')
    assert.match(result.reason.message, /timeoutMs.*1\.\.2147483647/)
  }
  assert.equal((await Solve.run(runtime, model, { limits: { timeoutMs: 2147483647 } })).status, 'satisfied')
})

test('initializes one lazy process runtime', async () => {
  const runtime = await runtimePromise
  assert.strictEqual(await create(), runtime)
  assert.match(runtime.backend.version, /5\.1\.0/)
  assert.ok(runtime.initializationMs > 0)
})

test('compiles Boolean, bounded integer, exact rational, and finite enum values', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    enums: [{ id: 'architecture', values: ['monolith', 'microservices'] }],
    variables: [
      { id: 'available', sort: 'bool' },
      { id: 'team-size', sort: 'int', min: 1, max: 100 },
      { id: 'cost', sort: 'real' },
      { id: 'choice', sort: 'enum', domain: 'architecture' }
    ],
    constraints: [
      { id: 'available', expression: ref('available') },
      { id: 'team', expression: { kind: 'eq', left: ref('team-size'), right: int(12) } },
      { id: 'cost', expression: { kind: 'eq', left: ref('cost'), right: real('0.10000000000000000000') } },
      {
        id: 'exact-division',
        expression: {
          kind: 'eq',
          left: { kind: 'divide', left: int(1), right: int(2) },
          right: real('0.5')
        }
      },
      {
        id: 'choice',
        expression: {
          kind: 'eq',
          left: ref('choice'),
          right: { kind: 'literal', sort: 'enum', domain: 'architecture', value: 'microservices' }
        }
      }
    ]
  }
  const result = await Solve.run(runtime, model)
  assert.equal(result.status, 'satisfied')
  if (result.status !== 'satisfied') return
  assert.deepEqual(result.assignment, {
    available: { sort: 'bool', value: true },
    choice: { sort: 'enum', domain: 'architecture', value: 'microservices' },
    cost: { sort: 'real', numerator: '1', denominator: '10' },
    'team-size': { sort: 'int', value: '12' }
  })
})

test('Boolean translation matches truth tables and mixed numeric conditional branches', async () => {
  const runtime = await runtimePromise
  const bool = (value: boolean): Model.Expression => ({ kind: 'literal', sort: 'bool', value })
  for (const a of [false, true]) for (const b of [false, true]) {
    const left = ref('a'), right = ref('b')
    const cases: [string, Model.Expression, boolean][] = [
      ['not', { kind: 'not', value: left }, !a],
      ['and', { kind: 'and', operands: [left, right] }, a && b],
      ['or', { kind: 'or', operands: [left, right] }, a || b],
      ['implies', { kind: 'implies', left, right }, !a || b],
      ['eq', { kind: 'eq', left, right }, a === b],
      ['neq', { kind: 'neq', left, right }, a !== b],
      ['if', { kind: 'if', condition: left, then: right, else: { kind: 'not', value: right } }, a ? b : !b]
    ]
    const model: Model.t = { schema: Model.schema,
      variables: [{ id: 'a', sort: 'bool' }, { id: 'b', sort: 'bool' }],
      constraints: [
        { id: 'fix-a', expression: { kind: 'eq', left, right: bool(a) } },
        { id: 'fix-b', expression: { kind: 'eq', left: right, right: bool(b) } },
        ...cases.map(([id, expression, expected]): Model.HardConstraint => ({ id,
          expression: { kind: 'eq', left: expression, right: bool(expected) } })),
        { id: 'numeric-if', expression: { kind: 'eq',
          left: { kind: 'if', condition: left, then: real('0.5'), else: int(2) },
          right: real(a ? '0.5' : '2') } }
      ] }
    const result = await Solve.run(runtime, model)
    assert.equal(result.status, 'satisfied', `a=${a}, b=${b}: ${JSON.stringify(result)}`)
    if (result.status !== 'satisfied') assert.fail('expected translated truth table')
    assert.deepEqual(result.assignment, { a: { sort: 'bool', value: a }, b: { sort: 'bool', value: b } })
  }
})

test('maps an unsatisfiable core back to stable constraint IDs', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'deploy', sort: 'bool' }],
    constraints: [
      { id: 'policy/must-deploy', expression: ref('deploy') },
      { id: 'policy/must-not-deploy', expression: { kind: 'not', value: ref('deploy') } }
    ]
  }
  for (const optimize of [false, true]) {
    const input: Model.t = optimize ? { ...model,
      objectives: [{ id: 'constant', direction: 'minimize', expression: int(0) }] } : model
    const before = JSON.stringify(input)
    const result = await Solve.run(runtime, input, { unsatCore: true })
    assert.equal(result.status, 'unsatisfied')
    if (result.status !== 'unsatisfied') assert.fail('expected proved infeasibility')
    assert.equal(result.infeasibilityProved, true)
    assert.deepEqual(result.core, ['policy/must-deploy', 'policy/must-not-deploy'])
    assert.equal(JSON.stringify(input), before)
  }
})

test('renders a real Z3 core with CAVE evidence and scenario inputs', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'deploy', sort: 'bool' }],
    constraints: [
      {
        id: 'policy/must-deploy', expression: ref('deploy'),
        declaration: { uri: 'models/release.cave', line: 3 },
        evidenceRowIds: ['row:release-policy'], scenarioInputIds: ['release-window']
      },
      {
        id: 'policy/must-not-deploy', expression: { kind: 'not', value: ref('deploy') },
        declaration: { uri: 'models/release.cave', line: 4 },
        evidenceRowIds: ['row:freeze'], scenarioInputIds: ['release-window']
      }
    ]
  }
  const report = await Solve.runWithExplanation(runtime, model, { unsatCore: true }, {
    inputs: [{
      id: 'release-window', authoredValue: 'Friday 17:00',
      evidenceRowIds: ['row:release-policy', 'row:freeze'], scenarioClaimIds: []
    }]
  })
  assert.equal(report.outcome.status, 'unsatisfied')
  if (report.outcome.status !== 'unsatisfied') return
  assert.deepEqual(report.outcome.core?.map(constraint => ({
    id: constraint.id,
    declaration: constraint.declaration,
    evidenceRowIds: constraint.evidenceRowIds,
    scenarioInputIds: constraint.scenarioInputIds
  })), [
    {
      id: 'policy/must-deploy', declaration: { uri: 'models/release.cave', line: 3 },
      evidenceRowIds: ['row:release-policy'], scenarioInputIds: ['release-window']
    },
    {
      id: 'policy/must-not-deploy', declaration: { uri: 'models/release.cave', line: 4 },
      evidenceRowIds: ['row:freeze'], scenarioInputIds: ['release-window']
    }
  ])
})

test('canonical enum coding is stable across declaration reordering', async () => {
  const runtime = await runtimePromise
  const fixture = (values: readonly string[]): Model.t => ({
    schema: Model.schema,
    enums: [{ id: 'architecture', values }],
    variables: [{ id: 'choice', sort: 'enum', domain: 'architecture' }],
    constraints: []
  })
  const [left, right] = await Promise.all([
    Solve.run(runtime, fixture(['microservices', 'monolith'])),
    Solve.run(runtime, fixture(['monolith', 'microservices']))
  ])
  assert.equal(left.status, 'satisfied')
  assert.equal(right.status, 'satisfied')
  if (left.status === 'satisfied' && right.status === 'satisfied') {
    assert.deepEqual(left.assignment, right.assignment)
  }
})

test('enum literal codes preserve exact members and refresh after domain mutation', async () => {
  const runtime = await runtimePromise
  const values = ['z-last', '', '__proto__', 'constructor', 'é', 'e\u0301', '😀']
  for (const target of [...values]) {
    const literal: Model.Expression = { kind: 'literal', sort: 'enum', domain: 'D', value: target }
    const model: Model.t = { schema: Model.schema, enums: [{ id: 'D', values }],
      variables: [{ id: 'choice', sort: 'enum', domain: 'D' }], constraints: [
        { id: 'choose', expression: { kind: 'eq', left: ref('choice'), right: literal } },
        { id: 'repeat', expression: { kind: 'eq', left: literal, right: { ...literal } } }
      ] }
    let previous: Adapter.Result | undefined
    for (const changed of [false, true]) {
      if (changed) { values.reverse(); values.push(`added-${values.length}`) }
      const before = JSON.stringify(model)
      const result = await Solve.run(runtime, model)
      assert.equal(result.status, 'satisfied')
      if (result.status !== 'satisfied') assert.fail('expected enum assignment')
      assert.deepEqual(result.assignment.choice, { sort: 'enum', domain: 'D', value: target })
      assert.equal(JSON.stringify(model), before)
      if (previous?.status === 'satisfied') assert.deepEqual(previous.assignment, result.assignment)
      previous = result
    }
  }
})

test('minimizes, maximizes, and applies objectives lexicographically', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [
      { id: 'cost', sort: 'int', min: 0, max: 10 },
      { id: 'capacity', sort: 'int', min: 0, max: 10 }
    ],
    constraints: [
      { id: 'cost-floor', expression: { kind: 'gte', left: ref('cost'), right: int(3) } },
      { id: 'capacity-ceiling', expression: { kind: 'lte', left: ref('capacity'), right: int(8) } }
    ],
    softConstraints: [{
      id: 'prefer-expensive',
      expression: { kind: 'eq', left: ref('cost'), right: int(10) },
      weight: '100'
    }],
    objectives: [
      { id: 'min-cost', direction: 'minimize', expression: ref('cost') },
      { id: 'max-capacity', direction: 'maximize', expression: ref('capacity') }
    ]
  }
  const result = await Solve.run(runtime, model)
  assert.equal(result.status, 'optimal')
  if (result.status !== 'optimal') return
  assert.deepEqual(result.assignment, {
    capacity: { sort: 'int', value: '8' },
    cost: { sort: 'int', value: '3' }
  })
  assert.deepEqual(result.objectives, [
    { objectiveId: 'min-cost', value: { sort: 'int', value: '3' } },
    { objectiveId: 'max-capacity', value: { sort: 'int', value: '8' } }
  ])
})

test('competing objectives follow declaration priority ahead of soft preferences', async () => {
  const runtime = await runtimePromise
  const objectives: Model.Objective[] = [
    { id: 'first-x', direction: 'minimize', expression: ref('x') },
    { id: 'second-y', direction: 'minimize', expression: ref('y') }
  ]
  const model: Model.t = { schema: Model.schema,
    variables: ['x', 'y'].map(id => ({ id, sort: 'int', min: 0, max: 10 })),
    constraints: [{ id: 'tradeoff', expression: { kind: 'gte',
      left: { kind: 'add', operands: [ref('x'), ref('y')] }, right: int(10) } }],
    softConstraints: [{ id: 'prefer-middle', weight: '1000000',
      expression: { kind: 'eq', left: ref('x'), right: int(5) } }], objectives }
  const results: Adapter.Result[] = []
  for (const reversed of [false, true]) {
    if (reversed) objectives.reverse()
    const before = JSON.stringify(model)
    const result = await Solve.run(runtime, model)
    assert.equal(result.status, 'optimal')
    if (result.status !== 'optimal') assert.fail('expected proved lexicographic optimum')
    assert.equal(result.optimalityProved, true)
    assert.deepEqual(result.assignment, {
      x: { sort: 'int', value: reversed ? '10' : '0' },
      y: { sort: 'int', value: reversed ? '0' : '10' }
    })
    assert.deepEqual(result.objectives, objectives.map((objective, index) => ({
      objectiveId: objective.id, value: { sort: 'int', value: index === 0 ? '0' : '10' }
    })))
    assert.equal(JSON.stringify(model), before)
    results.push(result)
  }
  const first = results[0]!
  assert.equal(first.status, 'optimal')
  if (first.status === 'optimal') assert.deepEqual(first.assignment.x, { sort: 'int', value: '0' })
})

test('uses explicit soft weights without consulting belief confidence', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'choice', sort: 'int', min: 0, max: 2 }],
    constraints: [],
    softConstraints: [
      { id: 'weak', expression: { kind: 'eq', left: ref('choice'), right: int(1) }, weight: '1' },
      { id: 'strong', expression: { kind: 'eq', left: ref('choice'), right: int(2) }, weight: '5.0' }
    ]
  }
  const result = await Solve.run(runtime, model)
  assert.equal(result.status, 'optimal')
  if (result.status !== 'optimal') return
  assert.deepEqual(result.assignment.choice, { sort: 'int', value: '2' })
})

test('fractional soft weights preserve distinctions below binary64 precision', async () => {
  const runtime = await runtimePromise
  const scale = 1n << 256n
  const weak = { numerator: '1', denominator: '3' }
  const strong = { numerator: String(scale + 1n), denominator: String(3n * scale) }
  assert.equal(Number(strong.numerator) / Number(strong.denominator), 1 / 3,
    'the fixture must lose its distinction under binary64 conversion')
  for (const preferred of [true, false]) {
    const model: Model.t = {
      schema: Model.schema,
      variables: [{ id: 'choice', sort: 'bool' }],
      constraints: [],
      softConstraints: [
        { id: 'prefer-true', expression: ref('choice'), weight: preferred ? strong : weak },
        { id: 'prefer-false', expression: { kind: 'not', value: ref('choice') }, weight: preferred ? weak : strong }
      ]
    }
    const result = await Solve.run(runtime, model)
    assert.equal(result.status, 'optimal')
    if (result.status !== 'optimal') assert.fail('expected a proved soft-constraint optimum')
    assert.deepEqual(result.assignment.choice, { sort: 'bool', value: preferred })
    assert.deepEqual(model.softConstraints![0]!.weight, preferred ? strong : weak)
  }
})

test('queues simultaneous solve requests without sharing solver state', async () => {
  const runtime = await runtimePromise
  const fixture = (value: number): Model.t => ({
    schema: Model.schema,
    variables: [{ id: 'x', sort: 'int', min: 0, max: 10 }],
    constraints: [{ id: `x-${value}`, expression: { kind: 'eq', left: ref('x'), right: int(value) } }]
  })
  const [left, right] = await Promise.all([
    Solve.run(runtime, fixture(2)),
    Solve.run(runtime, fixture(9))
  ])
  assert.equal(left.status, 'satisfied')
  assert.equal(right.status, 'satisfied')
  if (left.status === 'satisfied') assert.deepEqual(left.assignment.x, { sort: 'int', value: '2' })
  if (right.status === 'satisfied') assert.deepEqual(right.assignment.x, { sort: 'int', value: '9' })
})

test('reports an actual solver deadline as unknown rather than infeasible', async () => {
  const runtime = await runtimePromise
  const size = 80
  const variables: Model.Variable[] = Array.from(
    { length: size },
    (_, index) => ({ id: `p${index}`, sort: 'int', min: 0, max: size - 2 })
  )
  const constraints: Model.HardConstraint[] = []
  for (let left = 0; left < size; left += 1) {
    for (let right = left + 1; right < size; right += 1) {
      constraints.push({
        id: `different-${left}-${right}`,
        expression: { kind: 'neq', left: ref(`p${left}`), right: ref(`p${right}`) }
      })
    }
  }
  const result = await Solve.run(runtime, { schema: Model.schema, variables, constraints }, {
    limits: { timeoutMs: 1 }
  })
  assert.equal(result.status, 'unknown')
  if (result.status !== 'unknown') return
  assert.equal(result.reason.kind, 'timeout')
  assert.equal(result.reason.limit, 'timeoutMs')
  const timedOut = JSON.stringify(result)
  const recovered = await Solve.run(runtime, {
    schema: Model.schema, variables: [{ id: 'ready', sort: 'bool' }],
    constraints: [{ id: 'require-ready', expression: ref('ready') }]
  })
  assert.equal(recovered.status, 'satisfied')
  if (recovered.status !== 'satisfied') assert.fail('same runtime must recover after timeout')
  assert.deepEqual(recovered.assignment.ready, { sort: 'bool', value: true })
  assert.equal(JSON.stringify(result), timedOut, 'later solve must preserve the timeout result')
})

test('enforces the portable output-size limit after solving', async () => {
  const runtime = await runtimePromise
  const result = await Solve.run(runtime, {
    schema: Model.schema,
    variables: [{ id: 'ok', sort: 'bool' }],
    constraints: [{ id: 'ok', expression: ref('ok') }]
  }, { limits: { maxOutputBytes: 1 } })
  assert.equal(result.status, 'unknown')
  if (result.status !== 'unknown') return
  assert.equal(result.reason.kind, 'resource-limit')
  assert.equal(result.reason.limit, 'maxOutputBytes')
})

test('maps Z3 memory exhaustion to the portable resource-limit result', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'ok', sort: 'bool' }],
    constraints: [{ id: 'ok', expression: ref('ok') }]
  }
  const limited = await Solve.run(runtime, model, {
    limits: { maxMemoryBytes: 1024 * 1024 }
  })
  assert.equal(limited.status, 'unknown')
  if (limited.status !== 'unknown') return
  assert.equal(limited.reason.kind, 'resource-limit')
  assert.equal(limited.reason.limit, 'maxMemoryBytes')

  // Raising the next request's process-wide Z3 limit restores normal solving.
  assert.equal((await Solve.run(runtime, model)).status, 'satisfied')
})

test('a short-lived process terminates workers cleanly', async () => {
  const result = await run(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    new URL('./short-lived.ts', import.meta.url).pathname
  ], { timeout: 10_000 })
  assert.equal(result.stderr, '')
})

test('creation during shutdown waits for one usable replacement runtime', async () => {
  const result = await run(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    new URL('./reopen.ts', import.meta.url).pathname
  ], { timeout: 10_000 })
  assert.equal(result.stderr, '')
})

test('compiles deep expressions accepted by explicit depth limits', async () => {
  const runtime = await runtimePromise
  let expression: Model.Expression = ref('ok')
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const result = await Solve.run(runtime, {
    schema: Model.schema,
    variables: [{ id: 'ok', sort: 'bool' }],
    constraints: [{ id: 'deep', expression }]
  }, { limits: { maxExpressionDepth: 20_001 } })
  assert.equal(result.status, 'satisfied', JSON.stringify(result))
  if (result.status === 'satisfied') assert.deepEqual(result.assignment.ok, { sort: 'bool', value: true })
})

test('shared compiled terms preserve every operand occurrence and request isolation', async () => {
  const runtime = await runtimePromise
  const factor: Model.Expression = { kind: 'add', operands: [ref('x'), int(1)] }
  const square: Model.Expression = { kind: 'multiply', operands: [factor, factor] }
  for (const value of [2, 3]) {
    const result = await Solve.run(runtime, {
      schema: Model.schema,
      variables: [{ id: 'x', sort: 'int', min: value, max: value }],
      constraints: [
        { id: 'square', expression: { kind: 'eq', left: square, right: int((value + 1) ** 2) } },
        { id: 'positive', expression: { kind: 'gt', left: square, right: int(0) } }
      ]
    })
    assert.equal(result.status, 'satisfied', JSON.stringify(result))
    if (result.status === 'satisfied') assert.deepEqual(result.assignment.x, { sort: 'int', value: String(value) })
  }
})


test('direct adapter calls reject cyclic expressions without hanging compilation', async () => {
  const runtime = await runtimePromise
  const expression = { kind: 'not', value: ref('ok') } as { kind: 'not', value: Model.Expression }
  expression.value = expression
  const result = await runtime.solve({
    schema: Model.schema,
    variables: [{ id: 'ok', sort: 'bool' }],
    constraints: [{ id: 'cycle', expression }]
  }, { limits: Adapter.defaultLimits, unsatCore: false })
  assert.equal(result.status, 'unknown')
  if (result.status === 'unknown') {
    assert.equal(result.reason.kind, 'backend-error')
    assert.match(result.reason.message, /cyclic solver expression/)
  }
})

test('compiles Boolean fan-out at the default expression-node limit', async () => {
  const runtime = await runtimePromise
  for (const kind of ['and', 'or'] as const) {
    const neutral: Model.Expression = { kind: 'literal', sort: 'bool', value: kind === 'and' }
    const decisive: Model.Expression = { kind: 'literal', sort: 'bool', value: kind === 'or' }
    const operands = Array<Model.Expression>(Adapter.defaultLimits.maxExpressionNodes - 1).fill(neutral)
    operands[operands.length - 1] = decisive
    const result = await Solve.run(runtime, {
      schema: Model.schema,
      variables: [],
      constraints: [{ id: 'wide', expression: { kind, operands } }]
    })
    assert.equal(result.status, kind === 'and' ? 'unsatisfied' : 'satisfied', JSON.stringify(result))
  }
})

test('submits all domain bounds when variable limits are raised', async () => {
  const runtime = await runtimePromise
  const count = 75_000
  const variables: Model.Variable[] = Array.from({ length: count }, (_, index) => ({ id: `v${index}`, sort: 'int', min: 0, max: 1 }))
  for (const optimize of [false, true]) {
    const result = await Solve.run(runtime, {
      schema: Model.schema,
      variables,
      constraints: [{ id: 'outside-last-domain', expression: { kind: 'lt', left: ref(`v${count - 1}`), right: int(0) } }],
      ...(optimize ? { objectives: [{ id: 'constant', direction: 'minimize' as const, expression: int(0) }] } : {})
    }, { limits: { maxVariables: count, maxNumericDigits: count * 2 + 2, timeoutMs: 30_000 } })
    assert.equal(result.status, 'unsatisfied', JSON.stringify(result))
  }
})

test('unsat-core tracker symbols cannot collide with user variables', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'cave.constraint.policy', sort: 'bool' }],
    constraints: [{ id: 'policy', expression: { kind: 'not', value: ref('cave.constraint.policy') } }]
  }
  for (const unsatCore of [false, true]) {
    const result = await Solve.run(runtime, model, { unsatCore })
    assert.equal(result.status, 'satisfied', JSON.stringify(result))
    if (result.status === 'satisfied') assert.deepEqual(result.assignment['cave.constraint.policy'], { sort: 'bool', value: false })
  }
  const unsatisfied = await Solve.run(runtime, {
    ...model,
    constraints: [...model.constraints, { id: 'required', expression: ref('cave.constraint.policy') }]
  }, { unsatCore: true })
  assert.equal(unsatisfied.status, 'unsatisfied')
  if (unsatisfied.status === 'unsatisfied') assert.deepEqual(unsatisfied.core, ['policy', 'required'])
})

test('does not claim an optimum for unbounded or unattained real objectives', async () => {
  const runtime = await runtimePromise
  for (const direction of ['minimize', 'maximize'] as const) {
    for (const strict of [false, true]) {
      const result = await Solve.run(runtime, {
        schema: Model.schema,
        variables: [{ id: 'x', sort: 'real' }],
        constraints: strict ? [{ id: 'open-bound', expression: { kind: direction === 'minimize' ? 'gt' : 'lt', left: ref('x'), right: real('0') } }] : [],
        objectives: [{ id: 'x', direction, expression: ref('x') }]
      })
      assert.equal(result.status, 'unknown', JSON.stringify(result))
      if (result.status === 'unknown') assert.equal(result.reason.kind, 'indeterminate')
    }
  }
})

test('proves attained exact rational optima in both directions', async () => {
  const runtime = await runtimePromise
  for (const direction of ['minimize', 'maximize'] as const) {
    const result = await Solve.run(runtime, {
      schema: Model.schema,
      variables: [{ id: 'x', sort: 'real', min: { numerator: '1', denominator: '3' }, max: { numerator: '1', denominator: '3' } }],
      constraints: [],
      objectives: [{ id: 'x', direction, expression: ref('x') }]
    })
    assert.equal(result.status, 'optimal', JSON.stringify(result))
    if (result.status === 'optimal') assert.deepEqual(result.objectives[0]?.value, { sort: 'real', numerator: '1', denominator: '3' })
  }
})

test('checks attainment of later lexicographic objectives', async () => {
  const runtime = await runtimePromise
  const result = await Solve.run(runtime, {
    schema: Model.schema,
    variables: [{ id: 'x', sort: 'real' }],
    constraints: [{ id: 'positive', expression: { kind: 'gt', left: ref('x'), right: real('0') } }],
    objectives: [
      { id: 'first', direction: 'minimize', expression: int(0) },
      { id: 'second', direction: 'minimize', expression: ref('x') }
    ]
  })
  assert.equal(result.status, 'unknown', JSON.stringify(result))
  if (result.status === 'unknown') assert.equal(result.reason.kind, 'indeterminate')
})
