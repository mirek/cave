import { test } from 'node:test'
import { ExplanationBudget } from '../src/explanation-budget.ts'
import { expressionKey } from '../src/expression-key.ts'
import * as assert from 'node:assert/strict'
import { Adapter, Canonical, Explain, Model, Solve, Workflow } from '@cavelang/solver'

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const int = (value: Model.Integer): Model.Expression => ({ kind: 'literal', sort: 'int', value })

test('compact expression strings preserve enum domains, values and literal sorts', () => {
  const strings = new Map<string, number>()
  const domain = 'domain'.repeat(1024)
  const value = 'value'.repeat(1024)
  const expressions: Model.Expression[] = [
    { kind: 'literal', sort: 'enum', domain, value },
    { kind: 'literal', sort: 'enum', domain: `${domain}\nother`, value },
    { kind: 'literal', sort: 'enum', domain, value: `${value}\nother` },
    { kind: 'literal', sort: 'enum', domain, value: '0' },
    { kind: 'literal', sort: 'int', value: '0' },
    { kind: 'literal', sort: 'int', value: 0 },
    ref(domain), ref(value)
  ]
  const keys = expressions.map(expression => expressionKey(expression, strings))
  assert.equal(new Set(keys).size, expressions.length)
  for (const [index, expression] of expressions.entries()) {
    assert.equal(expressionKey(structuredClone(expression), strings), keys[index])
  }
})

test('compact expression references keep distinct long identifiers and report assignments isolated', () => {
  const ids = ['x'.repeat(8192), 'x'.repeat(8192) + 'y']
  const input: Model.t = { schema: Model.schema, variables: ids.map(id => ({ id, sort: 'bool' })),
    constraints: [0, 1, 0, 1].map((at, index) => ({ id: `c${index}`, expression: ref(ids[at]!) })) }
  for (const flipped of [false, true]) {
    const result: Adapter.Result = { status: 'satisfied', assignment: {
      [ids[0]!]: { sort: 'bool', value: !flipped }, [ids[1]!]: { sort: 'bool', value: flipped }
    }, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
    const report = Explain.report(input, result, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected backend result')
    assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation),
      flipped ? ['violated', 'satisfied', 'violated', 'satisfied'] : ['satisfied', 'violated', 'satisfied', 'violated'])
  }
})

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

