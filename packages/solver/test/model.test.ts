import { test } from 'node:test'
import { createHash } from 'node:crypto'
import * as assert from 'node:assert/strict'
import { Adapter, Canonical, Capability, Exact, Explain, Linear, Model, Solve, Validate, Workflow } from '@cavelang/solver'

test('streamed canonical digests equal serialized UTF-8 across token batch boundaries', () => {
  for (const length of [1, 65530, 65536, 65542]) {
    const id = `prefix${'x'.repeat(length)}`
    const value = `😀\\"\n${'v'.repeat(length)}é\ud800`
    const literal: Model.Expression = { kind: 'literal', sort: 'enum', domain: 'Domain', value }
    const expression: Model.Expression = { kind: 'and', operands: [
      ...Array.from({ length: 8 }, (): Model.Expression => ({ kind: 'variable', id })),
      { kind: 'eq', left: literal, right: literal }
    ] }
    const input: Model.t = { schema: Model.schema, variables: [{ id, sort: 'bool' }],
      enums: [{ id: 'Domain', values: [value] }], constraints: [{ id: 'test', expression }] }
    const serialized = Canonical.serialize(input)
    const expected = `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`
    assert.equal(Canonical.digest(input), expected)
    const result: Adapter.Result = { status: 'satisfied', assignment: { [id]: { sort: 'bool', value: true } },
      backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
    assert.equal(Explain.report(input, result, Adapter.defaultLimits).run.modelDigest, expected)
  }
})

test('solve captures model fields once before validating and submitting them', async () => {
  let reads = 0, calls = 0
  const model: Model.t = {
    schema: Model.schema, variables: [],
    get constraints() { return ++reads === 1 ? [] : [{ id: 'invalid', expression: { kind: 'variable' as const, id: 'missing' } }] }
  }
  const adapter: Adapter.t = {
    backend: { name: 'test', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async submitted => {
      calls++
      assert.deepEqual(submitted.constraints, [])
      assert.equal(Object.isFrozen(submitted), true)
      return { status: 'satisfied', backend: { name: 'test', version: '1' }, diagnostics: [], elapsedMs: 0, assignment: {} }
    }
  }
  const result = await Solve.run(adapter, model)
  assert.equal(result.status, 'satisfied')
  assert.equal(reads, 1)
  assert.equal(calls, 1)
})

test('solve and workflows retain captured option getters', async () => {
  for (const invoke of [Solve.run, Workflow.feasibility, Workflow.optimization]) {
    let flagReads = 0, limitReads = 0, calls = 0
    const options: Adapter.Options = {
      get unsatCore() { return ++flagReads === 1 ? false : true },
      get limits() { limitReads++; return { timeoutMs: 1234 } }
    }
    const adapter: Adapter.t = {
      backend: { name: 'test', version: '1' }, capabilities: new Set(Adapter.capabilities),
      solve: async (_model, submitted) => {
        calls++
        assert.equal(submitted.unsatCore, false)
        assert.equal(submitted.limits.timeoutMs, 1234)
        return { status: 'satisfied', backend: { name: 'test', version: '1' }, diagnostics: [], elapsedMs: 0, assignment: {} }
      }
    }
    await invoke(adapter, { schema: Model.schema, variables: [], constraints: [],
      objectives: [{ id: 'constant', direction: 'minimize', expression: { kind: 'literal', sort: 'int', value: 0 } }]
    }, options)
    assert.equal(flagReads, 1)
    assert.equal(limitReads, 1)
    assert.ok(calls > 0)
  }
})

test('invalid limit diagnostics do not invoke caller object coercion', () => {
  let coercions = 0
  for (const value of [Object.create(null),
    { [Symbol.toPrimitive]() { coercions++; throw new Error('coercion must not run') } },
    Object.assign(() => 1, { toString() { coercions++; throw new Error('coercion must not run') } })]) {
    for (const name of ['timeoutMs', 'maxNumericDigits'] as const) {
      assert.throws(() => Validate.mergeLimits({ [name]: value }),
        error => error instanceof TypeError && error.message.includes(`solver limit ${name} must be a positive safe integer`))
    }
  }
  assert.equal(coercions, 0)
  assert.equal(Validate.mergeLimits({ maxNumericDigits: 100 }).maxNumericDigits, 100)
})

test('limit resolution honors inherited and non-enumerable declared overrides', async () => {
  for (const overrides of [Object.create({ timeoutMs: 1234 }),
    Object.defineProperty({}, 'timeoutMs', { value: 1234 })]) {
    const limits = Validate.mergeLimits(overrides)
    assert.equal(limits.timeoutMs, 1234)
    assert.equal(limits.maxVariables, Adapter.defaultLimits.maxVariables)
    let calls = 0
    const adapter: Adapter.t = {
      backend: { name: 'test', version: '1' }, capabilities: new Set(Adapter.capabilities),
      solve: async (_model, options) => {
        calls++
        assert.equal(options.limits.timeoutMs, 1234)
        return { status: 'satisfied', backend: { name: 'test', version: '1' }, diagnostics: [], elapsedMs: 0, assignment: {} }
      }
    }
    for (const invoke of [Solve.run, Workflow.feasibility]) {
      await invoke(adapter, { schema: Model.schema, variables: [], constraints: [] }, { limits: overrides })
    }
    assert.equal(calls, 2)
  }
  for (const timeoutMs of [undefined, 0, -1, NaN]) {
    assert.throws(() => Validate.mergeLimits(Object.create({ timeoutMs })), /timeoutMs must be a positive safe integer/)
  }
})

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const int = (value: Model.Integer): Model.Expression => ({ kind: 'literal', sort: 'int', value })
const real = (value: Model.Rational): Model.Expression => ({ kind: 'literal', sort: 'real', value })
const bool = (value: boolean): Model.Expression => ({ kind: 'literal', sort: 'bool', value })

const fixture = (): Model.t => ({
  schema: Model.schema,
  enums: [{ id: 'architecture', values: ['monolith', 'microservices'] }],
  variables: [
    { id: 'available', sort: 'bool' },
    { id: 'team-size', sort: 'int', min: 1, max: 100 },
    { id: 'cost', sort: 'real', min: '0.00' },
    { id: 'choice', sort: 'enum', domain: 'architecture' }
  ],
  constraints: [
    { id: 'must-be-available', expression: ref('available') },
    { id: 'positive-team', expression: { kind: 'gte', left: ref('team-size'), right: int(1) } },
    {
      id: 'known-choice',
      expression: {
        kind: 'neq',
        left: ref('choice'),
        right: { kind: 'literal', sort: 'enum', domain: 'architecture', value: 'microservices' }
      }
    }
  ],
  softConstraints: [{ id: 'prefer-available', expression: ref('available'), weight: '2.50' }],
  objectives: [
    { id: 'cost-first', direction: 'minimize', expression: ref('cost') },
    { id: 'team-second', direction: 'minimize', expression: ref('team-size') }
  ]
})

test('exact values normalize without JavaScript floating point', () => {
  assert.deepEqual(Exact.rational('0.1000'), { numerator: '1', denominator: '10' })
  assert.deepEqual(Exact.rational('-1.25e2'), { numerator: '-125', denominator: '1' })
  assert.deepEqual(Exact.rational({ numerator: -6, denominator: -8 }), { numerator: '3', denominator: '4' })
  assert.equal(Exact.compare('0.1', { numerator: 1, denominator: 10 }), 0)
  assert.throws(() => Exact.rational('NaN'), /exact decimal/)
  assert.throws(() => Exact.rational({ numerator: 1, denominator: 0 }), /must not be zero/)
  assert.throws(() => Exact.integer(Infinity), /safe integer/)
})

test('validates variables, finite enums, sorts, constraints, and objectives', () => {
  assert.deepEqual(Validate.model(fixture()), {
    variables: 4,
    constraints: 4,
    objectives: 2,
    enumValues: 2,
    expressionNodes: 10,
    expressionDepth: 2
  })
})

test('rejects duplicate IDs, invalid bounds, non-finite values, and invalid sorts together', () => {
  const invalid: Model.t = {
    schema: Model.schema,
    variables: [
      { id: 'n', sort: 'int', min: 10, max: 1 },
      { id: 'n', sort: 'int', min: Infinity, max: 2 }
    ],
    constraints: [
      { id: 'wrong-sort', expression: int(1) },
      { id: 'missing', expression: ref('not-declared') }
    ]
  }
  assert.throws(
    () => Validate.model(invalid),
    (error: unknown) => {
      assert.ok(error instanceof Validate.ModelValidationError)
      assert.match(error.message, /duplicate identifier "n"/)
      assert.match(error.message, /min greater than max/)
      assert.match(error.message, /safe integer/)
      assert.match(error.message, /must be boolean/)
      assert.match(error.message, /unknown variable/)
      return true
    }
  )
})

test('rejects invalid enum values, sort mismatches, zero division, and non-positive soft weights', () => {
  const invalid: Model.t = {
    schema: Model.schema,
    enums: [{ id: 'color', values: ['red'] }],
    variables: [{ id: 'flag', sort: 'bool' }],
    constraints: [
      {
        id: 'bad-enum',
        expression: {
          kind: 'eq',
          left: { kind: 'literal', sort: 'enum', domain: 'color', value: 'blue' },
          right: { kind: 'literal', sort: 'enum', domain: 'color', value: 'red' }
        }
      },
      { id: 'bad-comparison', expression: { kind: 'eq', left: ref('flag'), right: int(1) } },
      {
        id: 'zero-divisor',
        expression: { kind: 'eq', left: { kind: 'divide', left: real('1'), right: real('0.0') }, right: real('1') }
      }
    ],
    softConstraints: [{ id: 'bad-weight', expression: bool(true), weight: '0' }]
  }
  assert.throws(() => Validate.model(invalid), (error: unknown) => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.match(error.message, /outside enum domain/)
    assert.match(error.message, /incompatible bool and int/)
    assert.match(error.message, /divisor must not be zero/)
    assert.match(error.message, /weight must be greater than zero/)
    return true
  })
})

test('enforces deterministic preflight resource limits', () => {
  assert.throws(
    () => Validate.model(fixture(), { maxVariables: 3 }),
    (error: unknown) => error instanceof Validate.ModelLimitError && error.limit === 'maxVariables'
  )
  assert.throws(() => Validate.mergeLimits({ timeoutMs: Number.NaN }), /positive safe integer/)
})

test('declaration count limits reject oversized arrays before inspecting entries', () => {
  const unread = (): never => { throw new Error('over-budget entry was inspected') }
  const oversized = new Array(2)
  Object.defineProperty(oversized, 0, { get: unread })
  for (const [key, limit] of [
    ['variables', 'maxVariables'], ['constraints', 'maxConstraints'],
    ['softConstraints', 'maxConstraints'], ['objectives', 'maxObjectives'],
  ] as const) {
    const input = { schema: Model.schema, variables: [], constraints: [], [key]: oversized } as Model.t
    assert.throws(() => Validate.model(input, { [limit]: 1 }), (error: unknown) =>
      error instanceof Validate.ModelLimitError && error.limit === limit && error.actual === 2 && error.maximum === 1)
  }
  const one = new Array(1)
  Object.defineProperty(one, 0, { get: unread })
  const combined = { schema: Model.schema, variables: [], constraints: one, softConstraints: one }
  assert.throws(() => Validate.model(combined, { maxConstraints: 1 }), (error: unknown) =>
    error instanceof Validate.ModelLimitError && error.limit === 'maxConstraints' && error.actual === 2)
})

test('enum value budgets are checked cumulatively before reading an oversized domain', () => {
  const unread = (): never => { throw new Error('over-budget enum member was inspected') }
  for (const prior of [[], [{ id: 'first', values: ['one'] }]]) {
    const values = new Array(2 - prior.length)
    Object.defineProperty(values, 0, { get: unread })
    const input: Model.t = { schema: Model.schema, variables: [], constraints: [], enums: [...prior, { id: 'last', values }] }
    assert.throws(() => Validate.model(input, { maxEnumValues: 1 }), (error: unknown) =>
      error instanceof Validate.ModelLimitError && error.limit === 'maxEnumValues' && error.actual === 2 && error.maximum === 1)
  }
})

test('rejects unsupported expression kinds before solving', () => {
  const invalid = {
    schema: Model.schema,
    variables: [],
    constraints: [{ id: 'unsupported', expression: { kind: 'quantifier' } }]
  } as unknown as Model.t
  assert.throws(() => Validate.model(invalid), /unsupported expression kind "quantifier"/)
})

test('model containers and declaration lists reject malformed runtime structures', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: { name: 'structure-test', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; throw new Error('malformed model reached backend') },
  }
  const base = { schema: Model.schema, variables: [], constraints: [] }
  const cases: [unknown, string][] = [
    [null, 'model'], [[], 'model'], [42, 'model'], [{}, 'variables'],
    [{ schema: Model.schema, variables: [] }, 'constraints'],
  ]
  for (const key of ['variables', 'constraints', 'enums', 'softConstraints', 'objectives']) {
    for (const value of [null, {}, 'declarations', new Array(1), [null], [42], [[]]]) {
      cases.push([{ ...base, [key]: value }, key])
    }
  }
  for (const [value, path] of cases) {
    const input = value as Model.t
    const check = (error: unknown): boolean => {
      assert.ok(error instanceof Validate.ModelValidationError)
      assert.ok(error.problems.some(problem => problem.startsWith(path)))
      return true
    }
    assert.throws(() => Validate.model(input), check)
    await assert.rejects(() => Solve.run(adapter, input), check)
  }
  assert.equal(calls, 0)
  assert.equal(Validate.model({ ...base, enums: undefined, softConstraints: [], objectives: [] }).variables, 0)
})

