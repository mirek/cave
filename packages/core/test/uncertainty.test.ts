import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Uncertainty, Claim, Value } from '@cave/core'

test('default 2σ: 20B +/- 2B → σ = 1B (spec §7.2)', () => {
  assert.equal(Uncertainty.sigma(2e9), 1e9)
})

test('explicit σ level overrides (spec §7.2)', () => {
  assert.equal(Uncertainty.sigma(2e9, 1), 2e9)
  assert.ok(Math.abs(Uncertainty.sigma(2e9, 3) - 2e9 / 3) < 1)
})

test('non-positive σ level throws', () => {
  assert.throws(() => Uncertainty.sigma(1, 0))
  assert.throws(() => Uncertainty.sigma(1, -2))
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
})
