import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Adapter, Explain, Linear, Model } from '@cavelang/solver'

const literal = (value: number | string): Model.Expression => ({ kind: 'literal', sort: 'real', value: String(value) })
const withDivisor = (right: Model.Expression): Model.t => ({
  schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
  objectives: [{ id: 'ratio', direction: 'minimize', expression: { kind: 'divide', left: { kind: 'variable', id: 'x' }, right } }]
})

test('constant sign classification preserves arithmetic and ambiguous cancellation', () => {
  for (const a of [-2, -1, 0, 1, 2]) for (const b of [-2, -1, 0, 1, 2]) {
    const cases: [Model.Expression, number][] = [
      [{ kind: 'add', operands: [literal(a), literal(b)] }, a + b],
      [{ kind: 'subtract', left: literal(a), right: literal(b) }, a - b],
      [{ kind: 'multiply', operands: [literal(a), literal(b)] }, a * b],
    ]
    if (b !== 0) cases.push([{ kind: 'divide', left: literal(a), right: literal(b) }, a / b])
    for (const [expression, value] of cases) {
      assert.equal(Linear.model(withDivisor(expression)).linear, value !== 0)
      assert.equal(Linear.model(withDivisor({ kind: 'negate', value: expression })).linear, value !== 0)
    }
  }
})

test('sign proofs retain tiny constants and do not conceal undefined subexpressions', () => {
  for (const sign of ['', '-']) {
    const sum: Model.Expression = { kind: 'add', operands: [literal(`${sign}1e-400`), literal(`${sign}1e400`)] }
    assert.equal(Linear.model(withDivisor(sum)).linear, true)
    const zero: Model.Expression = { kind: 'subtract', left: literal(1), right: literal(1) }
    assert.equal(Linear.model(withDivisor({ kind: 'multiply', operands: [sum, zero] })).linear, false)
    const undefinedValue: Model.Expression = { kind: 'divide', left: literal(1), right: zero }
    assert.equal(Linear.model(withDivisor({ kind: 'multiply', operands: [zero, undefinedValue] })).linear, false)
  }
})

const reported = (expressions: Model.Expression[], variables: Model.Variable[] = []): Explain.Constraint[] => {
  const report = Explain.report({ schema: Model.schema, variables,
    constraints: expressions.map((expression, index) => ({ id: `c${index}`, expression })) },
  { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, elapsedMs: 0, diagnostics: [] }, Adapter.defaultLimits)
  assert.equal(report.outcome.status, 'satisfied')
  if (report.outcome.status !== 'satisfied') throw new Error('unexpected status')
  return [...report.outcome.hardConstraints]
}

test('constant sign comparisons match independent small arithmetic in both orientations', () => {
  for (const a of [-2, -1, 0, 1, 2]) for (const b of [-2, -1, 0, 1, 2]) {
    const cases: [Model.Expression, number][] = [
      [{ kind: 'add', operands: [literal(a), literal(b)] }, a + b],
      [{ kind: 'subtract', left: literal(a), right: literal(b) }, a - b],
      [{ kind: 'multiply', operands: [literal(a), literal(b)] }, a * b]
    ]
    if (b !== 0) cases.push([{ kind: 'divide', left: literal(a), right: literal(b) }, a / b])
    for (const [expression, value] of cases) for (const reverse of [false, true]) {
      const order = reverse ? -value : value
      const expected = [order === 0, order !== 0, order < 0, order <= 0, order > 0, order >= 0]
      const expressions = (['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const).map(kind => ({ kind,
        left: reverse ? literal(0) : expression, right: reverse ? expression : literal(0) }))
      assert.deepEqual(reported(expressions).map(value => value.evaluation), expected.map(value => value ? 'satisfied' : 'violated'))
    }
  }
})

test('zero sign proofs preserve undefined arithmetic, missing assignments and Boolean laziness', () => {
  const zero: Model.Expression = { kind: 'subtract', left: literal(1), right: literal(1) }
  const bad: Model.Expression[] = [
    { kind: 'divide', left: literal(1), right: zero },
    { kind: 'variable', id: 'x' }
  ]
  for (const value of bad) for (const operands of [[literal(0), value], [value, literal(0)]]) {
    const comparison: Model.Expression = { kind: 'eq', left: { kind: 'multiply', operands }, right: literal(0) }
    const results = reported([comparison, { kind: 'or', operands: [{ kind: 'literal', sort: 'bool', value: true }, comparison] }], [{ id: 'x', sort: 'real' }])
    assert.equal(results[0]!.evaluation, 'indeterminate')
    assert.match(results[0]!.evaluationReason!, value.kind === 'divide' ? /division by zero/ : /assignment omits/)
    assert.equal(results[1]!.evaluation, 'satisfied')
  }
})

test('constant sign comparison retains values outside floating point range', () => {
  for (const sign of ['', '-']) {
    const expression: Model.Expression = { kind: 'add', operands: [literal(`${sign}1e-400`), literal(`${sign}1e400`)] }
    assert.equal(reported([{ kind: sign ? 'lt' : 'gt', left: expression, right: literal(0) }])[0]!.evaluation, 'satisfied')
  }
})