test('expression containers and operand lists reject malformed runtime structures', () => {
  const malformed: unknown[] = [Object.assign([], bool(true))]
  for (const kind of ['and', 'or', 'add', 'multiply']) {
    for (const operands of [undefined, null, {}, 'operands', new Array(2)]) {
      malformed.push({ kind, operands })
    }
  }
  for (const expression of malformed) {
    const input = { schema: Model.schema, variables: [], constraints: [{ id: 'rule', expression }] } as unknown as Model.t
    assert.throws(() => Validate.model(input), (error: unknown) => {
      assert.ok(error instanceof Validate.ModelValidationError)
      assert.match(error.message, /constraints\[0\]\.expression/)
      return true
    })
  }
})

test('validates provenance locations and stable reference lists', () => {
  const invalid: Model.t = {
    ...fixture(),
    variables: fixture().variables.map((variable, index) => index === 0 ? {
      ...variable,
      declaration: { uri: '', line: 0 },
      evidenceRowIds: ['row', 'row'],
      scenarioInputIds: ['']
    } : variable)
  }
  assert.throws(() => Validate.model(invalid), (error: unknown) => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.match(error.message, /declaration\.uri must not be empty/)
    assert.match(error.message, /declaration\.line must be a positive safe integer/)
    assert.match(error.message, /evidenceRowIds contains duplicate identifiers/)
    assert.match(error.message, /scenarioInputIds\[0\] must not be empty/)
    return true
  })
})

test('malformed provenance is rejected as model validation before backend execution', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: { name: 'provenance-test', version: '1' },
    capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; throw new Error('invalid provenance reached backend') },
  }
  const malformed = [
    ...['evidenceRowIds', 'scenarioInputIds'].flatMap(key =>
      [new Array(1), [undefined], [null], [42], 'row', null, {}, ['  ']].map(value => ({ [key]: value }))),
    ...[null, [], 'source', { uri: null }, { uri: 42 }, { uri: ['source'] }].map(declaration => ({ declaration })),
  ]
  for (const metadata of malformed) {
    const models = [
      { variables: [{ id: 'flag', sort: 'bool', ...metadata }], constraints: [] },
      { variables: [], constraints: [{ id: 'hard', expression: bool(true), ...metadata }] },
      { variables: [], constraints: [], softConstraints: [{ id: 'soft', expression: bool(true), weight: '1', ...metadata }] },
      { variables: [], constraints: [], objectives: [{ id: 'cost', direction: 'minimize', expression: int(1), ...metadata }] },
    ]
    for (const value of models) {
      const input = { schema: Model.schema, ...value } as unknown as Model.t
      assert.throws(() => Validate.model(input), Validate.ModelValidationError)
      await assert.rejects(() => Solve.run(adapter, input), Validate.ModelValidationError)
    }
  }
  for (const declaration of [null, [], { uri: false }]) {
    const input = { schema: Model.schema, variables: [], constraints: [], enums: [{ id: 'choice', values: ['one'], declaration }] } as unknown as Model.t
    assert.throws(() => Validate.model(input), Validate.ModelValidationError)
  }
  assert.equal(calls, 0)
  const valid: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'flag', sort: 'bool', declaration: { uri: 'model.cave', line: 1, column: 2 }, evidenceRowIds: [], scenarioInputIds: ['input'] }],
    constraints: [],
  }
  assert.equal(Validate.model(valid).variables, 1)
})

test('canonical digest ignores declaration order and labels but preserves objective order', () => {
  const original = fixture()
  const reordered: Model.t = {
    ...original,
    enums: original.enums?.map(domain => ({ ...domain, values: [...domain.values].reverse(), description: 'label changed' })),
    variables: [...original.variables].reverse().map(variable => ({
      ...variable, description: 'label changed', declaration: { uri: 'different/model.cave', line: 99 },
      evidenceRowIds: ['new-row'], scenarioInputIds: ['new-input']
    })),
    constraints: [...original.constraints].reverse().map(constraint => ({
      ...constraint, description: 'label changed', declaration: { uri: 'different/model.cave' },
      evidenceRowIds: ['new-row'], scenarioInputIds: ['new-input']
    })),
    softConstraints: original.softConstraints?.map(constraint => ({
      ...constraint, weight: { numerator: 5, denominator: 2 }, scenarioInputIds: ['new-input']
    })),
    objectives: original.objectives?.map(objective => ({
      ...objective, description: 'label changed', declaration: { uri: 'different/model.cave' },
      evidenceRowIds: ['new-row'], scenarioInputIds: ['new-input']
    }))
  }
  assert.equal(Canonical.serialize(reordered), Canonical.serialize(original))
  assert.equal(Canonical.digest(reordered), Canonical.digest(original))
  assert.match(Canonical.digest(original), /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(Canonical.digest({ ...original, objectives: [...(original.objectives ?? [])].reverse() }), Canonical.digest(original))
})

test('derives portable backend capabilities including nonlinear arithmetic', () => {
  const model: Model.t = {
    schema: Model.schema,
    variables: [
      { id: 'x', sort: 'real' },
      { id: 'y', sort: 'real' }
    ],
    constraints: [{
      id: 'nonlinear',
      expression: {
        kind: 'gte',
        left: { kind: 'multiply', operands: [ref('x'), ref('y')] },
        right: real('1')
      }
    }]
  }
  assert.deepEqual([...Capability.required(model, true)].sort(), [
    'booleans', 'nonlinear-arithmetic', 'rationals', 'unsat-cores'
  ])
  const weightedBoolean: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'flag', sort: 'bool' }],
    constraints: [],
    softConstraints: [{ id: 'preference', expression: ref('flag'), weight: '1.5' }]
  }
  assert.deepEqual([...Capability.required(weightedBoolean)].sort(), ['booleans', 'rationals', 'soft-constraints'])
})

