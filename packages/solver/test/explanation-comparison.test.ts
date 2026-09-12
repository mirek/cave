import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Explain, Model } from '@cavelang/solver'

test('explanation comparisons preserve rational order across signs, zeros and shared components', () => {
  const fractions: [bigint, bigint][] = []
  for (const numerator of [-3n, 0n, 2n]) for (const denominator of [-7n, 1n, 5n]) {
    fractions.push([numerator, denominator])
  }
  const large = 10n ** 2000n + 1n
  fractions.push([large, large + 2n], [-large, large + 2n], [large, large + 4n])
  const literal = ([numerator, denominator]: [bigint, bigint]): Model.Expression => ({
    kind: 'literal', sort: 'real', value: { numerator: String(numerator), denominator: String(denominator) }
  })
  // Keep each case within the default literal budget, including the large controls.
  for (const left of fractions) for (const right of fractions) {
    const [a, b] = left, [c, d] = right
    const signedDifference = (a * d - c * b) * b * d
    const expected = [signedDifference === 0n, signedDifference !== 0n,
      signedDifference < 0n, signedDifference <= 0n, signedDifference > 0n, signedDifference >= 0n]
    const kinds = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const
    const model: Model.t = { schema: Model.schema, variables: [], constraints: kinds.map(kind => ({
      id: kind, expression: { kind, left: literal(left), right: literal(right) }
    })) }
    const report = Explain.report(model, { status: 'satisfied', assignment: {},
      backend: { name: 'comparison fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible report')
    assert.deepEqual(report.outcome.hardConstraints.map(constraint => constraint.evaluation),
      expected.map(value => value ? 'satisfied' : 'violated'))
  }
})
