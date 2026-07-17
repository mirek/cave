import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Uncertainty, Claim, Value } from '@cavelang/core'

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