test('integer division requires rational support before crossing the adapter boundary', async () => {
  const division: Model.Expression = { kind: 'divide', left: int(1), right: int(2) }
  const comparison: Model.Expression = { kind: 'lt', left: division, right: int(1) }
  const models: Model.t[] = [
    { schema: Model.schema, variables: [], constraints: [{ id: 'half', expression: comparison }] },
    { schema: Model.schema, variables: [], constraints: [], objectives: [{ id: 'half', direction: 'minimize', expression: division }] },
    { schema: Model.schema, variables: [], constraints: [], softConstraints: [{ id: 'half', weight: '1', expression: comparison }] },
  ]
  let invoked = false
  const adapter: Adapter.t = {
    backend: { name: 'without-rationals', version: '1' },
    capabilities: new Set(Adapter.capabilities.filter(value => value !== 'rationals')),
    solve: async () => { invoked = true; throw new Error('unsupported adapter must not run') },
  }
  for (const model of models) {
    Validate.model(model)
    assert.ok(Capability.required(model).has('rationals'))
    await assert.rejects(Solve.run(adapter, model), (error: unknown) => {
      assert.ok(error instanceof Capability.UnsupportedModelError)
      assert.deepEqual(error.missing, ['rationals'])
      return true
    })
  }
  assert.equal(invoked, false)
})

test('recognizes a strict portable linear subset', () => {
  const linear: Model.t = {
    schema: Model.schema,
    variables: [
      { id: 'x', sort: 'real', min: '0' },
      { id: 'count', sort: 'int', min: 0, max: 10 }
    ],
    constraints: [{
      id: 'budget',
      expression: {
        kind: 'lte',
        left: { kind: 'add', operands: [ref('x'), { kind: 'multiply', operands: [int(2), ref('count')] }] },
        right: real('100')
      }
    }],
    objectives: [{ id: 'maximize-x', direction: 'maximize', expression: ref('x') }]
  }
  assert.deepEqual(Linear.model(linear), { linear: true, problems: [] })
  const nonlinear = {
    ...linear,
    objectives: [{ id: 'product', direction: 'maximize' as const, expression: { kind: 'multiply' as const, operands: [ref('x'), ref('count')] } }]
  }
  assert.deepEqual(Linear.model(nonlinear).linear, false)
  assert.match(Linear.model(nonlinear).problems[0]!, /not linear/)
})

test('fake adapter exercises every result state and receives merged limits', async () => {
  const results: readonly Adapter.Result[] = [
    {
      status: 'satisfied', assignment: {}, backend: { name: 'fake', version: '1' }, diagnostics: [], elapsedMs: 1
    },
    {
      status: 'optimal', assignment: {}, objectives: [], optimalityProved: true,
      backend: { name: 'fake', version: '1' }, diagnostics: [], elapsedMs: 2
    },
    {
      status: 'unsatisfied', core: ['must-be-available'], infeasibilityProved: true,
      backend: { name: 'fake', version: '1' }, diagnostics: [], elapsedMs: 3
    },
    {
      status: 'unknown', reason: { kind: 'timeout', message: 'deadline reached', limit: 'timeoutMs' },
      backend: { name: 'fake', version: '1' }, diagnostics: [], elapsedMs: 4
    }
  ]
  const requests: Adapter.Request[] = []
  let next = 0
  const adapter: Adapter.t = {
    backend: { name: 'fake', version: '1' },
    capabilities: new Set(Adapter.capabilities),
    solve: async (_model, request) => {
      requests.push(request)
      return results[next++]!
    }
  }
  for (const expected of results) {
    assert.equal((await Solve.run(adapter, fixture(), { limits: { timeoutMs: 123 }, unsatCore: true })).status, expected.status)
  }
  assert.equal(requests.length, 4)
  assert.equal(requests[0]!.limits.timeoutMs, 123)
  assert.equal(requests[0]!.limits.maxMemoryBytes, Adapter.defaultLimits.maxMemoryBytes)
  assert.equal(requests[0]!.limits.maxVariables, Adapter.defaultLimits.maxVariables)
  assert.equal(requests[0]!.unsatCore, true)
})

test('portable models survive JSON round trips without identity drift', () => {
  const original = fixture()
  const roundTripped = JSON.parse(JSON.stringify(original)) as Model.t
  assert.deepEqual(Validate.model(roundTripped), Validate.model(original))
  assert.equal(Canonical.digest(roundTripped), Canonical.digest(original))
})

test('missing capabilities fail deterministically before invoking an adapter', async () => {
  let invoked = false
  const adapter: Adapter.t = {
    backend: { name: 'feasibility-only', version: '1' },
    capabilities: new Set(['booleans']),
    solve: async () => {
      invoked = true
      throw new Error('must not run')
    }
  }
  await assert.rejects(
    Solve.run(adapter, fixture()),
    (error: unknown) => {
      assert.ok(error instanceof Capability.UnsupportedModelError)
      assert.deepEqual(error.missing, [
        'finite-enums', 'integers', 'lexicographic-objectives', 'optimization', 'rationals', 'soft-constraints'
      ])
      return true
    }
  )
  assert.equal(invoked, false)
})

test('preflight model limits fail before invoking an adapter', async () => {
  let invoked = false
  const adapter: Adapter.t = {
    backend: { name: 'fake', version: '1' },
    capabilities: new Set(Adapter.capabilities),
    solve: async () => {
      invoked = true
      throw new Error('must not run')
    }
  }
  await assert.rejects(
    Solve.run(adapter, fixture(), { limits: { maxVariables: 1 } }),
    (error: unknown) => error instanceof Validate.ModelLimitError && error.limit === 'maxVariables'
  )
  assert.equal(invoked, false)
})