test('explanation comparison preserves reinforcing and opposing fraction orders', () => {
  const real = (numerator: number, denominator: number): Model.Expression => ({
    kind: 'literal', sort: 'real', value: { numerator, denominator }
  })
  const cases = [[1, 7, 3, 5], [3, 5, 1, 7], [-3, 5, -1, 7], [-1, 7, -3, 5],
    [2, 3, 3, 4], [3, 4, 2, 3], [-2, 3, -3, 4], [-3, 4, -2, 3]] as const
  const input: Model.t = { schema: Model.schema, variables: [], constraints: cases.map(([a, b, c, d], index) => ({
    id: `order-${index}`, expression: {
      kind: a * d < c * b ? 'lt' : 'gt', left: real(a, b), right: real(c, d)
    }
  })) }
  const report = Explain.report(input, { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
  if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied report')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), cases.map(() => 'satisfied'))
})

test('explanation bigint intermediates preserve reduced fractions, signs and zero', () => {
  const real = (numerator: string, denominator: string): Model.Expression => ({
    kind: 'literal', sort: 'real', value: { numerator, denominator }
  })
  const cases: [Model.Expression, Model.Expression][] = [
    [{ kind: 'add', operands: [real('1', '2'), real('1', '3')] }, real('5', '6')],
    [{ kind: 'divide', left: real('1', '2'), right: real('-3', '4') }, real('-2', '3')],
    [{ kind: 'multiply', operands: [real('-2', '3'), real('9', '4')] }, real('-3', '2')],
    [{ kind: 'add', operands: [real('-2', '3'), real('2', '3')] }, real('0', '1')],
    [{ kind: 'divide', left: real('0', '1'), right: real('-2', '3') }, real('0', '1')],
    [{ kind: 'subtract', left: real('1', '3'), right: real('5', '6') }, real('-1', '2')]
  ]
  const input: Model.t = { schema: Model.schema, variables: [], constraints: cases.map(([left, right], index) => ({
    id: `arithmetic-${index}`, expression: { kind: 'eq', left, right }
  })) }
  const report = Explain.report(input, { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied report')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), cases.map(() => 'satisfied'))
})

test('explanation equality compares canonical fractions across signs, zero and scaling', () => {
  const cases: [string, string, string, string, boolean][] = [
    ['2', '4', '1', '2', true], ['2', '-4', '-1', '2', true],
    ['0', '-7', '0', '1', true], ['1', '2', '2', '3', false],
    ['1', '2', '1', '3', false], ['-1', '2', '1', '2', false]
  ]
  const real = (numerator: string, denominator: string): Model.Expression => ({
    kind: 'literal', sort: 'real', value: { numerator, denominator }
  })
  const constraints = cases.flatMap(([a, b, c, d], index) =>
    (['eq', 'neq'] as const).map(kind => ({ id: `${kind}-${index}`,
      expression: { kind, left: real(a, b), right: real(c, d) } })))
  const report = Explain.report({ schema: Model.schema, variables: [], constraints },
    { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
  if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied report')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation),
    cases.flatMap(([, , , , equal]) => equal ? ['satisfied', 'violated'] : ['violated', 'satisfied']))
})

test('zero products retain operand errors in hard and soft explanations', () => {
  const undefinedArithmetic: Model.Expression = {
    kind: 'divide', left: int(1), right: { kind: 'subtract', left: int(1), right: int(1) }
  }
  const operands: Model.Expression[][] = [
    [int(0), int(-7), int(11)], [int(-7), int(11), int(0)],
    [int(0), undefinedArithmetic], [undefinedArithmetic, int(0)]
  ]
  const constraints = operands.map((operands, index): Model.HardConstraint => ({
    id: `zero-${index}`, expression: { kind: 'eq',
      left: { kind: 'multiply', operands }, right: int(0) }
  }))
  const input: Model.t = { schema: Model.schema, variables: [], constraints,
    softConstraints: constraints.map(value => ({ ...value, id: `soft-${value.id}`, weight: '1' })) }
  const report = Explain.report(input, { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
  if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied report')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation),
    ['satisfied', 'satisfied', 'indeterminate', 'indeterminate'])
  assert.deepEqual(report.outcome.softConstraints.map(value => value.evaluation),
    ['accepted', 'accepted', 'indeterminate', 'indeterminate'])
})

test('cancelling sums retain undefined operands in hard and soft explanations', () => {
  const undefinedArithmetic: Model.Expression = {
    kind: 'divide', left: int(1), right: { kind: 'subtract', left: int(1), right: int(1) }
  }
  const fraction = (numerator: string): Model.Expression => ({ kind: 'literal', sort: 'real',
    value: { numerator, denominator: '100000000000000000000000000003' } })
  const positive = fraction('7'), negative = fraction('-7')
  const operands: Model.Expression[][] = [
    [positive, negative, int(0)],
    [undefinedArithmetic, positive, negative],
    [positive, undefinedArithmetic, negative],
    [positive, negative, undefinedArithmetic],
  ]
  const constraints = operands.map((operands, index): Model.HardConstraint => ({
    id: `sum-${index}`, expression: { kind: 'eq', left: { kind: 'add', operands }, right: int(0) }
  }))
  const input: Model.t = { schema: Model.schema, variables: [], constraints,
    softConstraints: constraints.map(constraint => ({ ...constraint, id: `soft-${constraint.id}`, weight: '1' })) }
  const report = Explain.report(input, { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
  if (report.outcome.status !== 'satisfied') assert.fail('expected a satisfied report')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation),
    ['satisfied', 'indeterminate', 'indeterminate', 'indeterminate'])
  assert.deepEqual(report.outcome.softConstraints.map(value => value.evaluation),
    ['accepted', 'indeterminate', 'indeterminate', 'indeterminate'])
})

test('normalized assignment reuse stays local to each report and its hard and soft constraints', () => {
  const value = { sort: 'int' as const, value: '2' }
  const result: Adapter.Result = { ...common, status: 'satisfied', assignment: { replicas: value } }
  const first = Explain.report(model(), result, Adapter.defaultLimits)
  if (first.outcome.status !== 'satisfied') assert.fail('expected satisfied report')
  assert.equal(first.outcome.hardConstraints[0]!.evaluation, 'violated')
  assert.equal(first.outcome.softConstraints[0]!.evaluation, 'violated')
  const before = JSON.stringify(first)
  value.value = '4'
  const next = Explain.report(model(), result, Adapter.defaultLimits)
  if (next.outcome.status !== 'satisfied') assert.fail('expected satisfied report')
  assert.equal(next.outcome.hardConstraints[0]!.evaluation, 'satisfied')
  assert.equal(next.outcome.softConstraints[0]!.evaluation, 'accepted')
  assert.deepEqual(next.outcome.assignments[0]!.value, { sort: 'int', value: '4' })
  assert.equal(JSON.stringify(first), before)
})

test('explanations capture backend assignments once before evaluating constraints', () => {
  let reads = 0
  const assignment = { get replicas(): Model.Value {
    return { sort: 'int', value: ++reads === 1 ? '3' : '0' }
  } }
  const report = Explain.report(model(), { ...common, status: 'satisfied', assignment }, Adapter.defaultLimits)
  assert.equal(reads, 1)
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible explanation')
  assert.deepEqual(report.outcome.assignments[0]!.value, { sort: 'int', value: '3' })
  assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied')
  assert.equal(reads, 1)
})

test('completed explanations own their backend values, context and declaration data', async () => {
  for (const direct of [true, false]) {
    const declaration = { uri: 'original.cave', line: 1 }
    const input = { ...model(), variables: [{ id: 'replicas', sort: 'int' as const, min: 1, max: 10, declaration }] }
    const backend = { name: 'original', version: '1' }
    const value = { sort: 'int' as const, value: '3' }
    const diagnostics = [{ level: 'info' as const, code: 'fixture', message: 'original' }]
    const result = { status: 'satisfied' as const, backend, elapsedMs: 1, assignment: { replicas: value }, diagnostics }
    const limits = { ...Adapter.defaultLimits }
    const context = { inputs: [{ id: 'input', value: { label: 'original' }, evidenceRowIds: ['row:original'], scenarioClaimIds: [] }] }
    const report = direct ? Explain.report(input, result, limits, context)
      : await Solve.runWithExplanation(adapter(result), input, { limits }, context)
    const before = structuredClone(report)
    backend.name = 'changed'
    value.value = '9'
    diagnostics[0]!.message = 'changed'
    declaration.uri = 'changed.cave'
    context.inputs[0]!.value.label = 'changed'
    context.inputs[0]!.evidenceRowIds.push('row:changed')
    limits.timeoutMs = 1
    assert.deepEqual(report, before, direct ? 'direct report' : 'solved report')
  }
})

test('explanations retain submitted model and context while the backend is pending', async () => {
  const input = { schema: Model.schema, variables: [{ id: 'flag', sort: 'bool' as const, description: 'submitted' }], constraints: [] }
  const context = { inputs: [{ id: 'source', value: 'submitted', evidenceRowIds: ['row:original'], scenarioClaimIds: [] }] }
  const digest = Canonical.digest(input)
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const backend: Adapter.t = {
    ...adapter({ ...common, status: 'satisfied', assignment: { flag: { sort: 'bool', value: true } } }),
    solve: async submitted => {
      await pending
      assert.equal(submitted.variables[0]!.description, 'submitted')
      assert.ok(Object.isFrozen(submitted.variables[0]))
      return { ...common, status: 'satisfied', assignment: { flag: { sort: 'bool', value: true } } }
    },
  }
  const result = Solve.runWithExplanation(backend, input, {}, context)
  input.variables[0]!.description = 'edited'
  input.variables.push({ id: 'later', sort: 'bool', description: 'later' })
  context.inputs[0]!.value = 'edited'
  context.inputs[0]!.evidenceRowIds.push('row:later')
  finish()
  const report = await result
  assert.equal(report.run.modelDigest, digest)
  assert.equal(report.run.inputs[0]!.value, 'submitted')
  assert.deepEqual(report.run.inputs[0]!.evidenceRowIds, ['row:original'])
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status === 'satisfied') assert.equal(report.outcome.assignments[0]!.description, 'submitted')
  assert.equal(Object.isFrozen(input.variables), false)
})

test('mismatched replay digests reject before backend execution', async () => {
  let invoked = false
  const backend: Adapter.t = {
    ...adapter({ ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'unused' } }),
    solve: async () => { invoked = true; throw new Error('must not execute') },
  }
  await assert.rejects(Solve.runWithExplanation(backend, model(), {}, { modelDigest: `sha256:${'0'.repeat(64)}` }), /does not match/)
  assert.equal(invoked, false)
})

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

test('explanations retain the configured model limits when computing identity', async () => {
  const input: Model.t = { schema: Model.schema, variables: Array.from({ length: 1001 }, (_, index) => ({ id: `flag${index}`, sort: 'bool' })), constraints: [] }
  const result: Adapter.Result = { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }
  const report = await Solve.runWithExplanation(adapter(result), input, { limits: { maxVariables: 1001 } })
  assert.equal(report.run.limits.maxVariables, 1001)
  const replay = await Solve.runWithExplanation(adapter(result), input, { limits: { maxVariables: 1001 } }, { modelDigest: report.run.modelDigest })
  assert.equal(replay.run.modelDigest, report.run.modelDigest)
})

test('deep solved models produce explanations with their submitted identity', async () => {
  let expression: Model.Expression = { kind: 'literal', sort: 'bool', value: true }
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'deep', expression }] }
  const limits = { maxExpressionDepth: 20_001 }
  const result: Adapter.Result = { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }
  const digest = Canonical.digest(input, limits)
  const report = await Solve.runWithExplanation(adapter(result), input, { limits }, { modelDigest: digest })
  assert.equal(report.run.modelDigest, digest)
  assert.equal(report.outcome.status, 'unknown')
})

test('deep valid hard and soft constraints are evaluated rather than hidden as indeterminate', async () => {
  let expression: Model.Expression = { kind: 'literal', sort: 'bool', value: true }
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'deep', expression }], softConstraints: [{ id: 'prefer', expression, weight: '1' }] }
  const report = await Solve.runWithExplanation(adapter({ ...common, status: 'satisfied', assignment: {} }), input, { limits: { maxExpressionDepth: 20_001 } })
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status === 'satisfied') {
    assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied')
    assert.equal(report.outcome.softConstraints[0]!.evaluation, 'accepted')
  }
})

