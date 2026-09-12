import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Exact } from '@cavelang/solver'

test('zero detection validates rational fields without parsing large magnitudes', t => {
  const large = '1' + '0'.repeat(100_000) + '7'
  const bigint = globalThis.BigInt
  let largeParses = 0
  t.mock.method(globalThis, 'BigInt', (value: Parameters<typeof BigInt>[0]) => {
    if (typeof value === 'string' && value.length > 100_000) largeParses++
    return bigint(value)
  })
  for (const numerator of [large, `-${large}`, 0, '-000']) {
    for (const denominator of [large, `-${large}`, 1, -1]) {
      assert.equal(Exact.isZero({ numerator, denominator }), numerator === 0 || numerator === '-000')
    }
    for (const denominator of ['0', '-000', '', '1\n', '1e2', '1.0', NaN, Infinity]) {
      assert.throws(() => Exact.isZero({ numerator, denominator }), TypeError)
    }
  }
  assert.equal(largeParses, 0)
  let numerators = 0, denominators = 0
  assert.equal(Exact.isZero({
    get numerator() { numerators++; return '1' },
    get denominator() { denominators++; return '7' }
  }), false)
  assert.deepEqual([numerators, denominators], [1, 1])
  assert.throws(() => Exact.isZero({
    numerator: '1\n', get denominator() { denominators++; return '7' }
  }), /integer string/)
  assert.equal(denominators, 1, 'invalid numerator fails before the denominator getter')
})

test('decimal zero detection validates exponents without expanding their magnitude', () => {
  for (const coefficient of ['0', '-000.00', '+.000', '1', '-.001', '+001.2300']) {
    for (const exponent of ['-100', '0', '+100']) {
      const input = `${coefficient}e${exponent}`
      assert.equal(Exact.isZero(input), Exact.rational(input).numerator === '0')
    }
    for (const exponent of ['9007199254740991', '-9007199254740991']) {
      assert.equal(Exact.isZero(`${coefficient}e${exponent}`), !/[1-9]/.test(coefficient))
    }
    for (const exponent of ['9007199254740992', '-9007199254740992', '1.5', 'NaN', '']) {
      assert.throws(() => Exact.isZero(`${coefficient}e${exponent}`), TypeError)
    }
  }
  for (const input of ['', '1\n', ' 0', '0x0', '.', 'NaN', 'Infinity']) assert.throws(() => Exact.isZero(input), TypeError)
})

test('canonical integer comparisons avoid reparsing large decimal magnitudes', t => {
  const large = '9'.repeat(100_000), smaller = '8'.repeat(100_000)
  const bigint = globalThis.BigInt
  let largeParses = 0
  t.mock.method(globalThis, 'BigInt', (value: Parameters<typeof BigInt>[0]) => {
    if (typeof value === 'string' && value.length >= 100_000) largeParses++
    return bigint(value)
  })
  for (const [a, b, expected] of [
    [large, smaller, 1], [smaller, large, -1], [large, large, 0],
    [`-${large}`, `-${smaller}`, -1], [`-${smaller}`, `-${large}`, 1],
    [large, `-${large}`, 1], ['0', `-${large}`, 1],
    [large, `1${large}`, -1], [`-${large}`, `-1${large}`, 1]
  ] as const) assert.equal(Exact.compare(a, b), expected)
  assert.equal(largeParses, 0)
  assert.throws(() => Exact.compare(large, { numerator: '0', denominator: '0' }), /denominator/)
})

test('fraction comparisons agree with cross-products across reinforcing and opposing orders', () => {
  for (let a = -8; a <= 8; a++) for (let c = -8; c <= 8; c++) {
    for (const b of [-7, -3, 1, 2, 5, 11]) for (const d of [-7, -3, 1, 2, 5, 11]) {
      const cross = BigInt(a) * BigInt(d) - BigInt(c) * BigInt(b)
      const signed = b * d < 0 ? -cross : cross
      const expected = signed < 0n ? -1 : signed > 0n ? 1 : 0
      assert.equal(Exact.compare({ numerator: a, denominator: b }, { numerator: c, denominator: d }), expected,
        `${a}/${b} versus ${c}/${d}`)
    }
  }
})

