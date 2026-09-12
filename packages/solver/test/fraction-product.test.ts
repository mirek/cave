import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Exact, Explain, Linear, Model } from '@cavelang/solver'

const literal = (numerator: bigint, denominator: bigint): Model.Expression => ({
  kind: 'literal', sort: 'real', value: { numerator: String(numerator), denominator: String(denominator) }
})

for (const kind of ['multiply', 'divide'] as const) test(`fraction ${kind} preserves signs, cancellation and undefined arithmetic`, () => {
  const cases: bigint[][] = []
  for (const a of [-3n, 0n, 2n]) for (const b of [-5n, 1n, 7n]) {
    for (const c of [-2n, 0n, 3n]) for (const d of [-7n, 1n, 5n]) cases.push([a, b, c, d])
  }
  const n = 10n ** 2000n + 1n, m = n + 2n
  cases.push(kind === 'multiply' ? [m, n, n, m] : [m, n, m, n])
  for (const [a, b, c, d] of cases as [bigint, bigint, bigint, bigint][]) {
    // A computed zero divisor is permitted in portable SMT models; explanations
    // keep such a backend result usable with indeterminate local arithmetic.
    const right: Model.Expression = { kind: 'add', operands: [literal(c, d), literal(0n, 1n)] }
    const expression: Model.Expression = kind === 'multiply'
      ? { kind, operands: [literal(a, b), right] } : { kind, left: literal(a, b), right }
    const undefinedResult = kind === 'divide' && c === 0n
    const expected = undefinedResult ? { numerator: '0', denominator: '1' } : Exact.rational({
      numerator: String(kind === 'multiply' ? a * c : a * d),
      denominator: String(kind === 'multiply' ? b * d : b * c)
    })
    const model: Model.t = {
      schema: Model.schema, variables: [], constraints: [{ id: 'identity', expression: {
        kind: 'eq', left: expression, right: { kind: 'literal', sort: 'real', value: expected }
      } }]
    }
    const report = Explain.report(model, { status: 'satisfied', assignment: {},
      backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible report')
    assert.equal(report.outcome.hardConstraints[0]!.evaluation, undefinedResult ? 'indeterminate' : 'satisfied')
    const linear: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
      objectives: [{ id: 'ratio', direction: 'minimize', expression: {
        kind: 'divide', left: { kind: 'variable', id: 'x' }, right: expression
      } }] }
    assert.equal(Linear.model(linear).linear, !undefinedResult && expected.numerator !== '0')
  }
})

test('linear product chains retain exact signed and zero constants', () => {
  for (const factors of [2, 10, 18]) for (const sign of [-1n, 0n, 1n]) {
    const pairs = Array.from({ length: factors }, (_, index) => [index === 0 ? sign : BigInt(index + 2), BigInt(index + 3)] as const)
    const numerator = pairs.reduce((value, pair) => value * pair[0], 1n)
    const denominator = pairs.reduce((value, pair) => value * pair[1], 1n)
    const chain: Model.Expression = { kind: 'multiply', operands: pairs.map(([n, d]) => literal(n, d)) }
    for (const offset of [0n, 1n]) {
      const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
        objectives: [{ id: 'ratio', direction: 'minimize', expression: {
          kind: 'divide', left: { kind: 'variable', id: 'x' }, right: {
            kind: 'subtract', left: chain, right: literal(numerator + offset * denominator, denominator)
          }
        } }] }
      assert.equal(Linear.model(model).linear, offset !== 0n, `factors=${factors}, sign=${sign}, offset=${offset}`)
    }
  }
})