test('explanation evaluation preserves short-circuit logic and selected conditional branches', () => {
  const yes: Model.Expression = { kind: 'literal', sort: 'bool', value: true }
  const no: Model.Expression = { kind: 'literal', sort: 'bool', value: false }
  const undefinedArithmetic: Model.Expression = { kind: 'eq', left: { kind: 'divide', left: int(1), right: { kind: 'subtract', left: int(1), right: int(1) } }, right: int(1) }
  const expressions: Model.Expression[] = [
    { kind: 'and', operands: [no, undefinedArithmetic] },
    { kind: 'or', operands: [yes, undefinedArithmetic] },
    { kind: 'implies', left: no, right: undefinedArithmetic },
    { kind: 'if', condition: yes, then: yes, else: undefinedArithmetic },
    { kind: 'and', operands: [yes, undefinedArithmetic] },
  ]
  const input: Model.t = { schema: Model.schema, variables: [], constraints: expressions.map((expression, index) => ({ id: `check${index}`, expression })) }
  const report = Explain.report(input, { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
  if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied outcome')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), ['violated', 'satisfied', 'satisfied', 'satisfied', 'indeterminate'])
})

test('text explanations retain authored input values and their source references', () => {
  const report = Explain.report(model(), { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }, Adapter.defaultLimits, {
    inputs: [
      { id: 'authored', authoredValue: '3K rps', evidenceRowIds: ['row:b', 'row:a'], scenarioClaimIds: ['claim:override'] },
      { id: 'both', value: 3000, authoredValue: '3K rps', query: 'forecast', evidenceRowIds: [], scenarioClaimIds: [] },
      { id: 'null', value: null, evidenceRowIds: [], scenarioClaimIds: [] },
      { id: 'missing', evidenceRowIds: [], scenarioClaimIds: [] }
    ]
  })
  const text = Explain.render(report)
  assert.match(text, /Input authored: authored "3K rps" — rows row:a, row:b; scenario claims claim:override/)
  assert.match(text, /Input both: 3000; authored "3K rps" via forecast/)
  assert.match(text, /Input null: null/)
  assert.match(text, /Input missing: \(no value\)/)
  assert.doesNotMatch(text, /undefined/)
})

test('text explanations render deeply nested validated input values without call-stack overflow', () => {
  const depth = 20_000
  let nested: Explain.Json = 'leaf'
  let arrays: Explain.Json = 'leaf'
  for (let index = 0; index < depth; index++) { nested = { child: nested }; arrays = [arrays] }
  const report = Explain.report(model(), { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }, Adapter.defaultLimits, {
    inputs: [{ id: 'deep', value: nested, authoredValue: arrays, evidenceRowIds: [], scenarioClaimIds: [] }]
  })
  const expected = '{"child":'.repeat(depth) + '"leaf"' + '}'.repeat(depth)
  const expectedArray = '['.repeat(depth) + '"leaf"' + ']'.repeat(depth)
  assert.ok(Explain.render(report).includes(`Input deep: ${expected}; authored ${expectedArray}`))
})

test('text rendering validates copied input values before serialization', () => {
  const report = Explain.report(model(), { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }, Adapter.defaultLimits)
  for (const key of ['value', 'authoredValue']) {
    let reads = 0
    const changing = { get amount() { return ++reads === 1 ? 1 : NaN } }
    const supplied = { ...report, run: { ...report.run, inputs: [
      { id: 'changing', [key]: changing, evidenceRowIds: [], scenarioClaimIds: [] },
    ] } }
    assert.throws(() => Explain.render(supplied), /finite JSON value/)
  }
  const custom = Object.defineProperty({}, 'toJSON', { value: () => null })
  assert.throws(() => Explain.render({ ...report, run: { ...report.run, inputs: [
    { id: 'custom', value: custom, evidenceRowIds: [], scenarioClaimIds: [] },
  ] } }), /custom JSON serializer/)
})

test('input rendering preserves JSON ordering, escaping, arrays, and omitted optional properties', () => {
  const shared = { 'quote"\n': ['line\n', null, false, -0, Number.MIN_VALUE], omitted: undefined }
  const value = { '10': 'ten', '2': 'two', first: shared, second: shared, empty: {}, array: [] }
  const report = Explain.report(model(), { ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' } }, Adapter.defaultLimits, {
    inputs: [{ id: 'json', value, evidenceRowIds: [], scenarioClaimIds: [] }]
  })
  assert.ok(Explain.render(report).includes(`Input json: ${JSON.stringify(value)}`))
})

test('ambiguous or malformed explanation bindings fail before the backend runs', async () => {
  let calls = 0
  const backend: Adapter.t = { ...adapter({ ...common, status: 'satisfied', assignment: {} }), solve: async () => { calls++; return { ...common, status: 'satisfied', assignment: {} } } }
  const input = { id: 'source', evidenceRowIds: [], scenarioClaimIds: [] }
  const contexts = [
    null, [], { inputs: {} },
    { inputs: [input, input] },
    { inputs: [undefined] },
    { inputs: Array(1) },
    { inputs: [{ ...input, id: '' }] },
    { inputs: [{ ...input, evidenceRowIds: 'row:source' }] },
    { inputs: [{ ...input, scenarioClaimIds: [null] }] },
    { inputs: [{ ...input, evidenceRowIds: Array(1) }] },
    { inputs: [{ ...input, evidenceRowIds: [''] }] },
    { inputs: [{ ...input, query: 42 }] }
  ]
  for (const context of contexts) {
    const invalid = context as unknown as Explain.Context
    assert.throws(() => Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, invalid), TypeError)
    await assert.rejects(Solve.runWithExplanation(backend, model(), {}, invalid), TypeError)
    await assert.rejects(Workflow.feasibility(backend, model(), {}, invalid), TypeError)
  }
  assert.equal(calls, 0)
})

test('explanation values reject lossy or non-JSON payloads before solving', async () => {
  let calls = 0
  const backend: Adapter.t = { ...adapter({ ...common, status: 'satisfied', assignment: {} }), solve: async () => { calls++; return { ...common, status: 'satisfied', assignment: {} } } }
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  const payloads = [NaN, Infinity, -Infinity, 1n, Symbol('input'), () => 1, Object.defineProperty({}, 'toJSON', { value: () => null }), new Date(0), new Map(), cycle, [undefined], Array(1), { nested: NaN }]
  for (const payload of payloads) {
    for (const key of ['value', 'authoredValue']) {
      const context = { inputs: [{ id: 'source', [key]: payload, evidenceRowIds: [], scenarioClaimIds: [] }] } as unknown as Explain.Context
      assert.throws(() => Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, context), TypeError)
      await assert.rejects(Solve.runWithExplanation(backend, model(), {}, context), TypeError)
      await assert.rejects(Workflow.feasibility(backend, model(), {}, context), TypeError)
    }
  }
  assert.equal(calls, 0)
})

test('direct explanation reports validate captured context after changing getters', () => {
  for (const key of ['value', 'authoredValue']) {
    let reads = 0
    const input = Object.defineProperty({ id: 'source', evidenceRowIds: [], scenarioClaimIds: [] }, key, {
      enumerable: true,
      get: () => ++reads <= 2 ? 1 : NaN,
    })
    assert.throws(() => Explain.report(model(), { ...common, status: 'satisfied', assignment: {} },
      Adapter.defaultLimits, { inputs: [input] }), /finite JSON value/)
  }
  const inputs = [{ id: 'source', value: 1, evidenceRowIds: [], scenarioClaimIds: [] }]
  for (const context of [Object.create({ inputs }), Object.defineProperty({}, 'inputs', { value: inputs })]) {
    const report = Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, context)
    assert.deepEqual(report.run.inputs, inputs)
  }
})

test('explanation JSON accepts shared records and omitted optional properties', () => {
  const shared = { amount: 12, optional: undefined }
  const report = Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, {
    inputs: [{ id: 'source', value: { left: shared, right: shared, values: [null, false, ''] }, evidenceRowIds: [], scenarioClaimIds: [] }]
  })
  assert.deepEqual(JSON.parse(JSON.stringify(report.run.inputs[0]?.value)), { left: { amount: 12 }, right: { amount: 12 }, values: [null, false, ''] })
})

test('invalid snapshot and scenario metadata fail before explanation solving', async () => {
  let calls = 0
  const backend: Adapter.t = { ...adapter({ ...common, status: 'satisfied', assignment: {} }), solve: async () => { calls++; return { ...common, status: 'satisfied', assignment: {} } } }
  const contexts = [
    { snapshot: null }, { snapshot: [] }, { snapshot: {} },
    { snapshot: { transactionTime: 42 } }, { snapshot: { transactionTime: '' } },
    ...[NaN, Infinity, -0.1, 1.1, '0.5'].map(minimumConfidence => ({ snapshot: { transactionTime: null, minimumConfidence } })),
    { snapshot: { transactionTime: null, aliases: 'fuzzy' } },
    { snapshot: { transactionTime: null, resolution: 'all' } },
    { snapshot: { transactionTime: null, validTime: false } },
    { scenario: null }, { scenario: [] }, { scenario: {} },
    { scenario: { id: 'scenario', inputDigest: '', overlayDigest: 'opaque' } },
    { scenario: { id: 'scenario', inputDigest: 'opaque', overlayDigest: 42 } }
  ]
  for (const value of contexts) {
    const context = value as unknown as Explain.Context
    assert.throws(() => Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, context), TypeError)
    await assert.rejects(Solve.runWithExplanation(backend, model(), {}, context), TypeError)
    await assert.rejects(Workflow.feasibility(backend, model(), {}, context), TypeError)
  }
  assert.equal(calls, 0)
})

