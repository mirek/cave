import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, compare, convert, parse } from '../src/exact.ts'

const fraction = (numerator: string, denominator: string) => ({ numerator, denominator })

test('scenario decimal suffixes preserve multipliers, approximation and exact conversions', () => {
  for (const length of [0, 1, 1000, 100000]) {
    const zeros = '0'.repeat(length)
    assert.deepEqual(parse(`+001.25${zeros}M USD`, 'budget'), {
      exact: fraction('1250000', '1'), unit: 'USD', approximate: false
    })
    const latency = parse(`~-0.125${zeros}ms`, 'latency')
    assert.deepEqual(latency, { exact: fraction('-1', '8'), unit: 'ms', approximate: true })
    assert.deepEqual(convert(latency, 's', [{ from: 'ms', to: 's', factor: '0.001' }], 'latency'), {
      exact: fraction('-1', '8000'), unit: 's', approximate: true
    })
    assert.deepEqual(parse(`0.00${zeros}%`, 'ratio'), {
      exact: fraction('0', '1'), unit: '%', approximate: false
    })
  }
})

test('scenario exact arithmetic retains cancellation, signs and unequal denominators', () => {
  for (const [left, right, sum, order] of [
    [fraction('1', '4'), fraction('3', '4'), fraction('1', '1'), -1],
    [fraction('-3', '4'), fraction('3', '4'), fraction('0', '1'), -1],
    [fraction('-3', '4'), fraction('-1', '4'), fraction('-1', '1'), -1],
    [fraction('1', '3'), fraction('1', '6'), fraction('1', '2'), 1],
    [fraction('2', '3'), fraction('4', '6'), fraction('4', '3'), 0]
  ] as const) {
    assert.deepEqual(add(left, right), sum)
    assert.deepEqual(add(right, left), sum)
    assert.equal(compare(left, right), order)
    assert.equal(compare(right, left), order === 0 ? 0 : -order)
  }
})

test('scenario arithmetic preserves differences below floating-point precision', () => {
  const denominator = 10n ** 4000n
  const left = fraction(String(denominator - 1n), String(denominator))
  const right = fraction(String(denominator - 3n), String(denominator))
  assert.equal(compare(left, right), 1)
  assert.equal(compare(right, left), -1)
  assert.equal(compare(left, left), 0)
  assert.deepEqual(add(left, right), fraction(String(denominator / 2n - 1n), String(denominator / 4n)))
})

test('scenario comparison respects negative denominator orientation', () => {
  for (const [left, right, order] of [
    [fraction('1', '-2'), fraction('0', '1'), -1],
    [fraction('1', '2'), fraction('1', '-3'), 1],
    [fraction('1', '-2'), fraction('1', '-3'), -1],
    [fraction('-1', '-2'), fraction('1', '2'), 0],
    [fraction('1', '-2'), fraction('3', '-2'), 1],
  ] as const) {
    assert.equal(compare(left, right), order)
    assert.equal(compare(right, left), order === 0 ? 0 : -order)
  }
})

test('scenario comparison shortcuts agree with cross-products across denominator signs', () => {
  const values: { exact: ReturnType<typeof fraction>, numerator: bigint, denominator: bigint }[] = []
  for (let numerator = -6; numerator <= 6; numerator++) {
    for (let denominator = -5; denominator <= 5; denominator++) {
      if (denominator !== 0) values.push({ exact: fraction(String(numerator), String(denominator)),
        numerator: BigInt(numerator), denominator: BigInt(denominator) })
    }
  }
  for (const left of values) for (const right of values) {
    const difference = left.numerator * right.denominator - right.numerator * left.denominator
    const oriented = left.denominator * right.denominator < 0n ? -difference : difference
    const expected = oriented === 0n ? 0 : oriented < 0n ? -1 : 1
    assert.equal(compare(left.exact, right.exact), expected,
      `${JSON.stringify(left.exact)} versus ${JSON.stringify(right.exact)}`)
  }
})

test('scenario reinforcing fraction orders remain exact for large signed values', () => {
  const n = 10n ** 4000n
  for (const sign of [1n, -1n]) {
    const left = fraction(String(sign * (n + 1n)), String(n + 7n))
    const right = fraction(String(sign * (n + 4n)), String(n + 3n))
    assert.equal(compare(left, right), -Number(sign))
    assert.equal(compare(right, left), Number(sign))
  }
})