test('invalid solver options fail before adapter execution', async () => {
  const invalid: unknown[] = [
    { limits: { timeout: 1 } }, { limits: null }, { limits: [] },
    { unsatCore: 'false' }, { unsatCore: null }, { unsatcore: true },
    null, [],
  ]
  for (const options of invalid) {
    let invoked = false
    const adapter: Adapter.t = {
      backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
      solve: async () => {
        invoked = true
        return { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
      },
    }
    await assert.rejects(Solve.run(adapter, fixture(), options as Adapter.Options), TypeError)
    assert.equal(invoked, false)
  }
})

test('canonical identity accepts explicit limits without making limits part of identity', () => {
  const input: Model.t = { schema: Model.schema, variables: Array.from({ length: 1001 }, (_, index) => ({ id: `flag${index}`, sort: 'bool' })), constraints: [] }
  assert.throws(() => Canonical.digest(input), Validate.ModelLimitError)
  const digest = Canonical.digest(input, { maxVariables: 1001 })
  assert.equal(Canonical.digest(input, { maxVariables: 2000 }), digest)
  assert.equal(Canonical.serialize(input, { maxVariables: 1001 }), Canonical.serialize(input, { maxVariables: 2000 }))
})

test('linear recognition rejects computed zero divisors without rounding tiny nonzero constants', () => {
  const divisor: Model.Expression = { kind: 'subtract', left: real('0.3'), right: { kind: 'add', operands: [real('0.1'), real('0.2')] } }
  const withDivisor = (right: Model.Expression): Model.t => ({
    schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
    objectives: [{ id: 'ratio', direction: 'minimize', expression: { kind: 'divide', left: ref('x'), right } }],
  })
  const zero = withDivisor(divisor)
  Validate.model(zero) // General SMT arithmetic may totalize division by zero.
  assert.equal(Linear.model(zero).linear, false)
  const nonzero = withDivisor({ kind: 'add', operands: [divisor, real('1e-400')] })
  assert.equal(Linear.model(nonzero).linear, true)
  const nested = withDivisor({ kind: 'divide', left: int(1), right: divisor })
  assert.equal(Linear.model(nested).linear, false)
})

test('linear analysis honors explicit model limits without changing classification', () => {
  const input: Model.t = {
    schema: Model.schema,
    variables: Array.from({ length: 1001 }, (_, index) => ({ id: `count${index}`, sort: 'int', min: 0, max: 1 })),
    constraints: [],
  }
  assert.throws(() => Linear.model(input), Validate.ModelLimitError)
  assert.deepEqual(Linear.model(input, { maxVariables: 1001 }), { linear: true, problems: [] })
  assert.deepEqual(Linear.model(input, { maxVariables: 2000 }), Linear.model(input, { maxVariables: 1001 }))
  assert.throws(() => Linear.model(input, { maxVariables: 999 }), Validate.ModelLimitError)
})

test('exact integers reject coercible values outside the documented input types', () => {
  for (const input of [[1], 1n, { toString: () => '1' }, new Number(1)]) {
    assert.throws(() => Exact.integer(input as unknown as Model.Integer), TypeError)
  }
  assert.equal(Exact.integer('+001'), 1n)
  assert.equal(Exact.integer(-3), -3n)
})

test('exact decimal zero does not construct an unused enormous power of ten', () => {
  for (const input of ['0e9007199254740991', '-0.000e-9007199254740991']) {
    assert.deepEqual(Exact.rational(input), { numerator: '0', denominator: '1' })
  }
  assert.throws(() => Exact.rational('0e9007199254740992'), /outside the supported range/)
})

test('exact rational normalization preserves value and ordering across signs and large integers', () => {
  for (let numerator = -32; numerator <= 32; numerator++) {
    for (let denominator = -16; denominator <= 16; denominator++) {
      if (denominator === 0) continue
      const input = { numerator, denominator }
      const normalized = Exact.rational(input)
      const n = BigInt(normalized.numerator)
      const d = BigInt(normalized.denominator)
      assert.ok(d > 0n)
      assert.equal(n * BigInt(denominator), BigInt(numerator) * d)
      // Trial division is independent of the implementation's Euclidean GCD.
      for (let divisor = 2n; divisor <= d; divisor++) {
        assert.ok(n % divisor !== 0n || d % divisor !== 0n)
      }
      if (numerator === 0) assert.equal(d, 1n)
      assert.deepEqual(Exact.rational(normalized), normalized)
      assert.equal(Exact.compare(input, normalized), 0)
      assert.equal(Exact.isZero(input), numerator === 0)
    }
  }

  // All adjacent values here collapse to the same JavaScript Number.
  const base = 10n ** 80n
  for (const sign of [-1n, 1n]) {
    for (let offset = -8n; offset <= 8n; offset++) {
      const a = sign * base + offset
      const left = { numerator: String(a), denominator: '7' }
      const right = { numerator: String(a + 1n), denominator: '7' }
      assert.equal(Exact.compare(left, right), -1)
      assert.equal(Exact.compare(right, left), 1)
      assert.equal(Exact.compare(left, { numerator: String(-a * 3n), denominator: '-21' }), 0)
    }
  }
  for (const [decimal, pair] of [
    ['9007199254740993.125', { numerator: '72057594037927945', denominator: '8' }],
    ['-1.25e-40', { numerator: '-1', denominator: `8${'0'.repeat(39)}` }],
    ['1.25e40', { numerator: `125${'0'.repeat(38)}`, denominator: '1' }],
  ] as const) {
    assert.deepEqual(Exact.rational(decimal), pair)
    assert.equal(Exact.compare(decimal, pair), 0)
  }
})

test('exact numeric strings must consume the entire input, including final line breaks', () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assert.throws(() => Exact.integer(`1${suffix}`), TypeError)
    assert.throws(() => Exact.rational(`1.5${suffix}`), TypeError)
  }
})

test('model identifiers must be primitive strings matching the complete identifier grammar', () => {
  for (const id of ['flag\n', 'flag\r', 'flag\u2028', ['flag'], { toString: () => 'flag' }]) {
    const invalid = id as unknown as string
    const base = { schema: Model.schema, variables: [], constraints: [] }
    const models: Model.t[] = [
      { ...base, variables: [{ id: invalid, sort: 'bool' }] },
      { ...base, enums: [{ id: invalid, values: ['one'] }] },
      { ...base, constraints: [{ id: invalid, expression: bool(true) }] },
      { ...base, softConstraints: [{ id: invalid, expression: bool(true), weight: '1' }] },
      { ...base, objectives: [{ id: invalid, direction: 'minimize', expression: int(1) }] },
    ]
    for (const input of models) assert.throws(() => Validate.model(input), Validate.ModelValidationError)
  }
})

test('enum domains reject non-string members, sparse lists, and non-array containers', () => {
  for (const values of [[1], [null], [{}], Array(1), 'ab', null]) {
    const input: Model.t = { schema: Model.schema, variables: [], constraints: [], enums: [{ id: 'choice', values: values as unknown as string[] }] }
    assert.throws(() => Validate.model(input), Validate.ModelValidationError)
  }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [], enums: [{ id: 'choice', values: ['', '東京', 'two words'] }] }
  assert.equal(Validate.model(input).enumValues, 3)
})

test('model validation rejects unknown sorts and non-Boolean Boolean literals', () => {
  const base: Model.t = { schema: Model.schema, variables: [{ id: 'flag', sort: 'bool' }], constraints: [] }
  for (const value of ['false', 0, null]) {
    const expression = { kind: 'literal', sort: 'bool', value } as unknown as Model.Expression
    assert.throws(() => Validate.model({ ...base, constraints: [{ id: 'check', expression }] }), Validate.ModelValidationError)
  }
  assert.throws(() => Validate.model({ ...base, variables: [{ id: 'flag', sort: 'unknown' } as unknown as Model.Variable] }), Validate.ModelValidationError)
  const expression = { kind: 'literal', sort: 'unknown', id: 'flag' } as unknown as Model.Expression
  assert.throws(() => Validate.model({ ...base, constraints: [{ id: 'check', expression }] }), Validate.ModelValidationError)
})

test('expression depth is bounded during traversal, including cyclic input', () => {
  let expression: Model.Expression = bool(true)
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const input = (value: Model.Expression): Model.t => ({ schema: Model.schema, variables: [], constraints: [{ id: 'deep', expression: value }] })
  const depthError = (error: unknown): boolean => error instanceof Validate.ModelLimitError && error.limit === 'maxExpressionDepth' && error.actual === 129
  assert.throws(() => Validate.model(input(expression)), depthError)
  const cyclic = { kind: 'not', value: undefined } as unknown as { kind: 'not', value: Model.Expression }
  cyclic.value = cyclic
  assert.throws(() => Validate.model(input(cyclic)), depthError)
})

test('depth boundaries preserve malformed paths and defer over-limit child inspection', () => {
  const nested = (leaf: Model.Expression, wrappers: number): Model.Expression => {
    let expression = leaf
    for (let index = 0; index < wrappers; index++) expression = { kind: 'not', value: expression }
    return expression
  }
  const input = (expression: Model.Expression): Model.t => ({ schema: Model.schema, variables: [], constraints: [{ id: 'depth', expression }] })
  assert.throws(() => Validate.model(input(nested(null as unknown as Model.Expression, 127))), (error: unknown) => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.deepEqual(error.problems, [`constraints[0].expression${'.value'.repeat(127)} must be an expression object`])
    return true
  })
  let reads = 0
  const leaf = { get kind() { reads++; throw new Error('over-depth child inspected') } } as unknown as Model.Expression
  const model = input(nested(leaf, 128))
  assert.throws(() => Validate.model(model), (error: unknown) =>
    error instanceof Validate.ModelLimitError && error.limit === 'maxExpressionDepth' && error.actual === 129)
  assert.equal(reads, 0)
  Object.defineProperties(leaf, {
    kind: { value: 'literal' }, sort: { value: 'bool' }, value: { value: true }
  })
  const stats = Validate.model(model, { maxExpressionDepth: 129 })
  assert.equal(stats.expressionDepth, 129)
  assert.equal(stats.expressionNodes, 129)
  assert.equal(reads, 0)
})

test('node budget is enforced before inspecting an over-budget child', () => {
  const child = { get kind() { throw new Error('over-budget child inspected') } } as unknown as Model.Expression
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'wide', expression: { kind: 'and', operands: [child, bool(true)] } }] }
  assert.throws(() => Validate.model(input, { maxExpressionNodes: 1 }), (error: unknown) =>
    error instanceof Validate.ModelLimitError && error.limit === 'maxExpressionNodes' && error.actual === 2)
})

test('raised depth limits validate deep expressions without consuming the host call stack', () => {
  let expression: Model.Expression = bool(true)
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'deep', expression }] }
  const stats = Validate.model(input, { maxExpressionDepth: 20_001 })
  assert.equal(stats.expressionDepth, 20_001)
  assert.equal(stats.expressionNodes, 20_001)
})

test('shared subexpressions count at each occurrence and preserve diagnostic paths', () => {
  const shared: Model.Expression = { kind: 'not', value: bool(false) }
  const withChildren = (value: Model.Expression): Model.t => ({ schema: Model.schema, variables: [], constraints: [{ id: 'shared', expression: { kind: 'and', operands: [value, value] } }] })
  assert.equal(Validate.model(withChildren(shared)).expressionNodes, 5)
  assert.throws(() => Validate.model(withChildren(ref('missing'))), (error: unknown) => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.ok(error.problems.some(problem => problem.includes('operands[0]')))
    assert.ok(error.problems.some(problem => problem.includes('operands[1]')))
    return true
  })
})