test('snapshot metadata accepts confidence endpoints and opaque source labels', () => {
  for (const minimumConfidence of [0, 1]) {
    const context: Explain.Context = {
      snapshot: { transactionTime: null, validTime: '2026', aliases: 'exact', resolution: 'coexisting', minimumConfidence },
      scenario: { id: 'external scenario', inputDigest: 'external:input', overlayDigest: 'external:overlay' }
    }
    const report = Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, context)
    assert.deepEqual(report.run.snapshot, context.snapshot)
    assert.deepEqual(report.run.scenario, context.scenario)
  }
})

test('text explanations distinguish snapshot policies and scenario overlays', () => {
  const render = (minimumConfidence: number, overlayDigest: string): string => Explain.render(Explain.report(model(), {
    ...common, status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' }
  }, Adapter.defaultLimits, {
    snapshot: { transactionTime: null, validTime: '2026', aliases: 'closure', resolution: 'winner', minimumConfidence },
    scenario: { id: 'scenario', inputDigest: 'input:one', overlayDigest }
  }))
  const first = render(0, 'overlay:one')
  assert.match(first, /Snapshot: transaction empty, valid 2026; aliases closure; resolution winner; minimum confidence 0/)
  assert.match(first, /Scenario: scenario \(input input:one; overlay overlay:one\)/)
  assert.notEqual(first, render(1, 'overlay:one'))
  assert.notEqual(first, render(0, 'overlay:two'))
  const minimal = Explain.render(Explain.report(model(), { ...common, status: 'satisfied', assignment: {} }, Adapter.defaultLimits, { snapshot: { transactionTime: null } }))
  assert.match(minimal, /Snapshot: transaction empty\n/)
  assert.doesNotMatch(minimal, /aliases|resolution|minimum confidence/)
})


test('direct explanations evaluate the same captured model used for their digest', () => {
  let reads = 0
  const expected = model()
  const input: Model.t = { ...expected, constraints: [{ ...expected.constraints[0]!,
    expression: { kind: 'gte', left: ref('replicas'), right: {
      kind: 'literal', sort: 'int', get value() { return ++reads <= 2 ? '3' : '9' },
    } },
  }] }
  const report = Explain.report(input, { ...common, status: 'satisfied',
    assignment: { replicas: { sort: 'int', value: '3' } } }, Adapter.defaultLimits)
  assert.equal(report.run.modelDigest, Canonical.digest(expected))
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible explanation')
  assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied')
  assert.equal(reads, 1)
})

for (const field of ['maxVariables', 'timeoutMs'] as const) for (const later of [0, 1000]) {
  test(`direct explanation captures ${field} before validation and reporting (${later})`, () => {
    let reads = 0
    const initial = field === 'maxVariables' ? 1 : 321
    const limits: Adapter.Limits = { ...Adapter.defaultLimits,
      get [field]() { return ++reads === 1 ? initial : later }
    }
    const input = model()
    const report = Explain.report(input, { ...common, status: 'satisfied',
      assignment: { replicas: { sort: 'int', value: '3' } } }, limits)
    assert.equal(reads, 1)
    assert.equal(report.run.limits[field], initial)
    assert.equal(report.run.modelDigest, Canonical.digest(input, { ...Adapter.defaultLimits, [field]: initial }))
    assert.equal(report.outcome.status, 'satisfied')
    assert.doesNotThrow(() => JSON.stringify(report))
  })
}

test('malformed backend booleans stay indeterminate instead of using JavaScript truthiness', () => {
  const constraints: Model.HardConstraint[] = [
    { id: 'enabled', expression: ref('enabled') },
    { id: 'disabled', expression: { kind: 'not', value: ref('enabled') } }
  ]
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'enabled', sort: 'bool' }], constraints,
    softConstraints: constraints.map(value => ({ ...value, id: `soft-${value.id}`, weight: '1' })) }
  for (const value of [true, false, 'true', 'false', 0, 1, null, {}, []]) {
    const result = { ...common, status: 'satisfied', assignment: { enabled: { sort: 'bool', value } } } as unknown as Adapter.Result
    const report = Explain.report(input, result, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected adapter status to be retained')
    const expected = typeof value === 'boolean' ? value ? ['satisfied', 'violated'] : ['violated', 'satisfied'] : ['indeterminate', 'indeterminate']
    assert.deepEqual(report.outcome.hardConstraints.map(item => item.evaluation), expected)
    assert.deepEqual(report.outcome.softConstraints.map(item => item.evaluation),
      expected.map(item => item === 'satisfied' ? 'accepted' : item))
  }
})