test('explanation shared squares preserve normalized assigned fractions', () => {
  for (const numerator of [-3n, 0n, 3n]) for (const depth of [1, 4, 8]) {
    let expression: Model.Expression = { kind: 'variable', id: 'x' }
    for (let level = 0; level < depth; level++) expression = { kind: 'multiply', operands: [expression, expression] }
    const power = 2n ** BigInt(depth)
    const expected = literal(numerator ** power, 2n ** power)
    const model: Model.t = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
      constraints: [{ id: 'square', expression: { kind: 'eq', left: expression, right: expected } }] }
    const result = Explain.report(model, { status: 'satisfied', assignment: {
      x: { sort: 'real', numerator: String(numerator * 2n), denominator: '4' }
    }, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    assert.equal(result.outcome.status, 'satisfied')
    if (result.outcome.status !== 'satisfied') assert.fail('expected feasible report')
    assert.equal(result.outcome.hardConstraints[0]!.evaluation, 'satisfied')
  }
})

test('explanation negation and division preserve reduced signs and zero diagnostics', () => {
  for (const numerator of [-3n, 0n, 3n]) {
    const ref: Model.Expression = { kind: 'variable', id: 'x' }
    const negated: Model.Expression = { kind: 'negate', value: ref }
    const expressions: Model.Expression[] = [
      { kind: 'eq', left: negated, right: literal(-numerator, 2n) },
      { kind: 'eq', left: { kind: 'negate', value: negated }, right: ref },
      { kind: 'eq', left: { kind: 'divide', left: ref, right: literal(-2n, 3n) }, right: literal(-3n * numerator, 4n) },
      { kind: 'eq', left: { kind: 'subtract', left: ref, right: negated }, right: literal(numerator, 1n) },
      { kind: 'eq', left: { kind: 'divide', left: ref, right: { kind: 'subtract', left: ref, right: ref } }, right: literal(0n, 1n) }
    ]
    const result = Explain.report({ schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
      constraints: expressions.map((expression, index) => ({ id: `c${index}`, expression }))
    }, { status: 'satisfied', assignment: { x: { sort: 'real', numerator: String(numerator * 2n), denominator: '4' } },
      backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    if (result.outcome.status !== 'satisfied') assert.fail('expected feasible report')
    assert.deepEqual(result.outcome.hardConstraints.map(value => value.evaluation),
      ['satisfied', 'satisfied', 'satisfied', 'satisfied', 'indeterminate'])
    assert.match(result.outcome.hardConstraints[4]!.evaluationReason!, /division by zero/)
  }
})

test('explanation n-ary products preserve exact values across balanced pair boundaries', () => {
  for (const count of [2, 3, 17, 64]) for (const sign of [-1n, 0n, 1n]) {
    const pairs = Array.from({ length: count }, (_, index) =>
      [index === 0 ? sign : BigInt(index + 2), BigInt(index + 3)] as const)
    const numerator = pairs.reduce((value, [n]) => value * n, 1n)
    const denominator = pairs.reduce((value, [, d]) => value * d, 1n)
    const model: Model.t = { schema: Model.schema, variables: [], constraints: [0n, 1n].map(offset => ({
      id: `offset-${offset}`, expression: { kind: 'eq',
        left: { kind: 'multiply', operands: pairs.map(([n, d]) => literal(n, d)) },
        right: literal(numerator + offset * denominator, denominator) }
    })) }
    const report = Explain.report(model, { status: 'satisfied', assignment: {},
      backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    assert.equal(report.outcome.status, 'satisfied')
    if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible report')
    assert.deepEqual(report.outcome.hardConstraints.map(row => row.evaluation), ['satisfied', 'violated'])
  }
  for (const zeroIndex of [0, 2, 4]) {
    const operands: Model.Expression[] = Array.from({ length: 5 }, () => literal(2n, 3n))
    operands[zeroIndex] = literal(0n, 1n)
    operands.push({ kind: 'divide', left: literal(1n, 1n),
      right: { kind: 'subtract', left: literal(1n, 1n), right: literal(1n, 1n) } })
    const model: Model.t = { schema: Model.schema, variables: [], constraints: [{ id: 'undefined',
      expression: { kind: 'eq', left: { kind: 'multiply', operands }, right: literal(0n, 1n) } }] }
    const report = Explain.report(model, { status: 'satisfied', assignment: {},
      backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }, Adapter.defaultLimits)
    if (report.outcome.status !== 'satisfied') assert.fail('expected a feasible report')
    assert.equal(report.outcome.hardConstraints[0]!.evaluation, 'indeterminate')
    assert.match(report.outcome.hardConstraints[0]!.evaluationReason!, /division by zero/)
  }
})
