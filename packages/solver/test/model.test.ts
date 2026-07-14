import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Canonical, Capability, Exact, Linear, Model, Solve, Validate } from '@cavelang/solver'

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

test('rejects unsupported expression kinds before solving', () => {
  const invalid = {
    schema: Model.schema,
    variables: [],
    constraints: [{ id: 'unsupported', expression: { kind: 'quantifier' } }]
  } as unknown as Model.t
  assert.throws(() => Validate.model(invalid), /unsupported expression kind "quantifier"/)
})

test('canonical digest ignores declaration order and labels but preserves objective order', () => {
  const original = fixture()
  const reordered: Model.t = {
    ...original,
    enums: original.enums?.map(domain => ({ ...domain, values: [...domain.values].reverse(), description: 'label changed' })),
    variables: [...original.variables].reverse().map(variable => ({ ...variable, description: 'label changed' })),
    constraints: [...original.constraints].reverse().map(constraint => ({ ...constraint, description: 'label changed', evidenceRowIds: ['new-row'] })),
    softConstraints: original.softConstraints?.map(constraint => ({ ...constraint, weight: { numerator: 5, denominator: 2 } }))
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