test('enum explanations reject malformed and out-of-domain backend assignments', () => {
  const constraints: Model.HardConstraint[] = [
    { id: 'ready', expression: { kind: 'eq', left: ref('state'), right: { kind: 'literal', sort: 'enum', domain: 'State', value: 'ready' } } },
    { id: 'not-ready', expression: { kind: 'neq', left: ref('state'), right: { kind: 'literal', sort: 'enum', domain: 'State', value: 'ready' } } }
  ]
  const input: Model.t = { schema: Model.schema, enums: [{ id: 'State', values: ['ready', 'blocked'] }],
    variables: [{ id: 'state', sort: 'enum', domain: 'State' }], constraints,
    softConstraints: constraints.map(value => ({ ...value, id: `soft-${value.id}`, weight: '1' })) }
  const cases = [
    { sort: 'enum', domain: 'State', value: 'ready' },
    { sort: 'enum', domain: 'State', value: 'blocked' },
    { sort: 'enum', domain: 'State', value: 'unknown' },
    { sort: 'enum', domain: 'Other', value: 'ready' },
    { sort: 'enum', domain: null, value: 'ready' },
    ...[undefined, null, 0, false, {}, []].map(value => ({ sort: 'enum', domain: 'State', value })),
    { sort: 'bool', value: true }
  ]
  for (const [index, value] of cases.entries()) {
    const result = { ...common, status: 'satisfied', assignment: { state: value } } as unknown as Adapter.Result
    const report = Explain.report(input, result, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected adapter status to be retained')
    const expected = index === 0 ? ['satisfied', 'violated'] : index === 1 ? ['violated', 'satisfied'] : ['indeterminate', 'indeterminate']
    assert.deepEqual(report.outcome.hardConstraints.map(item => item.evaluation), expected)
    assert.deepEqual(report.outcome.softConstraints.map(item => item.evaluation), expected.map(item => item === 'satisfied' ? 'accepted' : item))
  }
})

test('explanation equality validates assignment kinds and integer integrality', () => {
  const declarations: Model.Variable[] = [
    { id: 'x', sort: 'bool' }, { id: 'x', sort: 'int', min: 0, max: 2 },
    { id: 'x', sort: 'real' }, { id: 'x', sort: 'enum', domain: 'State' }
  ]
  const candidates: Model.Value[] = [
    { sort: 'bool', value: true }, { sort: 'int', value: '1' },
    { sort: 'real', numerator: '1', denominator: '2' },
    { sort: 'real', numerator: '2', denominator: '2' },
    { sort: 'enum', domain: 'State', value: 'ready' }
  ]
  for (const declaration of declarations) {
    const literal: Model.Expression = declaration.sort === 'bool' ? { kind: 'literal', sort: 'bool', value: true }
      : declaration.sort === 'enum' ? { kind: 'literal', sort: 'enum', domain: 'State', value: 'ready' } : int(1)
    const constraints: Model.HardConstraint[] = [
      { id: 'equal', expression: { kind: 'eq', left: ref('x'), right: literal } },
      { id: 'unequal', expression: { kind: 'neq', left: ref('x'), right: literal } }
    ]
    const input: Model.t = { schema: Model.schema, enums: [{ id: 'State', values: ['ready'] }], variables: [declaration], constraints,
      softConstraints: constraints.map(value => ({ ...value, id: `soft-${value.id}`, weight: '1' })) }
    for (const value of candidates) {
      const compatible = declaration.sort === 'bool' ? value.sort === 'bool' : declaration.sort === 'enum' ? value.sort === 'enum'
        : value.sort === 'int' || (value.sort === 'real' && (declaration.sort === 'real' || value.numerator === value.denominator))
      const expected = !compatible ? ['indeterminate', 'indeterminate']
        : value.sort === 'real' && value.numerator !== value.denominator ? ['violated', 'satisfied'] : ['satisfied', 'violated']
      const report = Explain.report(input, { ...common, status: 'satisfied', assignment: { x: value } }, Adapter.defaultLimits)
      if (report.outcome.status !== 'satisfied') assert.fail('expected original backend status')
      assert.deepEqual(report.outcome.hardConstraints.map(item => item.evaluation), expected, `${declaration.sort}/${value.sort}`)
      assert.deepEqual(report.outcome.softConstraints.map(item => item.evaluation), expected.map(item => item === 'satisfied' ? 'accepted' : item))
    }
  }
})

test('numeric explanation assignments respect inclusive and optional variable bounds', () => {
  const value = (numerator: string, denominator = '1'): Model.Value => ({ sort: 'real', numerator, denominator })
  const cases: { variable: Model.Variable, values: readonly Model.Value[], valid: readonly boolean[] }[] = [
    { variable: { id: 'x', sort: 'int', min: 0, max: 2 }, values: ['-1', '0', '1', '2', '3'].map(n => value(n)), valid: [false, true, true, true, false] },
    { variable: { id: 'x', sort: 'real', min: { numerator: '1', denominator: '-3' }, max: { numerator: '1', denominator: '3' } },
      values: [value('-1', '2'), value('-2', '6'), value('0'), value('2', '6'), value('1', '2')], valid: [false, true, true, true, false] },
    { variable: { id: 'x', sort: 'real', min: '0' }, values: [value('-1'), value('0'), value('1')], valid: [false, true, true] },
    { variable: { id: 'x', sort: 'real', max: '0' }, values: [value('-1'), value('0'), value('1')], valid: [true, true, false] },
    { variable: { id: 'x', sort: 'real' }, values: [value('-1'), value('0'), value('1')], valid: [true, true, true] }
  ]
  for (const fixture of cases) {
    const constraints: Model.HardConstraint[] = [
      { id: 'equal', expression: { kind: 'eq', left: ref('x'), right: ref('x') } },
      { id: 'unequal', expression: { kind: 'neq', left: ref('x'), right: ref('x') } }
    ]
    const input: Model.t = { schema: Model.schema, variables: [fixture.variable], constraints,
      softConstraints: constraints.map(item => ({ ...item, id: `soft-${item.id}`, weight: '1' })) }
    fixture.values.forEach((assignment, index) => {
      const report = Explain.report(input, { ...common, status: 'satisfied', assignment: { x: assignment } }, Adapter.defaultLimits)
      if (report.outcome.status !== 'satisfied') assert.fail('expected original backend status')
      const expected = fixture.valid[index] ? ['satisfied', 'violated'] : ['indeterminate', 'indeterminate']
      assert.deepEqual(report.outcome.hardConstraints.map(item => item.evaluation), expected)
      assert.deepEqual(report.outcome.softConstraints.map(item => item.evaluation), expected.map(item => item === 'satisfied' ? 'accepted' : item))
    })
  }
})

test('cached assignment failures preserve short-circuit branches and fresh-report recovery', () => {
  const yes: Model.Expression = { kind: 'literal', sort: 'bool', value: true }
  const no: Model.Expression = { kind: 'literal', sort: 'bool', value: false }
  const fixtures: { variable: Model.Variable, bad: Model.Value, good: Model.Value, predicate: Model.Expression }[] = [
    { variable: { id: 'x', sort: 'bool' }, bad: { sort: 'bool', value: 'false' } as unknown as Model.Value,
      good: { sort: 'bool', value: true }, predicate: ref('x') },
    { variable: { id: 'x', sort: 'int', min: 0, max: 1 }, bad: { sort: 'int', value: '2' },
      good: { sort: 'int', value: '0' }, predicate: { kind: 'eq', left: ref('x'), right: int(0) } },
    { variable: { id: 'x', sort: 'enum', domain: 'State' }, bad: { sort: 'enum', domain: 'State', value: 'missing' },
      good: { sort: 'enum', domain: 'State', value: 'ready' },
      predicate: { kind: 'eq', left: ref('x'), right: { kind: 'literal', sort: 'enum', domain: 'State', value: 'ready' } } }
  ]
  for (const fixture of fixtures) {
    const predicate = fixture.predicate
    const expressions: Model.Expression[] = [predicate,
      { kind: 'and', operands: [no, predicate] }, { kind: 'or', operands: [yes, predicate] },
      { kind: 'implies', left: no, right: predicate }, { kind: 'if', condition: yes, then: yes, else: predicate },
      { kind: 'and', operands: [yes, predicate] }, { kind: 'or', operands: [no, predicate] },
      { kind: 'implies', left: yes, right: predicate }, { kind: 'if', condition: no, then: yes, else: predicate }]
    const constraints = expressions.map((expression, index) => ({ id: `branch-${index}`, expression }))
    const input: Model.t = { schema: Model.schema, enums: [{ id: 'State', values: ['ready'] }], variables: [fixture.variable], constraints,
      softConstraints: constraints.map(item => ({ ...item, id: `soft-${item.id}`, weight: '1' })) }
    for (const [value, expected] of [
      [fixture.bad, ['indeterminate', 'violated', 'satisfied', 'satisfied', 'satisfied', 'indeterminate', 'indeterminate', 'indeterminate', 'indeterminate']],
      [fixture.good, ['satisfied', 'violated', 'satisfied', 'satisfied', 'satisfied', 'satisfied', 'satisfied', 'satisfied', 'satisfied']]
    ] as const) {
      const report = Explain.report(input, { ...common, status: 'satisfied', assignment: { x: value } }, Adapter.defaultLimits)
      if (report.outcome.status !== 'satisfied') assert.fail('expected original backend status')
      assert.deepEqual(report.outcome.hardConstraints.map(item => item.evaluation), expected)
      assert.deepEqual(report.outcome.softConstraints.map(item => item.evaluation), expected.map(item => item === 'satisfied' ? 'accepted' : item))
    }
  }
})


test('indeterminate constraints expose reasons without attaching them to skipped or recovered evaluations', () => {
  const predicate: Model.Expression = { kind: 'eq', left: ref('x'), right: int(1) }
  const divide: Model.Expression = { kind: 'eq', left: { kind: 'divide', left: int(1), right: ref('zero') }, right: int(1) }
  const constraints = [
    { id: 'value', expression: predicate },
    { id: 'skipped', expression: { kind: 'or', operands: [{ kind: 'literal', sort: 'bool', value: true }, predicate] } as Model.Expression },
    { id: 'division', expression: divide }
  ]
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: 0, max: 1 }, { id: 'zero', sort: 'int', min: 0, max: 0 }], constraints,
    softConstraints: constraints.map(item => ({ ...item, id: `soft-${item.id}`, weight: '1' })) }
  const fixtures: [Model.Assignment, string | undefined][] = [
    [{}, 'assignment omits "x"'],
    [{ x: { sort: 'int', value: '2' } }, 'numeric assignment must lie within the declared bounds'],
    [{ x: { sort: 'bool', value: true } }, 'assignment kind must match the declared variable'],
    [{ x: { sort: 'int', value: '1' } }, undefined]
  ]
  for (const [assignment, reason] of fixtures) {
    const report = Explain.report(input, { ...common, status: 'satisfied', assignment: { ...assignment, zero: { sort: 'int', value: '0' } } }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected original backend status')
    for (const results of [report.outcome.hardConstraints, report.outcome.softConstraints]) {
      assert.equal(results[0]!.evaluationReason, reason)
      if (reason === undefined) assert.equal(Object.hasOwn(results[0]!, 'evaluationReason'), false)
      assert.equal(Object.hasOwn(results[1]!, 'evaluationReason'), false)
      assert.equal(results[2]!.evaluationReason, 'cannot explain division by zero')
    }
    const rendered = Explain.render(report)
    if (reason !== undefined) assert.ok(rendered.includes(`indeterminate (${JSON.stringify(reason)})`))
    assert.ok(rendered.includes('indeterminate ("cannot explain division by zero")'))
  }
})

