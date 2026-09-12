import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Exact, Explain, Linear, Model } from '@cavelang/solver'
import { sum } from '../src/fraction-sum.ts'

const n = 10n ** 400n + 1n
let f = 0n, g = 1n
for (let i = 0; i < 2000; i++) [f, g] = [g, f + g]
const denominators: readonly (readonly [bigint, bigint])[] = [
  [3n, 5n], [3n * n, 5n * n], [-3n * n, 5n * n],
  [13n * n, 21n * n], [-13n * n, 21n * n], [21n * n, 13n * n], [13n * n, -21n * n],
  [n, n + 2n], [f, g], [n, n], [n, 1n]
]
const literal = (numerator: bigint, denominator: bigint): Model.Expression => ({
  kind: 'literal', sort: 'real', value: { numerator: String(numerator), denominator: String(denominator) }
})

for (const kind of ['add', 'subtract'] as const) test(`fraction ${kind} preserves exact values and zero-divisor classification`, () => {
  for (const [b, d] of denominators) for (const a of [-5n, -1n, 0n, 1n, 5n]) for (const c of [-5n, -1n, 0n, 1n, 5n]) {
    const signedC = kind === 'add' ? c : -c
    const expected = Exact.rational({ numerator: String(a * d + signedC * b), denominator: String(b * d) })
    const [numerator, denominator] = sum(a, b, signedC, d)
    assert.deepEqual(Exact.rational({ numerator: String(numerator), denominator: String(denominator) }), expected)
    const expression: Model.Expression = kind === 'add'
      ? { kind: 'add', operands: [literal(a, b), literal(c, d)] }
      : { kind: 'subtract', left: literal(a, b), right: literal(c, d) }
    const model: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'identity', expression: {
      kind: 'eq', left: expression, right: { kind: 'literal', sort: 'real', value: expected }
    } }] }
    const report = Explain.report(model, {
      status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0
    }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible explanation')
    assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'satisfied')
    assert.equal(Linear.model({ schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
      objectives: [{ id: 'ratio', direction: 'minimize', expression: {
        kind: 'divide', left: { kind: 'variable', id: 'x' }, right: expression
      } }]
    }).linear, expected.numerator !== '0')
  }
})

test('explanation integer additions preserve exact reduced values in either order', () => {
  for (const numerator of [-3n, 0n, 3n]) for (const denominator of [1n, 2n, 5n]) for (const integer of [-4n, 0n, 4n]) {
    const ref: Model.Expression = { kind: 'variable', id: 'x' }
    const whole = literal(integer, 1n)
    const expected = literal(numerator + integer * denominator, denominator)
    const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [
      { id: 'left', expression: { kind: 'eq', left: { kind: 'add', operands: [ref, whole] }, right: expected } },
      { id: 'right', expression: { kind: 'eq', left: { kind: 'add', operands: [whole, ref] }, right: expected } },
      { id: 'cancel', expression: { kind: 'eq', left: { kind: 'add', operands: [ref, { kind: 'negate', value: ref }] }, right: literal(0n, 1n) } }
    ] }
    const result = Explain.report(model, { status: 'satisfied', assignment: {
      x: { sort: 'real', numerator: String(numerator * 3n), denominator: String(denominator * 3n) }
    }, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    if (result.outcome.status !== 'satisfied') assert.fail('expected feasible report')
    assert.deepEqual(result.outcome.hardConstraints.map(value => value.evaluation), ['satisfied', 'satisfied', 'satisfied'])
  }
})


test('short common-factor probes avoid squaring delayed shared denominator factors', () => {
  for (const [left, right] of [[13n, 21n], [21n, 13n]]) {
    const [numerator, denominator] = sum(1n, left! * n, 1n, right! * n)
    assert.ok(denominator <= 273n * n, 'shared factor must occur only once in the intermediate denominator')
    assert.deepEqual(Exact.fromBigInts(numerator, denominator), Exact.fromBigInts(34n, 273n * n))
  }
})
