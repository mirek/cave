import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Exact, Explain, Linear, Model } from '@cavelang/solver'

const denominator = `1${'0'.repeat(199)}1`
const fraction = (numerator: number): Model.Rational => ({ numerator, denominator })
const literal = (numerator: number): Model.Expression => ({ kind: 'literal', sort: 'real', value: fraction(numerator) })

for (const operation of ['add', 'subtract'] as const) test(`equal-denominator ${operation} preserves signed arithmetic and zero detection`, () => {
  for (const left of [-3, -1, 0, 1, 3]) for (const right of [-3, -1, 0, 1, 3]) {
    const expected = operation === 'add' ? left + right : left - right
    assert.equal(Exact.compare(fraction(left), fraction(right)), left < right ? -1 : left > right ? 1 : 0)
    const expression: Model.Expression = operation === 'add'
      ? { kind: 'add', operands: [literal(left), literal(right)] }
      : { kind: 'subtract', left: literal(left), right: literal(right) }
    const linear: Model.t = {
      schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
      objectives: [{ id: 'ratio', direction: 'minimize', expression: {
        kind: 'divide', left: { kind: 'variable', id: 'x' }, right: expression
      } }]
    }
    assert.equal(Linear.model(linear).linear, expected !== 0, `${left} ${operation} ${right}`)
    const model: Model.t = {
      schema: Model.schema, variables: [],
      constraints: [{ id: 'identity', expression: { kind: 'eq', left: expression, right: literal(expected) } }]
    }
    const report = Explain.report(model, {
      status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0
    }, Adapter.defaultLimits)
    assert.equal(report.outcome.status, 'satisfied')
    if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible explanation')
    assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied', `${left} ${operation} ${right}`)
  }
})