test('rendering malformed backend value shapes preserves usable assignments and objectives', () => {
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'bool' }],
    constraints: [{ id: 'enabled', expression: ref('x') }],
    objectives: [{ id: 'cost', direction: 'minimize', expression: int(1) }] }
  for (const value of [null, undefined, true, 1, 'false', [], {}, { sort: 'other' },
    { sort: 'bool', value: 'false' }, { sort: 'int', value: 1 },
    { sort: 'real', numerator: '1', denominator: null }, { sort: 'enum', domain: null, value: 'ready' }]) {
    const report = Explain.report(input, { ...common, status: 'optimal', optimalityProved: true,
      assignment: { x: value }, objectives: [{ objectiveId: 'cost', value }] } as unknown as Adapter.Result, Adapter.defaultLimits)
    if (report.outcome.status !== 'optimal') assert.fail('expected original backend status')
    assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'indeterminate')
    const rendered = Explain.render(report)
    assert.ok(rendered.includes('Assignment x = (invalid backend value)'))
    assert.ok(rendered.includes('Objective cost (minimize) = (invalid backend value)'))
    assert.deepEqual(report.outcome.assignments[0]!.value, value)
    assert.deepEqual(report.outcome.objectives[0]!.value, value)
  }
})

test('unknown reason text cannot introduce report lines or terminal controls', () => {
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [] }
  for (const message of ['deadline\nSolver result: optimal', 'retry\rreplaced', '\u001b[2J', 'a\u0085b', 'a\u2028b\u2029c',
    String.fromCharCode(...Array.from({ length: 33 }, (_, index) => index + 0x7f), 0x2028, 0x2029)]) {
    const report = Explain.report(input, { ...common, status: 'unknown',
      reason: { kind: 'backend-error', message } }, Adapter.defaultLimits)
    const text = Explain.render(report)
    const last = text.trimEnd().split('\n').at(-1)!
    assert.ok(last.startsWith('Unknown: backend-error — "'))
    assert.doesNotMatch(last, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
    assert.equal(JSON.parse(last.slice('Unknown: backend-error — '.length)), message)
    if (report.outcome.status !== 'unknown') assert.fail('expected unknown')
    assert.equal(report.outcome.reason.message, message)
  }
})

test('assignment and objective text escapes controls while preserving backend values', () => {
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'bool' }], constraints: [],
    objectives: [{ id: 'cost', direction: 'minimize', expression: int(1) }] }
  const cases: [Model.Value, string][] = [
    [{ sort: 'int', value: '1\nSolver result: optimal' }, '1\nSolver result: optimal'],
    [{ sort: 'real', numerator: '\u001b[2J', denominator: '1' }, '\u001b[2J/1'],
    [{ sort: 'real', numerator: '1', denominator: '2\r3' }, '1/2\r3'],
    [{ sort: 'enum', domain: 'choice', value: 'a\u0085b\u2028c\u2029d' }, 'a\u0085b\u2028c\u2029d']
  ]
  for (const [value, displayed] of cases) {
    const report = Explain.report(input, { ...common, status: 'optimal', optimalityProved: true,
      assignment: { x: value }, objectives: [{ objectiveId: 'cost', value }] }, Adapter.defaultLimits)
    const lines = Explain.render(report).split('\n')
    for (const prefix of ['Assignment x = ', 'Objective cost (minimize) = ']) {
      const line = lines.find(line => line.startsWith(prefix))!
      assert.ok(line)
      assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
      assert.equal(JSON.parse(line.slice(prefix.length)), displayed)
    }
    if (report.outcome.status !== 'optimal') assert.fail('expected optimal')
    assert.deepEqual(report.outcome.assignments[0]!.value, value)
    assert.deepEqual(report.outcome.objectives[0]!.value, value)
  }
})

test('constraint reasons escape C1 controls and Unicode line separators', () => {
  const expression: Model.Expression = { kind: 'eq', left: ref('x'), right: int(1) }
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: 0, max: 1 }],
    constraints: [{ id: 'hard', expression }], softConstraints: [{ id: 'soft', expression, weight: '1' }] }
  for (const control of ['\u0085', '\u2028', '\u2029']) {
    const report = Explain.report(input, { ...common, status: 'satisfied',
      assignment: { x: { sort: 'int', value: `1${control}` } } }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied')
    const reason = report.outcome.hardConstraints[0]!.evaluationReason!
    assert.ok(reason.includes(control))
    const lines = Explain.render(report).split('\n')
    for (const prefix of ['Hard constraint hard: indeterminate (', 'Soft constraint soft: indeterminate (']) {
      const line = lines.find(line => line.startsWith(prefix))!
      assert.ok(line)
      assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
      const end = line.lastIndexOf(')')
      assert.equal(JSON.parse(line.slice(prefix.length, end)), reason)
    }
    assert.equal(report.outcome.softConstraints[0]!.evaluationReason, reason)
  }
})

test('report metadata and provenance retain their labeled text lines', () => {
  const mark = (label: string): string => `${label}\nextra\u001b[2J\u0085\u2028\u2029`
  const provenance: Model.Provenance = { declaration: { uri: mark('source'), line: 2, column: 3 },
    evidenceRowIds: [mark('row')], scenarioInputIds: [mark('input')] }
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'bool', ...provenance }],
    constraints: [{ id: 'hard', expression: ref('x'), ...provenance }],
    softConstraints: [{ id: 'soft', expression: ref('x'), weight: '1', ...provenance }],
    objectives: [{ id: 'cost', direction: 'minimize', expression: int(1), ...provenance }] }
  const context: Explain.Context = {
    scenario: { id: mark('scenario'), inputDigest: mark('digest'), overlayDigest: mark('overlay') },
    snapshot: { transactionTime: mark('transaction'), validTime: mark('valid') },
    inputs: [{ id: mark('input'), query: mark('query'), value: { 'key\u0085': 'value\u2028' },
      authoredValue: ['authored\u2029'], evidenceRowIds: [mark('row')], scenarioClaimIds: [mark('claim')] }]
  }
  const results: Adapter.Result[] = [
    { ...common, status: 'optimal', optimalityProved: true, assignment: { x: { sort: 'bool', value: true },
      [mark('undeclared')]: { sort: 'bool', value: false } }, objectives: [
      { objectiveId: 'cost', value: { sort: 'int', value: '1' } },
      { objectiveId: mark('unknown-objective'), value: { sort: 'int', value: '2' } }] },
    { ...common, status: 'unsatisfied', infeasibilityProved: true, core: ['hard', mark('unknown-core')] }
  ]
  for (const result of results) {
    const report = Explain.report(input, { ...result, backend: { name: mark('backend'), version: mark('version') } }, Adapter.defaultLimits, context)
    const before = JSON.stringify(report)
    const rendered = Explain.render(report)
    assert.doesNotMatch(rendered, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/)
    for (const line of rendered.trimEnd().split('\n')) {
      assert.match(line, /^(Solver result:|Model:|Backend:|Elapsed:|Snapshot:|Scenario:|Input |Assignment |Hard constraint |Soft constraint |Objective |Core constraint |Infeasibility proved\.)/)
    }
    assert.ok(rendered.includes('{"key\\u0085":"value\\u2028"}'))
    assert.ok(rendered.includes('["authored\\u2029"]'))
    assert.equal(JSON.stringify(report), before)
  }
})

