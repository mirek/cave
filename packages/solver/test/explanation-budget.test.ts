import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Adapter, Explain, Model, Validate } from '@cavelang/solver'

const literal = (value: string): Model.Expression => ({ kind: 'literal', sort: 'real', value })
const variable: Model.Expression = { kind: 'variable', id: 'x' }
const result: Adapter.Result = { status: 'satisfied', assignment: { x: { sort: 'real', numerator: '3', denominator: '2' } },
  backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
const fixture = (expression: Model.Expression): Model.t => ({ schema: Model.schema,
  variables: [{ id: 'x', sort: 'real' }], constraints: [
    { id: 'growth', expression: { kind: 'gt', left: expression, right: literal('1') } },
    { id: 'small', expression: { kind: 'gt', left: variable, right: literal('1') } }
  ] })

test('explanation growth is locally indeterminate and recovers with a larger budget', () => {
  let expression: Model.Expression = variable
  for (let depth = 0; depth < 6; depth++) expression = { kind: 'multiply', operands: [expression, expression] }
  const model = fixture(expression)
  const before = JSON.stringify({ model, result })
  assert.doesNotThrow(() => Validate.model(model, { maxExplanationBits: 64 }))
  const report = Explain.report(model, result, { ...Adapter.defaultLimits, maxExplanationBits: 64 })
  if (report.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
  assert.deepEqual(report.outcome.hardConstraints.map(row => row.evaluation), ['indeterminate', 'satisfied'])
  assert.match(report.outcome.hardConstraints[0]!.evaluationReason!, /maxExplanationBits/)
  assert.equal(report.run.limits.maxExplanationBits, 64)
  const recovered = Explain.report(model, result, { ...Adapter.defaultLimits, maxExplanationBits: 1024 })
  if (recovered.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
  assert.deepEqual(recovered.outcome.hardConstraints.map(row => row.evaluation), ['satisfied', 'satisfied'])
  assert.equal(JSON.stringify({ model, result }), before)
})

test('explanation budget checks assignment text before normalization and leaves skipped branches unevaluated', () => {
  const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [
    { id: 'large', expression: { kind: 'eq', left: variable, right: literal('1') } },
    { id: 'skipped', expression: { kind: 'or', operands: [{ kind: 'literal', sort: 'bool', value: true },
      { kind: 'eq', left: variable, right: literal('1') }] } }
  ] }
  const large: Adapter.Result = { ...result, assignment: { x: { sort: 'real', numerator: '9'.repeat(10000), denominator: '1' } } }
  const report = Explain.report(model, large, { ...Adapter.defaultLimits, maxExplanationBits: 64 })
  if (report.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
  assert.deepEqual(report.outcome.hardConstraints.map(row => row.evaluation), ['indeterminate', 'satisfied'])
  assert.match(report.outcome.hardConstraints[0]!.evaluationReason!, /estimated 40004 > 64/)
})

test('explanation limit values are validated before report construction', () => {
  for (const maximum of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => Explain.report(fixture(variable), result, { ...Adapter.defaultLimits, maxExplanationBits: maximum }), /maxExplanationBits must be a positive safe integer/)
  }
})

for (const operation of ['add', 'divide', 'compare'] as const) {
  test(`explanation budget preflights ${operation} intermediates and preserves soft constraints`, () => {
    const power = (id: string): Model.Expression => ({ kind: 'multiply',
      operands: Array.from({ length: 24 }, () => ({ kind: 'variable', id })) })
    const left = power('x'), right = power('y')
    const expression: Model.Expression = operation === 'compare' ? { kind: 'gt', left, right }
      : { kind: 'gt', left: operation === 'add' ? { kind: 'add', operands: [left, right] }
        : { kind: 'divide', left, right }, right: literal('1') }
    const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }, { id: 'y', sort: 'real' }],
      constraints: [{ id: 'hard', expression }], softConstraints: [{ id: 'soft', expression, weight: '1' }] }
    const assigned: Adapter.Result = { ...result, assignment: {
      x: { sort: 'real', numerator: '3', denominator: '2' }, y: { sort: 'real', numerator: '5', denominator: '3' }
    } }
    for (const maximum of [64, 1024]) {
      const report = Explain.report(model, assigned, { ...Adapter.defaultLimits, maxExplanationBits: maximum })
      if (report.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
      assert.equal(report.outcome.hardConstraints[0]!.evaluation,
        maximum === 64 ? 'indeterminate' : operation === 'add' ? 'satisfied' : 'violated')
      assert.equal(report.outcome.softConstraints[0]!.evaluation,
        maximum === 64 ? 'indeterminate' : operation === 'add' ? 'accepted' : 'violated')
      if (maximum === 64) assert.match(report.outcome.hardConstraints[0]!.evaluationReason!, /maxExplanationBits/)
    }
  })
}

