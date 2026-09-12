import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Adapter, Explain, Linear, Model } from '@cavelang/solver'

test('constant rational sums preserve exact cancellation across uneven groups and orderings', () => {
  for (const count of [1, 2, 3, 5, 17, 64, 65]) {
    let numerator = 0n, denominator = 1n
    const terms: Model.Expression[] = []
    for (let index = 0; index < count; index++) {
      const n = BigInt(index % 2 === 0 ? index + 1 : -index - 1), d = BigInt(index + 2)
      numerator = numerator * d + n * denominator
      denominator *= d
      terms.push({ kind: 'literal', sort: 'real', value: { numerator: String(n), denominator: String(d) } })
    }
    const inverse: Model.Expression = { kind: 'literal', sort: 'real', value: {
      numerator: String(-numerator), denominator: String(denominator)
    } }
    for (const operands of [[...terms, inverse], [inverse, ...terms.toReversed()]]) {
      for (const offset of [0, 1]) {
        const input: Model.t = {
          schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
          objectives: [{ id: 'ratio', direction: 'minimize', expression: {
            kind: 'divide', left: { kind: 'variable', id: 'x' }, right: {
              kind: 'add', operands: [...operands, { kind: 'literal', sort: 'real', value: String(offset) }]
            }
          } }]
        }
        assert.equal(Linear.model(input).linear, offset !== 0, `count=${count}, offset=${offset}`)
        const report = Explain.report({ schema: Model.schema, variables: [], constraints: [{
          id: 'cancellation', expression: { kind: 'eq',
            left: { kind: 'add', operands: [...operands, { kind: 'literal', sort: 'real', value: String(offset) }] },
            right: { kind: 'literal', sort: 'real', value: String(offset) }
          }
        }] }, { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' },
          diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
        assert.equal(report.outcome.status, 'satisfied')
        if (report.outcome.status !== 'satisfied') assert.fail('expected a satisfied report')
        assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied')
      }
    }
  }
})