test('decimal normalization agrees with integer arithmetic across signs and scales', () => {
  for (const sign of ['', '+', '-']) {
    for (const coefficient of ['0', '000', '1.', '.125', '001.25', '010.00', '123', '12000', '.00125000', '1.' + '0'.repeat(1000)]) {
      for (let exponent = -5; exponent <= 5; exponent++) {
        const fractionLength = coefficient.split('.')[1]?.length ?? 0
        const numerator = BigInt(`${sign}${coefficient.replace('.', '')}`)
        const scale = fractionLength - exponent
        const expected = scale <= 0
          ? Exact.fromBigInts(numerator * 10n ** BigInt(-scale), 1n)
          : Exact.fromBigInts(numerator, 10n ** BigInt(scale))
        assert.deepEqual(Exact.rational(`${sign}${coefficient}E${exponent >= 0 ? '+' : ''}${exponent}`), expected)
      }
    }
  }
  assert.deepEqual(Exact.rational('-000.00e9007199254740991'), { numerator: '0', denominator: '1' })
})

test('unit denominators preserve exact integer signs and leading-zero normalization', () => {
  for (let n = -100; n <= 100; n++) {
    for (const numerator of [String(n), `${n < 0 ? '-' : '+'}000${Math.abs(n)}`]) {
      for (const denominator of [1, -1, '1', '-1', '+0001', '-0001']) {
        assert.deepEqual(Exact.rational({ numerator, denominator }),
          Exact.fromBigInts(BigInt(numerator), BigInt(denominator)))
      }
    }
  }
  for (const numerator of ['', '1\n', '1.0', '1e2', '+', '--1', ' 1']) {
    for (const denominator of [1, '-1']) {
      assert.throws(() => Exact.rational({ numerator, denominator }), /integer string/)
    }
  }
})

test('zero rationals validate denominators while normalizing large integer text', () => {
  for (const numerator of [0, '0', '-000', '+000']) {
    for (const denominator of ['1', '-0002', '+003', `1${'0'.repeat(100_000)}`]) {
      assert.deepEqual(Exact.rational({ numerator, denominator }), { numerator: '0', denominator: '1' })
    }
    for (const denominator of ['0', '-000', '+000', 0]) {
      assert.throws(() => Exact.rational({ numerator, denominator }), /denominator must not be zero/)
    }
    for (const denominator of ['', '+', '1e2', '1.0', '1\n', ' 1', '1x', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => Exact.rational({ numerator, denominator }), TypeError)
    }
  }
})

test('bigint normalization preserves signs, zero and reduced exact values', () => {
  for (const [a, b, numerator, denominator] of [
    [6n, 8n, '3', '4'], [-6n, 8n, '-3', '4'],
    [6n, -8n, '-3', '4'], [-6n, -8n, '3', '4'],
    [0n, -8n, '0', '1']
  ] as const) assert.deepEqual(Exact.fromBigInts(a, b), { numerator, denominator })
  let a = 0n, b = 1n
  for (let index = 0; index < 5000; index++) [a, b] = [b, a + b]
  assert.deepEqual(Exact.fromBigInts(-a * 97n, -b * 97n), {
    numerator: String(a), denominator: String(b)
  })
})

test('bigint normalization rejects zero denominators and non-bigint inputs', () => {
  for (const numerator of [0n, 1n, -1n]) {
    assert.throws(() => Exact.fromBigInts(numerator, 0n), /denominator must not be zero/)
  }
  for (const value of [1, '1', null, undefined, {}, true]) {
    assert.throws(() => Exact.fromBigInts(value as bigint, 1n), /expected bigint/)
    assert.throws(() => Exact.fromBigInts(1n, value as bigint), /expected bigint/)
  }
})