test('capability discovery handles deep arithmetic and shared variable-bearing operands', () => {
  let expression: Model.Expression = ref('x')
  const two = int(2)
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'multiply', operands: [two, expression] }
  const input = (value: Model.Expression): Model.t => ({ schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: 0, max: 1 }], constraints: [], objectives: [{ id: 'value', direction: 'minimize', expression: value }] })
  assert.deepEqual([...Capability.required(input(expression))].sort(), ['booleans', 'integers', 'optimization'])
  assert.equal(Capability.required(input({ kind: 'multiply', operands: [expression, expression] })).has('nonlinear-arithmetic'), true)
})

test('capability discovery rejects cyclic expressions without looping', () => {
  const expression = { kind: 'not', value: undefined } as unknown as { kind: 'not', value: Model.Expression }
  expression.value = expression
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'cycle', expression }] }
  assert.throws(() => Capability.required(input), /cyclic expression/)
})

test('deep validated models reach adapters as independent frozen submissions', async () => {
  let expression: Model.Expression = bool(true)
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'deep', expression }] }
  const adapter: Adapter.t = {
    backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async candidate => {
      assert.notEqual(candidate, input)
      assert.notEqual(candidate.constraints[0]!.expression, expression)
      let at = candidate.constraints[0]!.expression
      let depth = 0
      while (at.kind === 'not') { assert.ok(Object.isFrozen(at)); depth++; at = at.value }
      assert.equal(depth, 20_000)
      return { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
    },
  }
  assert.equal((await Solve.run(adapter, input, { limits: { maxExpressionDepth: 20_001 } })).status, 'satisfied')
  assert.equal(Object.isFrozen(expression), false)
})

test('canonical identity handles deep expressions without changing model content', () => {
  let expression: Model.Expression = bool(true)
  for (let depth = 0; depth < 20_000; depth++) expression = { kind: 'not', value: expression }
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'deep', expression }] }
  const limits = { maxExpressionDepth: 20_001 }
  const serialized = Canonical.serialize(input, limits)
  assert.equal((serialized.match(/"kind":"not"/g) ?? []).length, 20_000)
  assert.match(Canonical.digest(input, limits), /^sha256:[0-9a-f]{64}$/)
})

test('iterative canonicalization retains the established fixture digest', () => {
  assert.equal(Canonical.digest(fixture()), 'sha256:e4909e6b6ef0195547bc847f838288bd1444db4c28bab5a4ce95fe360663628b')
})

test('deep commutative arithmetic sorts canonically without rendering every subtree eagerly', () => {
  let left: Model.Expression = ref('x')
  let right: Model.Expression = ref('x')
  const two = int(2)
  for (let depth = 0; depth < 10_000; depth++) {
    left = { kind: 'multiply', operands: [left, two] }
    right = { kind: 'multiply', operands: [two, right] }
  }
  const input = (expression: Model.Expression): Model.t => ({ schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: 0, max: 1 }], constraints: [], objectives: [{ id: 'product', direction: 'minimize', expression }] })
  const limits = { maxExpressionDepth: 10_001 }
  assert.equal(Canonical.digest(input(left), limits), Canonical.digest(input(right), limits))
})

test('canonical commutative ordering agrees with complete JSON text for escaped and long enum values', () => {
  const values = ['a', 'aa', 'a"', 'a\\', 'a\n', 'é', '😀', '\ud800', '\udfff',
    `${'x'.repeat(65536)}a`, `${'x'.repeat(65536)}b`]
  const literal = (value: string): Model.Expression => ({ kind: 'literal', sort: 'enum', domain: 'Domain', value })
  const checkOrdering = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(checkOrdering); return }
    const record = value as Record<string, unknown>
    if (record.kind === 'and' || record.kind === 'or') {
      const rendered = (record.operands as unknown[]).map(operand => JSON.stringify(operand))
      assert.deepEqual(rendered, [...rendered].sort())
    } else if (record.kind === 'eq' || record.kind === 'neq') {
      assert.ok(JSON.stringify(record.left) <= JSON.stringify(record.right))
    }
    Object.values(record).forEach(checkOrdering)
  }
  const reverseCommutative = (node: Model.Expression): Model.Expression => {
    switch (node.kind) {
      case 'and': case 'or':
        return { ...node, operands: node.operands.map(reverseCommutative).reverse() }
      case 'eq': case 'neq':
        return { ...node, left: node.right, right: node.left }
      default: return node
    }
  }
  for (let offset = 0; offset < values.length; offset++) {
    const operands: Model.Expression[] = values.map((value, index) => ({
      kind: index % 2 === 0 ? 'eq' : 'neq', left: literal(value),
      right: literal(values[(index + offset) % values.length]!)
    }))
    const expression: Model.Expression = { kind: 'and', operands: [
      ...operands, { kind: 'or', operands: [...operands].reverse() }
    ] }
    const model = (input: Model.Expression): Model.t => ({ schema: Model.schema,
      enums: [{ id: 'Domain', values }], variables: [], constraints: [{ id: 'unicode', expression: input }] })
    const original = model(expression)
    const reversed = model(reverseCommutative(expression))
    const serialized = Canonical.serialize(original)
    checkOrdering(JSON.parse(serialized))
    assert.equal(Canonical.serialize(reversed), serialized)
    const expected = `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`
    assert.equal(Canonical.digest(original), expected)
    assert.equal(Canonical.digest(reversed), expected)
  }
})

test('canonical preparation reuses shared nodes only within one captured model', () => {
  const sum: Model.Expression = { kind: 'add', operands: [int(1), int(2)] }
  const predicate: Model.Expression = { kind: 'lt', left: sum, right: int(5) }
  const input: Model.t = { schema: Model.schema, variables: [],
    constraints: [{ id: 'hard', expression: predicate }],
    softConstraints: [{ id: 'soft', expression: predicate, weight: '1' }],
    objectives: [{ id: 'sum', direction: 'minimize', expression: sum }] }
  const expanded = JSON.parse(JSON.stringify(input)) as Model.t
  assert.notEqual(expanded.constraints[0]!.expression, expanded.softConstraints![0]!.expression)
  assert.equal(Validate.model(input).expressionNodes, 13)
  assert.deepEqual(Validate.model(input), Validate.model(expanded))
  assert.equal(Canonical.serialize(input), Canonical.serialize(expanded))
  const original = Canonical.digest(input)
  assert.equal(original, Canonical.digest(expanded))
  assert.throws(() => Canonical.digest(input, { maxExpressionNodes: 12 }), Validate.ModelLimitError)
  ;(sum.operands as Model.Expression[]).push(int(3))
  assert.notEqual(Canonical.digest(input), original)
  assert.equal(Canonical.digest(expanded), original)
})

test('linear classification handles deep affine terms and exact constant divisors', () => {
  let term: Model.Expression = ref('x')
  let divisor: Model.Expression = int(1)
  for (let depth = 0; depth < 20_000; depth++) {
    term = { kind: 'negate', value: term }
    divisor = { kind: 'negate', value: divisor }
  }
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [], objectives: [{ id: 'ratio', direction: 'minimize', expression: { kind: 'divide', left: term, right: divisor } }] }
  assert.deepEqual(Linear.model(input, { maxExpressionDepth: 20_002 }), { linear: true, problems: [] })
})

test('linear classification counts shared variable-bearing factors separately', () => {
  const factor: Model.Expression = { kind: 'add', operands: [ref('x'), int(1)] }
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [], objectives: [{ id: 'square', direction: 'minimize', expression: { kind: 'multiply', operands: [factor, factor] } }] }
  assert.deepEqual(Linear.model(input), { linear: false, problems: ['objective square is not linear'] })
})

test('unrepresentable nonzero decimal expansions reject without affecting later exact arithmetic', () => {
  for (const value of ['1e9007199254740991', '1e-9007199254740991', '-1e9007199254740991']) {
    assert.throws(() => Exact.rational(value), RangeError)
  }
  assert.deepEqual(Exact.rational('1.25'), { numerator: '5', denominator: '4' })
  assert.equal(Exact.compare('-1.25', '-1.2'), -1)
})

test('numeric budget rejects short exponent expansions before exact arithmetic', () => {
  for (const value of ['1e1000000', '1e-1000000']) {
    const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real', min: value }], constraints: [] }
    assert.throws(() => Validate.model(input), error => error instanceof Validate.ModelLimitError &&
      error.limit === 'maxNumericDigits' && error.maximum === 100_000 && error.actual === 1_000_002)
  }
  const zero: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real', min: '0e9007199254740991' }], constraints: [] }
  assert.doesNotThrow(() => Validate.model(zero, { maxNumericDigits: 2 }))
})