test('owned explanation canonicalization validates models even for unknown outcomes', () => {
  const input: Model.t = { schema: Model.schema,
    variables: [{ id: 'amount', sort: 'real', min: '1e10' }], constraints: [] }
  const result: Adapter.Result = { ...common, status: 'unknown',
    reason: { kind: 'indeterminate', message: 'fixture' } }
  assert.throws(() => Explain.report(input, result, {
    ...Adapter.defaultLimits, maxNumericDigits: 2
  }), /maxNumericDigits/)
  assert.throws(() => Explain.report({ ...input, constraints: [
    { id: 'invalid', expression: ref('missing') }
  ] }, result, Adapter.defaultLimits), /missing/)
  const report = Explain.report(input, result, Adapter.defaultLimits)
  assert.equal(report.run.modelDigest, Canonical.digest(input))
  assert.equal(report.outcome.status, 'unknown')
  assert.equal(input.variables[0]!.sort, 'real')
})

test('text explanations preserve columns when a declaration has no line', () => {
  const cases: readonly [Model.Declaration, string][] = [
    [{ uri: 'partial.cave' }, 'partial.cave'],
    [{ uri: 'partial.cave', line: 7 }, 'partial.cave:7'],
    [{ uri: 'partial.cave', line: 7, column: 3 }, 'partial.cave:7:3'],
    [{ uri: 'partial.cave', column: 3 }, 'partial.cave (column 3)'],
  ]
  const original = model()
  const digest = Canonical.digest(original)
  for (const [declaration, expected] of cases) {
    const input: Model.t = { ...original, constraints: [{ ...original.constraints[0]!, declaration }] }
    for (const result of [
      { ...common, status: 'satisfied' as const, assignment: { replicas: { sort: 'int' as const, value: '3' } } },
      { ...common, status: 'unsatisfied' as const, infeasibilityProved: true as const, core: ['capacity'] }
    ]) {
      const report = Explain.report(input, result, Adapter.defaultLimits)
      const before = structuredClone(report)
      assert.ok(Explain.render(report).includes(` — ${expected}; rows row:forecast`))
      assert.equal(report.run.modelDigest, digest)
      assert.deepEqual(report, before)
      const entry = report.outcome.status === 'satisfied' ? report.outcome.hardConstraints[0]
        : report.outcome.status === 'unsatisfied' ? report.outcome.core?.[0] : undefined
      assert.deepEqual(entry?.declaration, declaration)
    }
  }
})


test('identical explanation predicates reuse work within one report and retain declaration metadata', t => {
  const expression = (): Model.Expression => ({ kind: 'gt', left: { kind: 'multiply',
    operands: Array.from({ length: 32 }, () => ref('x')) }, right: int(1) })
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
    constraints: [{ id: 'first', expression: expression(), evidenceRowIds: ['first-row'] }] }
  const result: Adapter.Result = { ...common, status: 'satisfied',
    assignment: { x: { sort: 'real', numerator: '3', denominator: '2' } } }
  const original = ExplanationBudget.prototype.check
  let calls = 0
  t.mock.method(ExplanationBudget.prototype, 'check', function (this: ExplanationBudget, ...bounds: number[]) {
    calls++
    return original.apply(this, bounds)
  })
  Explain.report(input, result, Adapter.defaultLimits)
  const once = calls
  assert.ok(once > 0)
  const repeated: Model.t = { ...input,
    constraints: [...input.constraints, { id: 'second', expression: expression(), evidenceRowIds: ['second-row'] }],
    softConstraints: [{ id: 'soft', expression: expression(), weight: '2', description: 'Preference' }] }
  calls = 0
  const report = Explain.report(repeated, result, Adapter.defaultLimits)
  assert.equal(calls, once, 'identical hard and soft predicates perform arithmetic once')
  if (report.outcome.status !== 'satisfied') assert.fail('expected satisfied')
  assert.deepEqual(report.outcome.hardConstraints.map(value => [value.id, value.evidenceRowIds, value.evaluation]),
    [['first', ['first-row'], 'satisfied'], ['second', ['second-row'], 'satisfied']])
  assert.equal(report.outcome.softConstraints[0]!.description, 'Preference')
  assert.equal(report.outcome.softConstraints[0]!.evaluation, 'accepted')
  const sharedRoot = repeated.constraints[0]!.expression
  const shared: Model.t = { ...repeated,
    constraints: repeated.constraints.map(value => ({ ...value, expression: sharedRoot })),
    softConstraints: repeated.softConstraints!.map(value => ({ ...value, expression: sharedRoot })) }
  calls = 0
  assert.deepEqual(Explain.report(shared, result, Adapter.defaultLimits), report)
  assert.equal(calls, once, 'shared roots retain the same arithmetic reuse and report metadata')
  for (const [numerator, bits, expected] of [['1', 1000000, 'violated'], ['3', 16, 'indeterminate'], ['3', 1000000, 'satisfied']] as const) {
    const next = Explain.report(repeated, { ...result, assignment: { x: { sort: 'real', numerator, denominator: '2' } } },
      { ...Adapter.defaultLimits, maxExplanationBits: bits })
    if (next.outcome.status !== 'satisfied') assert.fail('backend outcome unchanged')
    assert.deepEqual(next.outcome.hardConstraints.map(value => value.evaluation), [expected, expected])
    if (expected === 'indeterminate') assert.match(next.outcome.hardConstraints[0]!.evaluationReason!, /maxExplanationBits/)
  }
})

test('explanation reuse preserves operand order and short-circuit failure reasons', () => {
  const missing = ref('missing')
  const division: Model.Expression = { kind: 'eq', left: { kind: 'divide', left: int(1), right: ref('zero') }, right: int(1) }
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'missing', sort: 'bool' }, { id: 'zero', sort: 'int', min: 0, max: 0 }], constraints: [
    { id: 'missing-first', expression: { kind: 'and', operands: [missing, division] } },
    { id: 'division-first', expression: { kind: 'and', operands: [division, missing] } },
    { id: 'skipped', expression: { kind: 'and', operands: [{ kind: 'literal', sort: 'bool', value: false }, missing] } },
    { id: 'missing-again', expression: { kind: 'and', operands: [ref('missing'), structuredClone(division)] } }
  ] }
  const report = Explain.report(input, { ...common, status: 'satisfied', assignment: { zero: { sort: 'int', value: '0' } } }, Adapter.defaultLimits)
  if (report.outcome.status !== 'satisfied') assert.fail('backend outcome unchanged')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluationReason),
    ['assignment omits "missing"', 'cannot explain division by zero', undefined, 'assignment omits "missing"'])
  assert.equal(report.outcome.hardConstraints[2]!.evaluation, 'violated')
})