test('default explanation budget stops shared growth accepted by model input limits', () => {
  let expression: Model.Expression = variable
  for (let depth = 0; depth < 14; depth++) expression = { kind: 'multiply', operands: [expression, expression] }
  const model = fixture(expression)
  assert.doesNotThrow(() => Validate.model(model))
  const assigned: Adapter.Result = { ...result, assignment: { x: { sort: 'real',
    numerator: String(10n ** 50n + 1n), denominator: String(10n ** 50n) } } }
  for (const maxExplanationWork of [Adapter.defaultLimits.maxExplanationWork, Number.MAX_SAFE_INTEGER]) {
    const report = Explain.report(model, assigned, { ...Adapter.defaultLimits, maxExplanationWork })
    if (report.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
    assert.deepEqual(report.outcome.hardConstraints.map(row => row.evaluation), ['indeterminate', 'satisfied'])
    assert.match(report.outcome.hardConstraints[0]!.evaluationReason!,
      maxExplanationWork === Number.MAX_SAFE_INTEGER ? /maxExplanationBits/ : /maxExplanationWork/)
  }
})

test('decimal explanation preflight preserves zero and recovers with a larger budget', () => {
  const texts = ['1e1000', '1e-1000', '1000.0e-1003', '0e9007199254740991', '-0e-9007199254740991']
  const model: Model.t = { schema: Model.schema, variables: [], constraints: texts.map((value, index) => ({
    id: `decimal-${index}`, expression: { kind: index < 3 ? 'gt' : 'eq', left: literal(value), right: literal('0') }
  })) }
  assert.doesNotThrow(() => Validate.model(model))
  for (const maximum of [64, 20000]) {
    const report = Explain.report(model, { ...result, assignment: {} }, { ...Adapter.defaultLimits, maxExplanationBits: maximum })
    if (report.outcome.status !== 'satisfied') assert.fail('expected the backend status to be retained')
    assert.deepEqual(report.outcome.hardConstraints.map(row => row.evaluation), maximum === 64
      ? ['indeterminate', 'indeterminate', 'indeterminate', 'satisfied', 'satisfied']
      : ['satisfied', 'satisfied', 'satisfied', 'satisfied', 'satisfied'])
    if (maximum === 64) for (const row of report.outcome.hardConstraints.slice(0, 3)) assert.match(row.evaluationReason!, /maxExplanationBits/)
  }
})

test('cumulative explanation work is report-scoped and preserves cheap or reused evaluations', () => {
  const power = (): Model.Expression => ({ kind: 'multiply', operands: Array.from({ length: 32 }, () => ({ ...variable })) })
  const constraints = Array.from({ length: 32 }, (_, index) => ({ id: `positive-${index}`,
    expression: { kind: 'gt', left: power(), right: literal(String(-index)) } as Model.Expression }))
  const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
    constraints: [...constraints,
      { id: 'cheap', expression: { kind: 'literal', sort: 'bool', value: true } },
      { id: 'reused', expression: structuredClone(constraints[0]!.expression) }],
    softConstraints: [{ id: 'preference', expression: structuredClone(constraints[0]!.expression), weight: '2' }] }
  const before = JSON.stringify({ model, result })
  const limits = { ...Adapter.defaultLimits, maxExplanationWork: 1000 }
  const report = Explain.report(model, result, limits)
  if (report.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
  const limited = report.outcome.hardConstraints.slice(0, 32)
  assert.equal(limited[0]!.evaluation, 'satisfied')
  assert.ok(limited.some(row => row.evaluation === 'indeterminate'))
  for (const row of limited) if (row.evaluation === 'indeterminate') assert.match(row.evaluationReason!, /maxExplanationWork/)
  assert.ok(report.outcome.hardConstraints.slice(32).every(row => row.evaluation === 'satisfied'))
  assert.equal(report.outcome.softConstraints[0]!.evaluation, 'accepted')
  assert.equal(report.run.limits.maxExplanationWork, 1000)
  const recovered = Explain.report(model, result, { ...limits, maxExplanationWork: 1000000 })
  if (recovered.outcome.status !== 'satisfied') assert.fail('backend status must remain satisfied')
  assert.ok(recovered.outcome.hardConstraints.every(row => row.evaluation === 'satisfied'))
  assert.equal(recovered.run.modelDigest, report.run.modelDigest)
  assert.deepEqual(Explain.report(model, result, limits), report)
  assert.equal(JSON.stringify({ model, result }), before)
})

test('cumulative explanation allowance rejects invalid values before report construction', () => {
  for (const maximum of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Explain.report(fixture(variable), result, { ...Adapter.defaultLimits, maxExplanationWork: maximum }),
      /maxExplanationWork must be a positive safe integer/)
  }
})
