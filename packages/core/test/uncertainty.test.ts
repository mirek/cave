import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Uncertainty, Claim, Value } from '@cavelang/core'

for (const [field, validate] of [
  ['uncertainty delta', Uncertainty.validateDelta],
  ['sigma level', Uncertainty.validateSigmaLevel],
  ['sigma', Uncertainty.validateSigma],
] as const) {
  test(`${field} validation retains typed errors for unprintable input`, () => {
    for (const value of [Object.create(null), { [Symbol.toPrimitive]() { throw new Error('conversion unavailable') } }]) {
      assert.throws(() => validate(value), error => {
        assert.ok(error instanceof Uncertainty.InvalidUncertaintyError)
        assert.ok(error instanceof RangeError)
        assert.equal(error.field, field)
        assert.equal(error.value, value)
        assert.equal(error.message, `Expected positive finite ${field}, got [unprintable value].`)
        return true
      })
    }
    assert.equal(validate(1), 1)
  })
}

test('default 2σ: 20B +/- 2B → σ = 1B (spec §7.2)', () => {
  assert.equal(Uncertainty.sigma(2e9), 1e9)
})

test('explicit σ level overrides (spec §7.2)', () => {
  assert.equal(Uncertainty.sigma(2e9, 1), 2e9)
  assert.ok(Math.abs(Uncertainty.sigma(2e9, 3) - 2e9 / 3) < 1)
})

test('uncertainty values must be positive and finite', () => {
  for (const invalid of [0, -1, Infinity, -Infinity, NaN]) {
    assert.throws(() => Uncertainty.sigma(1, invalid), Uncertainty.InvalidUncertaintyError)
    assert.throws(() => Uncertainty.sigma(invalid, 2), Uncertainty.InvalidUncertaintyError)
    assert.throws(() => Uncertainty.validateSigma(invalid), Uncertainty.InvalidUncertaintyError)
  }
})

test('interval is symmetric around the mean', () => {
  assert.deepEqual(Uncertainty.interval(20, 2), [18, 22])
})

test('interval validates its uncertainty half-width', () => {
  for (const delta of [0, -0, -1, Infinity, -Infinity, NaN]) {
    assert.throws(() => Uncertainty.interval(20, delta), error => {
      assert.ok(error instanceof Uncertainty.InvalidUncertaintyError)
      assert.equal(error.field, 'uncertainty delta')
      assert.ok(Object.is(error.value, delta))
      return true
    })
  }
  assert.deepEqual(Uncertainty.interval(-20, 2), [-22, -18])
  assert.deepEqual(Uncertainty.interval(0, Number.MIN_VALUE), [-Number.MIN_VALUE, Number.MIN_VALUE])
})

test('Claim.sigmaOf derives σ from claim delta metadata', () => {
  const base = {
    subject: Claim.entity('OpenAI'),
    verb: 'HAS',
    payload: Claim.attribute('revenue', Value.parse('20B USD/yr'))
  }
  assert.equal(Claim.sigmaOf(Claim.of(base)), undefined)
  assert.equal(Claim.sigmaOf(Claim.of({ ...base, delta: Value.parse('2B USD/yr') })), 1e9)
  assert.equal(Claim.sigmaOf(Claim.of({ ...base, delta: Value.parse('2B USD/yr'), sigmaLevel: 1 })), 2e9)
  for (const sigmaLevel of [0, -1, Infinity, NaN]) {
    assert.throws(() => Claim.of({ ...base, delta: Value.parse('2B USD/yr'), sigmaLevel }), Uncertainty.InvalidUncertaintyError)
  }
  for (const delta of ['0', '-1', 'unknown']) {
    assert.throws(() => Claim.of({ ...base, delta: Value.parse(delta) }), Uncertainty.InvalidUncertaintyError)
  }
})