test('combined explanation evaluations match isolated predicates across syntax and assignments', () => {
  const bool = (value: boolean): Model.Expression => ({ kind: 'literal', sort: 'bool', value })
  const real = (value: Model.Rational): Model.Expression => ({ kind: 'literal', sort: 'real', value })
  const numbers: Model.Expression[] = [int(-1), int('1'), real('1.0'), real({ numerator: 1, denominator: '2' }),
    ref('x'), ref('zero'), { kind: 'negate', value: ref('x') },
    { kind: 'add', operands: [ref('x'), int(1)] },
    { kind: 'add', operands: [ref('x'), int(1), int(1)] },
    { kind: 'multiply', operands: [ref('x'), int(2)] },
    { kind: 'subtract', left: ref('x'), right: int(1) },
    { kind: 'divide', left: ref('x'), right: ref('zero') },
    { kind: 'if', condition: ref('flag'), then: ref('x'), else: real('0.5') }]
  const predicates: Model.Expression[] = []
  for (const kind of ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const) {
    for (const left of numbers) for (const right of [int(0), ref('x'), real('0.5')]) predicates.push({ kind, left, right })
  }
  for (const left of [bool(false), bool(true), ref('flag'), { kind: 'not', value: ref('flag') } as Model.Expression]) {
    for (const right of [bool(false), bool(true), ref('missing')]) {
      predicates.push({ kind: 'implies', left, right },
        { kind: 'and', operands: [left, right] }, { kind: 'or', operands: [left, right] },
        { kind: 'and', operands: [left, bool(true), right] },
        { kind: 'if', condition: left, then: right, else: bool(false) })
    }
  }
  const unusual = 'literal\n["variable","x"]'
  for (const domain of ['First', 'Second']) for (const value of ['ready', unusual]) {
    predicates.push({ kind: 'eq', left: ref(domain), right: { kind: 'literal', sort: 'enum', domain, value } })
  }
  const input: Model.t = { schema: Model.schema,
    enums: ['First', 'Second'].map(id => ({ id, values: ['ready', unusual] })),
    variables: [{ id: 'x', sort: 'real' }, { id: 'zero', sort: 'real' },
      { id: 'flag', sort: 'bool' }, { id: 'missing', sort: 'bool' },
      { id: 'First', sort: 'enum', domain: 'First' }, { id: 'Second', sort: 'enum', domain: 'Second' }],
    constraints: predicates.map((expression, index) => ({ id: `case-${index}`, expression })) }
  const assignments: Model.Assignment[] = [{}, ...[false, true].map(flag => ({
    x: { sort: 'real' as const, numerator: flag ? '12345' : '-3', denominator: '2' },
    zero: { sort: 'real' as const, numerator: '0', denominator: '1' },
    flag: { sort: 'bool' as const, value: flag },
    First: { sort: 'enum' as const, domain: 'First', value: 'ready' },
    Second: { sort: 'enum' as const, domain: 'Second', value: unusual }
  }))]
  for (const assignment of assignments) for (const maxExplanationBits of [16, Adapter.defaultLimits.maxExplanationBits]) {
    const limits = { ...Adapter.defaultLimits, maxExplanationBits }
    const result: Adapter.Result = { ...common, status: 'satisfied', assignment }
    const isolated = input.constraints.map(constraint => {
      const report = Explain.report({ ...input, constraints: [constraint] }, result, limits)
      if (report.outcome.status !== 'satisfied') assert.fail('expected original outcome')
      return report.outcome.hardConstraints[0]!
    })
    const duplicates = input.constraints.slice().reverse().map(value => ({ ...value,
      id: `repeat-${value.id}`, expression: structuredClone(value.expression) }))
    const report = Explain.report({ ...input, constraints: [...input.constraints, ...duplicates] }, result, limits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected original outcome')
    assert.deepEqual(report.outcome.hardConstraints, [...isolated,
      ...isolated.slice().reverse().map(value => ({ ...value, id: `repeat-${value.id}` }))])
  }
})

test('explanation node limits count shared graph occurrences and permit exact-boundary retry', () => {
  const leaf: { kind: 'literal', sort: 'bool', value: boolean } = { kind: 'literal', sort: 'bool', value: true }
  let expression: Model.Expression = leaf
  for (let depth = 0; depth < 8; depth++) expression = { kind: 'and', operands: [expression, expression] }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [
    { id: 'first', expression }, { id: 'second', expression }
  ] }
  const result: Adapter.Result = { ...common, status: 'satisfied', assignment: {} }
  const nodes = 2 * (2 ** 9 - 1)
  const limits = { ...Adapter.defaultLimits, maxExpressionNodes: nodes }
  assert.throws(() => Explain.report(input, result, { ...limits, maxExpressionNodes: nodes - 1 }), /maxExpressionNodes/)
  const report = Explain.report(input, result, limits)
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status !== 'satisfied') assert.fail('expected feasible outcome')
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), ['satisfied', 'satisfied'])
  assert.equal(input.constraints[0]!.expression, input.constraints[1]!.expression, 'capture preserves caller graph identity')
  assert.equal(leaf.value, true)
  leaf.value = false
  const changed = Explain.report(input, result, limits)
  if (changed.outcome.status !== 'satisfied') assert.fail('backend status stays unchanged')
  assert.deepEqual(changed.outcome.hardConstraints.map(value => value.evaluation), ['violated', 'violated'])
  assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), ['satisfied', 'satisfied'])
})

test('shared input graphs expand as JSON and recover after a cycle is repaired', () => {
  const leaf: { value: string, cycle?: unknown } = { value: 'leaf' }
  let shared: unknown = leaf
  let expected = '{"value":"leaf"}'
  const depth = 12
  for (let level = 0; level < depth; level++) {
    shared = { left: shared, right: shared }
    expected = `{"left":${expected},"right":${expected}}`
  }
  const report = Explain.report(model(), { ...common, status: 'unknown',
    reason: { kind: 'indeterminate', message: 'fixture' } }, Adapter.defaultLimits, {
    inputs: [{ id: 'shared', value: shared as Explain.Json, evidenceRowIds: [], scenarioClaimIds: [] }]
  })
  const root = report.run.inputs[0]!.value as { left: unknown, right: unknown }
  let captured: unknown = root
  for (let level = 0; level < depth; level++) {
    const branch = captured as { left: unknown, right: unknown }
    assert.equal(branch.left, branch.right, 'capture retains sharing at each level')
    captured = branch.left
  }
  const capturedLeaf = captured as typeof leaf
  assert.notEqual(capturedLeaf, leaf)
  const text = Explain.render(report)
  assert.ok(text.includes(`Input shared: ${expected}\n`))
  assert.equal((text.match(/"value":"leaf"/g) ?? []).length, 2 ** depth)
  capturedLeaf.cycle = root
  assert.throws(() => Explain.render(report), /contains a JSON cycle/)
  assert.equal(capturedLeaf.cycle, root, 'failed rendering does not repair caller data')
  assert.equal(Object.hasOwn(leaf, 'cycle'), false)
  delete capturedLeaf.cycle
  assert.equal(Explain.render(report), text, 'fresh rendering recovers without a stale traversal cache')
})

test('returned report mutations cannot alter caller graphs or later reports', () => {
  const declaration = { uri: 'fixture.cave', line: 1 }
  const model: Model.Model = { schema: Model.schema, variables: [{ id: 'ready', sort: 'bool', declaration }],
    constraints: [{ id: 'required', expression: ref('ready'), declaration }] }
  const diagnostic = { level: 'info' as const, code: 'fixture', message: 'original' }
  const result: Adapter.Result = { status: 'satisfied', assignment: { ready: { sort: 'bool', value: true } },
    backend: { name: 'fixture', version: '1' }, elapsedMs: 0, diagnostics: [diagnostic, diagnostic] }
  const context = { inputs: [{ id: 'source', value: { label: 'original' }, evidenceRowIds: ['row:original'], scenarioClaimIds: [] }] }
  const first = Explain.report(model, result, Adapter.defaultLimits, context)
  const expected = structuredClone(first)
  assert.equal(first.run.diagnostics[0], first.run.diagnostics[1])
  assert.ok(first.outcome.status === 'satisfied')
  assert.equal(first.outcome.assignments[0]!.declaration, first.outcome.hardConstraints[0]!.declaration)
  Object.assign(first.run.backend, { name: 'changed' })
  Object.assign(first.run.diagnostics[0]!, { message: 'changed' })
  Object.assign(first.run.limits, { maxVariables: 1 })
  Object.assign(first.run.inputs[0]!.value as object, { label: 'changed' })
  Object.assign(first.outcome.assignments[0]!.value, { value: false })
  Object.assign(first.outcome.hardConstraints[0]!.declaration!, { line: 99 })
  assert.equal(result.backend.name, 'fixture')
  assert.equal(diagnostic.message, 'original')
  assert.equal(declaration.line, 1)
  assert.equal(context.inputs[0]!.value.label, 'original')
  assert.deepEqual(Explain.report(model, result, Adapter.defaultLimits, context), expected)
})