test('numeric budget counts bounds, fraction components, weights and repeated literal occurrences', () => {
  const literal = { kind: 'literal', sort: 'int', value: '123' } as const
  const cases: [Model.t, number][] = [
    [{ schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: '-0002', max: '1234' }], constraints: [] }, 8],
    [{ schema: Model.schema, variables: [{ id: 'x', sort: 'real', min: '.001' }], constraints: [] }, 7],
    [{ schema: Model.schema, variables: [], constraints: [{ id: 'same', expression: { kind: 'eq', left: literal, right: literal } }] }, 6],
    [{ schema: Model.schema, variables: [], constraints: [], softConstraints: [{ id: 'soft', expression: { kind: 'literal', sort: 'bool', value: true }, weight: { numerator: '12', denominator: '30' } }] }, 4],
  ]
  for (const [input, digits] of cases) {
    assert.doesNotThrow(() => Validate.model(input, { maxNumericDigits: digits }))
    assert.throws(() => Validate.model(input, { maxNumericDigits: digits - 1 }), error =>
      error instanceof Validate.ModelLimitError && error.limit === 'maxNumericDigits' && error.actual === digits)
  }
})

test('numeric budget prevents backend execution and permits an explicit larger budget', async () => {
  let calls = 0
  const adapter: Adapter.t = {
    backend: { name: 'test', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async () => {
      calls++
      return { status: 'satisfied', backend: { name: 'test', version: '1' }, diagnostics: [], elapsedMs: 0, assignment: {} }
    }
  }
  const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real', min: '1e3' }], constraints: [] }
  await assert.rejects(() => Solve.run(adapter, input, { limits: { maxNumericDigits: 4 } }), Validate.ModelLimitError)
  assert.equal(calls, 0)
  assert.equal((await Solve.run(adapter, input, { limits: { maxNumericDigits: 5 } })).status, 'satisfied')
  assert.equal(calls, 1)
})


test('numeric validation captures changing input values before budgeting', () => {
  for (const inspect of [Validate.model]) {
    let reads = 0
    const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real',
      get min() { return ++reads === 1 ? '1' : '1e9007199254740991' } }], constraints: [] }
    assert.doesNotThrow(() => inspect(input, { maxNumericDigits: 2 }))
    assert.equal(reads, 1)
  }
})


test('canonical and linear arithmetic recheck captured numeric values after initial validation', () => {
  for (const inspect of [Canonical.serialize, Linear.model]) {
    let reads = 0
    const input: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real',
      get min() { return ++reads === 1 ? '1' : '1e9007199254740991' } }], constraints: [] }
    assert.throws(() => inspect(input, { maxNumericDigits: 2 }), Validate.ModelLimitError)
  }
})


test('numeric validation captures fraction fields and does not reread a literal divisor', () => {
  let numeratorReads = 0, denominatorReads = 0, literalReads = 0
  const fraction = {
    get numerator() { return ++numeratorReads === 1 ? '1' : '9'.repeat(100_001) },
    get denominator() { return ++denominatorReads === 1 ? '1' : '0' },
  }
  const input: Model.t = {
    schema: Model.schema, variables: [{ id: 'x', sort: 'real', min: fraction }],
    constraints: [{ id: 'divide', expression: {
      kind: 'eq', left: { kind: 'divide', left: { kind: 'literal', sort: 'real', value: '1' },
        right: { kind: 'literal', sort: 'real', get value() { return ++literalReads === 1 ? '1' : '1e9007199254740991' } } },
      right: { kind: 'literal', sort: 'real', value: '1' },
    } }],
  }
  assert.doesNotThrow(() => Validate.model(input, { maxNumericDigits: 8 }))
  assert.deepEqual([numeratorReads, denominatorReads, literalReads], [1, 1, 1])
})

test('exact comparison shortcuts preserve signed fraction ordering and operand validation', () => {
  for (let a = -4n; a <= 4n; a++) for (let b = -4n; b <= 4n; b++) {
    if (b === 0n) continue
    for (let c = -4n; c <= 4n; c++) for (let d = -4n; d <= 4n; d++) {
      if (d === 0n) continue
      const signedDifference = (a * d - c * b) * b * d
      const expected = signedDifference < 0n ? -1 : signedDifference > 0n ? 1 : 0
      assert.equal(Exact.compare({ numerator: String(a), denominator: String(b) },
        { numerator: String(c), denominator: String(d) }), expected, `${a}/${b} versus ${c}/${d}`)
    }
  }
  assert.throws(() => Exact.compare('0', { numerator: '1', denominator: '0' }), /must not be zero/)
  assert.throws(() => Exact.compare('0', 'NaN'), /exact decimal/)
})


test('malformed model descriptions fail consistently before adapter execution', async () => {
  let calls = 0
  const result: Adapter.Result = { status: 'unknown',
    reason: { kind: 'indeterminate', message: 'fixture' },
    backend: { name: 'description-test', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const adapter: Adapter.t = { backend: result.backend, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return result } }
  for (const description of [null, 42, false, {}, []]) {
    const models = [
      { variables: [], constraints: [], enums: [{ id: 'choice', values: ['one'], description }] },
      { variables: [{ id: 'flag', sort: 'bool', description }], constraints: [] },
      { variables: [], constraints: [{ id: 'hard', expression: bool(true), description }] },
      { variables: [], constraints: [], softConstraints: [{ id: 'soft', expression: bool(true), weight: '1', description }] },
      { variables: [], constraints: [], objectives: [{ id: 'cost', direction: 'minimize', expression: int(1), description }] },
    ]
    for (const value of models) {
      const input = { schema: Model.schema, ...value } as unknown as Model.t
      const rejected = (error: unknown): boolean => {
        assert.ok(error instanceof Validate.ModelValidationError)
        assert.match(error.message, /description must be a string/)
        return true
      }
      assert.throws(() => Validate.model(input), rejected)
      assert.throws(() => Canonical.digest(input), rejected)
      assert.throws(() => Explain.report(input, result, Adapter.defaultLimits), rejected)
      await assert.rejects(Solve.run(adapter, input), rejected)
    }
  }
  assert.equal(calls, 0)
  const input: Model.t = { schema: Model.schema, variables: [], constraints: [
    { id: 'hard', expression: bool(true) }
  ] }
  const expected = Canonical.digest(input)
  for (const description of ['', 'Café — model note']) {
    const described: Model.t = { ...input, constraints: [{ ...input.constraints[0]!, description }] }
    assert.equal(Canonical.digest(described), expected)
    await Solve.run(adapter, described)
    const report = Explain.report(described, { ...result, status: 'satisfied', assignment: {} }, Adapter.defaultLimits)
    assert.equal(report.outcome.status, 'satisfied')
    if (report.outcome.status === 'satisfied') assert.equal(report.outcome.hardConstraints[0]!.description, description)
  }
  assert.equal(calls, 2)
})

test('malformed identifiers and expression tags retain classified diagnostics without JSON hooks', async () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  let hooks = 0
  const hostile = { toJSON() { hooks++; throw new Error('unexpected JSON hook') } }
  const base = { schema: Model.schema, variables: [], constraints: [] }
  for (const value of [1n, cycle, hostile]) {
    const models = [
      { ...base, variables: [{ id: value, sort: 'bool' }, { id: value, sort: 'bool' }] },
      { ...base, variables: [{ id: 'x', sort: 'enum', domain: value }] },
      { ...base, constraints: [{ id: 'c', expression: { kind: value } }] },
      { ...base, constraints: [{ id: 'c', expression: { kind: 'variable', id: value } }] },
      { ...base, constraints: [{ id: 'c', expression: { kind: 'literal', sort: 'enum', domain: value, value: 'x' } }] },
      { ...base, enums: [{ id: 'D', values: ['x'] }], constraints: [{ id: 'c', expression: { kind: 'literal', sort: 'enum', domain: 'D', value } }] },
    ]
    for (const malformed of models) {
      assert.throws(() => Validate.model(malformed as unknown as Model.Model), Validate.ModelValidationError)
      assert.throws(() => Canonical.digest(malformed as unknown as Model.Model), Validate.ModelValidationError)
    }
  }
  assert.equal(hooks, 0)
  let calls = 0
  const adapter: Adapter.SolverAdapter = { backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; return { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, elapsedMs: 0, diagnostics: [] } } }
  await assert.rejects(Solve.run(adapter, { ...base, variables: [{ id: 1n, sort: 'bool' }, { id: 1n, sort: 'bool' }] } as unknown as Model.Model), Validate.ModelValidationError)
  assert.equal(calls, 0)
  await Solve.run(adapter, base)
  assert.equal(calls, 1)
})

test('callable rational containers cannot bypass numeric preflight or expose getters', () => {
  let reads = 0
  const callable = Object.defineProperties(() => undefined, {
    numerator: { get() { reads++; return '1'.repeat(64) } },
    denominator: { get() { reads++; return '1' } },
  })
  for (const value of [callable, null, undefined, true, 1, 1n, Symbol('fraction')]) {
    assert.throws(() => Exact.rational(value as unknown as Model.Rational), { name: 'TypeError', message: 'expected an exact decimal string or a numerator/denominator object' })
  }
  const input: Model.Model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real', min: callable as unknown as Model.Rational }], constraints: [] }
  assert.throws(() => Validate.model(input, { maxNumericDigits: 2 }), Validate.ModelValidationError)
  assert.equal(reads, 0)
  const corrected: Model.Model = { ...input, variables: [{ id: 'x', sort: 'real', min: { numerator: '1'.repeat(64), denominator: '1' } }] }
  assert.throws(() => Validate.model(corrected, { maxNumericDigits: 2 }), Validate.ModelLimitError)
  assert.equal(Validate.model(corrected, { maxNumericDigits: 65 }).variables, 1)
  assert.deepEqual(Exact.rational({ numerator: '2', denominator: '4' }), { numerator: '1', denominator: '2' })
  const fields: ((value: Model.Rational) => Model.Model)[] = [
    value => ({ ...input, variables: [{ id: 'x', sort: 'real', min: value }] }),
    value => ({ ...input, variables: [{ id: 'x', sort: 'real', max: value }] }),
    value => ({ ...input, variables: [], objectives: [{ id: 'cost', direction: 'minimize', expression: { kind: 'literal', sort: 'real', value } }] }),
    value => ({ ...input, variables: [], softConstraints: [{ id: 'prefer', expression: { kind: 'literal', sort: 'bool', value: true }, weight: value }] }),
  ]
  for (const field of fields) {
    assert.throws(() => Validate.model(field(callable as unknown as Model.Rational), { maxNumericDigits: 2 }), Validate.ModelValidationError)
    const valid = field({ numerator: '1'.repeat(64), denominator: '1' })
    assert.throws(() => Validate.model(valid, { maxNumericDigits: 2 }), Validate.ModelLimitError)
    assert.doesNotThrow(() => Validate.model(valid, { maxNumericDigits: 65 }))
  }
  assert.equal(reads, 0)
})

test('exact zero checks reject non-object rational containers before property access', () => {
  let reads = 0
  const callable = Object.defineProperties(() => undefined, {
    numerator: { get() { reads++; return '0' } },
    denominator: { get() { reads++; return '1' } },
  })
  for (const value of [callable, null, undefined, true, 1, 1n, Symbol('fraction')]) {
    assert.throws(() => Exact.isZero(value as unknown as Model.Rational), { name: 'TypeError', message: 'expected an exact decimal string or a numerator/denominator object' })
  }
  assert.equal(reads, 0)
  assert.equal(Exact.isZero({ numerator: '0', denominator: '2' }), true)
  assert.equal(Exact.isZero({ numerator: '1', denominator: '2' }), false)
  assert.throws(() => Exact.isZero({ numerator: '0', denominator: '0' }), /denominator must not be zero/)
})


test('objective directions reject malformed values before adapter execution and allow corrected retry', async () => {
  let calls = 0
  const directions: string[] = []
  const adapter: Adapter.t = {
    backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async submitted => {
      calls++
      directions.push(submitted.objectives![0]!.direction)
      return { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
    }
  }
  const input = (direction: unknown): Model.t => ({
    schema: Model.schema, variables: [], constraints: [],
    objectives: [{ id: 'cost', direction: direction as Model.Objective['direction'],
      expression: { kind: 'literal', sort: 'int', value: 1 } }]
  })
  const invalid = (error: unknown): boolean => error instanceof Validate.ModelValidationError
    && error.problems.includes('objectives[0].direction must be minimize or maximize')
  for (const direction of [undefined, null, '', 'minimum', 'MINIMIZE', false, 0, 1n, {}, []]) {
    const model = input(direction)
    assert.throws(() => Validate.model(model), invalid)
    assert.throws(() => Canonical.digest(model), invalid)
    await assert.rejects(Solve.run(adapter, model), invalid)
  }
  assert.equal(calls, 0)
  for (const direction of ['minimize', 'maximize'] as const) {
    const model = input(direction)
    assert.equal(Validate.model(model).objectives, 1)
    assert.match(Canonical.digest(model), /^sha256:/)
    await Solve.run(adapter, model)
  }
  assert.equal(calls, 2)
  assert.deepEqual(directions, ['minimize', 'maximize'])
})


test('invalid variable sorts retain classified errors when referenced by expressions', () => {
  let coercions = 0
  const hostile = { [Symbol.toPrimitive]() { coercions++; throw new Error('unexpected sort coercion') } }
  const variable: Model.Expression = { kind: 'variable', id: 'x' }
  const expressions: Model.Expression[] = [
    variable,
    { kind: 'not', value: variable },
    { kind: 'negate', value: variable },
    { kind: 'eq', left: variable, right: bool(true) },
    { kind: 'if', condition: bool(true), then: variable, else: bool(true) },
  ]
  for (const sort of [Symbol('invalid'), Object.create(null), hostile]) {
    for (const expression of expressions) {
      for (const placement of ['constraints', 'softConstraints', 'objectives'] as const) {
        const model = { schema: Model.schema, variables: [{ id: 'x', sort }], constraints: [],
          [placement]: [{ id: 'check', expression, weight: '1', direction: 'minimize' }] } as unknown as Model.t
        assert.throws(() => Validate.model(model), error => {
          assert.ok(error instanceof Validate.ModelValidationError)
          assert.ok(error.problems.includes('variables[0] uses an unsupported sort'))
          assert.ok(error.message.includes(typeof sort === 'symbol' ? '<symbol>' : '<object>'))
          return true
        })
      }
    }
  }
  assert.equal(coercions, 0)
  assert.equal(Validate.model({ schema: Model.schema, variables: [{ id: 'x', sort: 'bool' }],
    constraints: [{ id: 'check', expression: variable }] }).variables, 1)
})


test('variadic expressions reject inherited operand slots and recover after dense repair', () => {
  for (const kind of ['and', 'or', 'add', 'multiply'] as const) {
    const leaf = kind === 'and' || kind === 'or' ? bool(true) : int(1)
    let reads = 0
    const inherited = Object.create(Array.prototype)
    Object.defineProperty(inherited, '0', { get() { reads++; return leaf } })
    const operands: Model.Expression[] = new Array(2)
    operands[1] = leaf
    Object.setPrototypeOf(operands, inherited)
    const expression = { kind, operands } as Model.Expression
    const model: Model.t = { schema: Model.schema, variables: [],
      ...(kind === 'and' || kind === 'or'
        ? { constraints: [{ id: 'check', expression }] }
        : { constraints: [], objectives: [{ id: 'cost', direction: 'minimize' as const, expression }] }) }
    assert.throws(() => Validate.model(model), error => {
      assert.ok(error instanceof Validate.ModelValidationError)
      assert.match(error.message, /expression.operands\[0\] must be an expression object/)
      return true
    })
    assert.equal(reads, 0)
    assert.equal(Object.hasOwn(operands, 0), false)
    Object.defineProperty(operands, '0', { value: leaf, enumerable: true, writable: true, configurable: true })
    assert.equal(Validate.model(model).expressionNodes, 3)
    assert.match(Canonical.digest(model), /^sha256:/)
    assert.equal(reads, 0)
  }
})


test('enum membership indexes are fresh after domain mutation and preserve occurrence budgets', () => {
  const values = ['', '__proto__', 'constructor', 'é', 'é']
  const literal: Model.Expression = { kind: 'literal', sort: 'enum', domain: 'Choice', value: 'é' }
  const model: Model.t = { schema: Model.schema, enums: [{ id: 'Choice', values }], variables: [],
    constraints: [{ id: 'check', expression: { kind: 'eq', left: literal, right: literal } }] }
  const before = Canonical.digest(model)
  assert.equal(Validate.model(model).enumValues, 5)
  values[3] = 'replacement'
  assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
    && error.problems.filter(problem => problem.includes('outside enum domain')).length === 2)
  values[3] = 'é'
  assert.equal(Canonical.digest(model), before)
  values.push('é')
  assert.throws(() => Validate.model(model), /contains duplicate values/)
  assert.throws(() => Validate.model(model, { maxEnumValues: 5 }), Validate.ModelLimitError)
  values.pop()
  assert.equal(Validate.model(model).expressionNodes, 3)
  assert.throws(() => Validate.model(model, { maxExpressionNodes: 2 }), Validate.ModelLimitError)
  for (const value of values) {
    const expression: Model.Expression = { kind: 'literal', sort: 'enum', domain: 'Choice', value }
    assert.equal(Validate.model({ ...model, constraints: [{ id: 'check', expression: { kind: 'eq', left: expression, right: expression } }] }).expressionNodes, 3)
  }
})


test('enum membership and duplicates use indexed entries instead of caller iterators', () => {
  let iterations = 0
  const values = ['declared']
  Object.defineProperty(values, Symbol.iterator, { value: function* () { iterations++; yield 'substitute' } })
  const input = (value: string): Model.t => {
    const literal: Model.Expression = { kind: 'literal', sort: 'enum', domain: 'Choice', value }
    return { schema: Model.schema, variables: [], enums: [{ id: 'Choice', values }],
      constraints: [{ id: 'check', expression: { kind: 'eq', left: literal, right: literal } }] }
  }
  assert.throws(() => Validate.model(input('substitute')), /outside enum domain/)
  assert.equal(Validate.model(input('declared')).enumValues, 1)
  values.push('declared')
  assert.throws(() => Validate.model(input('declared')), /contains duplicate values/)
  values[1] = 'repaired'
  assert.equal(Validate.model(input('repaired')).enumValues, 2)
  assert.equal(iterations, 0)
})


test('provenance reference validation rejects indexed duplicates without custom iteration', () => {
  for (const field of ['evidenceRowIds', 'scenarioInputIds'] as const) {
    let iterations = 0, inheritedReads = 0
    const ids = ['row', 'row']
    Object.defineProperty(ids, Symbol.iterator, { value: function* () { iterations++; yield 'row'; yield 'different' } })
    const model: Model.t = { schema: Model.schema, variables: [{ id: 'flag', sort: 'bool', [field]: ids }], constraints: [] }
    assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
      && error.problems.includes(`variables[0].${field} contains duplicate identifiers`))
    ids[1] = 'different'
    assert.equal(Validate.model(model).variables, 1)
    delete ids[0]
    const inherited = Object.create(Array.prototype)
    Object.defineProperty(inherited, '0', { get() { inheritedReads++; return 'row' } })
    Object.setPrototypeOf(ids, inherited)
    assert.throws(() => Validate.model(model), error => error instanceof Validate.ModelValidationError
      && error.problems.includes(`variables[0].${field}[0] must be a string`))
    assert.equal(inheritedReads, 0)
    assert.equal(iterations, 0)
    Object.defineProperty(ids, '0', { value: 'row', enumerable: true })
    assert.equal(Validate.model(model).variables, 1)
  }
})


test('caller array methods cannot bypass declaration or operand validation', () => {
  let calls = 0
  const override = <T>(values: T[]): T[] => {
    for (const name of ['map', 'forEach']) Object.defineProperty(values, name, {
      value: () => { calls++; return [] }, configurable: true,
    })
    return values
  }
  const base: Model.t = { schema: Model.schema, variables: [], constraints: [] }
  const malformed = [
    { ...base, variables: override([{ id: 'x', sort: 'unsupported' }]) },
    { ...base, enums: override([{ id: 'Choice', values: [] }]) },
    { ...base, constraints: override([{ id: 'check', expression: int(1) }]) },
    { ...base, softConstraints: override([{ id: 'soft', expression: bool(true), weight: '0' }]) },
    { ...base, objectives: override([{ id: 'cost', direction: 'invalid', expression: int(1) }]) },
    { ...base, variables: override([{ id: 'x', sort: 'bool' }, { id: 'x', sort: 'bool' }]) },
    { ...base, constraints: [{ id: 'check', expression: { kind: 'and', operands: override([int(1), int(2)]) } }] },
    { ...base, objectives: [{ id: 'cost', direction: 'minimize', expression: { kind: 'add', operands: override([bool(true), bool(false)]) } }] },
  ]
  for (const model of malformed) assert.throws(() => Validate.model(model as Model.t), Validate.ModelValidationError)
  assert.equal(calls, 0)
  const variables: Model.Variable[] = override([{ id: 'x', sort: 'bool' }])
  assert.equal(Validate.model({ ...base, variables }).variables, 1)
  assert.equal(calls, 0)
})


test('large malformed exact inputs use bounded diagnostic previews with original lengths', () => {
  const malformed = '9'.repeat(1_000_000) + 'x'
  const inspect = (run: () => unknown, input: string): void => {
    assert.throws(run, error => {
      assert.ok(error instanceof Error)
      assert.ok(error.message.length < 1200)
      assert.ok(error.message.includes(`${input.length} UTF-16 code units`))
      assert.ok(error.message.includes(JSON.stringify(input.slice(0, 80))))
      assert.ok(error.message.includes(JSON.stringify(input.slice(-80))))
      return true
    })
  }
  inspect(() => Exact.integer(malformed), malformed)
  inspect(() => Exact.rational(malformed), malformed)
  inspect(() => Exact.isZero(malformed), malformed)
  inspect(() => Exact.rational({ numerator: malformed, denominator: '1' }), malformed)
  inspect(() => Exact.rational({ numerator: '1', denominator: malformed }), malformed)
  const exponent = '1e' + '9'.repeat(1000)
  inspect(() => Exact.rational(exponent), exponent)
  const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: malformed, max: 1 }], constraints: [] }
  inspect(() => Validate.model(model), malformed)
  assert.equal((model.variables[0] as Extract<Model.Variable, { sort: 'int' }>).min, malformed)
  assert.throws(() => Exact.integer('12x'), { name: 'TypeError', message: 'expected an integer string, received "12x"' })
  assert.throws(() => Exact.rational('1.2x'), { name: 'TypeError', message: 'expected an exact decimal string, received "1.2x"' })
  assert.equal(Exact.integer('123'), 123n)
})


test('large model-field diagnostics share bounded escaped text previews', () => {
  const text = 'x'.repeat(1_000_000) + 'z'
  const base = { schema: Model.schema, variables: [], constraints: [] }
  const models = [
    { ...base, variables: [{ id: text, sort: 'bool' }, { id: text, sort: 'bool' }] },
    { ...base, constraints: [{ id: 'check', expression: { kind: 'variable', id: text } }] },
    { ...base, variables: [{ id: 'x', sort: 'enum', domain: text }] },
    { ...base, constraints: [{ id: 'check', expression: { kind: text } }] },
    { ...base, enums: [{ id: 'Choice', values: ['one'] }], constraints: [{ id: 'check', expression: {
      kind: 'eq', left: { kind: 'literal', sort: 'enum', domain: 'Choice', value: text },
      right: { kind: 'literal', sort: 'enum', domain: 'Choice', value: 'one' } } }] },
    { ...base, variables: [{ id: 'x', sort: text }], constraints: [{ id: 'check', expression: { kind: 'variable', id: 'x' } }] },
  ]
  for (const model of models) assert.throws(() => Validate.model(model as Model.t), error => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.ok(error.message.length < 1500)
    assert.ok(error.message.includes(`${text.length} UTF-16 code units`))
    assert.ok(error.message.includes(JSON.stringify(text.slice(0, 80))))
    assert.ok(error.message.includes(JSON.stringify(text.slice(-80))))
    return true
  })
  const escaped = '\0'.repeat(200)
  assert.throws(() => Validate.model({ ...base, constraints: [{ id: 'check', expression: { kind: escaped } }] } as unknown as Model.t), error => {
    assert.ok(error instanceof Validate.ModelValidationError)
    assert.ok(error.message.length < 1200)
    assert.equal(error.message.includes('\0'), false)
    assert.ok(error.message.includes('\\u0000'))
    return true
  })
})


test('large invalid option and limit diagnostics remain bounded before adapter calls', async () => {
  const text = 'x'.repeat(1_000_000)
  const invalid = (error: unknown): boolean => {
    assert.ok(error instanceof TypeError)
    assert.ok(error.message.length < 1200)
    assert.ok(error.message.includes('UTF-16 code units'))
    return true
  }
  assert.throws(() => Validate.mergeLimits({ [text]: 1 }), invalid)
  for (const value of [text, BigInt('9'.repeat(1000)), Symbol(text)]) {
    assert.throws(() => Validate.mergeLimits({ timeoutMs: value as unknown as number }), invalid)
  }
  let calls = 0
  const backend = { name: 'preview', version: '1' }
  const adapter: Adapter.t = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => {
    calls++
    return { status: 'satisfied', assignment: {}, backend, diagnostics: [], elapsedMs: 0 }
  } }
  const model: Model.t = { schema: Model.schema, variables: [], constraints: [] }
  await assert.rejects(Solve.run(adapter, model, { [text]: true } as Adapter.Options), invalid)
  assert.equal(calls, 0)
  assert.throws(() => Validate.mergeLimits({ wrong: 1 } as Partial<Adapter.Limits>), { message: 'unknown solver limit "wrong"' })
  assert.throws(() => Validate.mergeLimits({ timeoutMs: 'bad' as unknown as number }), { message: 'solver limit timeoutMs must be a positive safe integer, received bad' })
  await Solve.run(adapter, model)
  assert.equal(calls, 1)
})

test('declaration holes reject before inherited getters and allow own-slot repair', () => {
  const expression: Model.Expression = { kind: 'literal', sort: 'bool', value: true }
  const declarations = {
    variables: { id: 'v', sort: 'bool' },
    constraints: { id: 'c', expression },
    softConstraints: { id: 's', expression, weight: '1' },
    objectives: { id: 'o', direction: 'minimize', expression: { kind: 'literal', sort: 'int', value: '1' } },
    enums: { id: 'E', values: ['a'] }
  }
  for (const [key, declaration] of Object.entries(declarations)) {
    let reads = 0
    const prototype = Object.create(Array.prototype)
    Object.defineProperty(prototype, '0', { get() { reads++; throw new Error('inherited slot read') } })
    const entries = new Array(1)
    Object.setPrototypeOf(entries, prototype)
    const input = { schema: Model.schema, variables: [], constraints: [], [key]: entries } as Model.t
    assert.throws(() => Validate.model(input), (error: unknown) => {
      assert.ok(error instanceof Validate.ModelValidationError)
      assert.deepEqual(error.problems, [`${key}[0] must be a declaration object`])
      return true
    })
    assert.equal(reads, 0)
    assert.equal(Object.hasOwn(entries, 0), false)
    Object.defineProperty(entries, '0', { value: declaration, configurable: true, enumerable: true, writable: true })
    assert.doesNotThrow(() => Validate.model(input))
    assert.equal(reads, 0)
    assert.equal(entries[0], declaration)
  }
})
