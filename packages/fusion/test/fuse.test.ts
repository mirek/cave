import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cave/core'
import { fuse, fuseClaims, estimateOf } from '@cave/fusion'

const metricClaim = (value: string, delta: string, conf: number): Claim.t =>
  Claim.of({
    subject: Claim.entity('revenue'),
    verb: 'IS',
    payload: Claim.metric(Value.parse(value)),
    delta: Value.parse(delta),
    conf
  })

test('spec §10.1 worked example: the filing dominates', () => {
  // revenue IS 18B USD/yr +/- 3B USD/yr @ 60% @src:analyst
  // revenue IS 20B USD/yr +/- 0.5B USD/yr @ 95% @src:filing
  const posterior = fuseClaims([
    metricClaim('18B USD/yr', '3B USD/yr', 0.6),
    metricClaim('20B USD/yr', '0.5B USD/yr', 0.95)
  ])
  assert.ok(posterior)
  // Spec: w_A = 0.6/1.5² ≈ 0.267, w_B = 0.95/0.25² = 15.2 → μ ≈ 19.97B, σ ≈ 0.25B
  assert.ok(Math.abs(posterior.mean - 19.97e9) < 0.01e9, `μ = ${posterior.mean}`)
  assert.ok(Math.abs(posterior.sigma - 0.254e9) < 0.005e9, `σ = ${posterior.sigma}`)
})

test('sigma derives from +/- Δ at the claim σ level (spec §7.2)', () => {
  const twoSigma = estimateOf(metricClaim('20B USD/yr', '3B USD/yr', 0.6))
  assert.equal(twoSigma?.sigma, 1.5e9)
  const oneSigma = estimateOf(Claim.of({
    subject: Claim.entity('revenue'),
    verb: 'IS',
    payload: Claim.metric(Value.parse('20B USD/yr')),
    delta: Value.parse('3B USD/yr'),
    sigmaLevel: 1,
    conf: 0.6
  }))
  assert.equal(oneSigma?.sigma, 3e9)
})

test('a single estimate passes through', () => {
  const posterior = fuse([{ mean: 10, sigma: 2 }])
  assert.ok(posterior)
  assert.equal(posterior.mean, 10)
  assert.equal(posterior.sigma, 2)
})

test('equal estimates tighten the posterior by √n', () => {
  const posterior = fuse([{ mean: 10, sigma: 2 }, { mean: 10, sigma: 2 }])
  assert.ok(posterior)
  assert.equal(posterior.mean, 10)
  assert.ok(Math.abs(posterior.sigma - 2 / Math.SQRT2) < 1e-12)
})

test('zero-confidence and zero-sigma estimates are skipped', () => {
  const posterior = fuse([
    { mean: 100, sigma: 1, conf: 0 },
    { mean: 10, sigma: 2 },
    { mean: 50, sigma: 0 }
  ])
  assert.ok(posterior)
  assert.equal(posterior.mean, 10)
  assert.equal(fuse([{ mean: 1, sigma: 0 }]), undefined)
  assert.equal(fuse([]), undefined)
})

test('claims without numeric uncertainty are ignored (spec §10.1)', () => {
  const bare = Claim.of({
    subject: Claim.entity('revenue'),
    verb: 'IS',
    payload: Claim.metric(Value.parse('21.3B USD/yr')),
    conf: 0.3
  })
  assert.equal(estimateOf(bare), undefined)
  const relational = Claim.of({
    subject: Claim.entity('a'),
    verb: 'USES',
    payload: Claim.relation(Claim.entity('b'))
  })
  assert.equal(estimateOf(relational), undefined)
  assert.equal(fuseClaims([bare, relational]), undefined)
})

test('attribute claims fuse too', () => {
  const claim = Claim.of({
    subject: Claim.entity('OpenAI'),
    verb: 'HAS',
    payload: Claim.attribute('revenue', Value.parse('20B USD/yr')),
    delta: Value.parse('2B USD/yr'),
    conf: 0.9
  })
  const estimate = estimateOf(claim)
  assert.equal(estimate?.mean, 20e9)
  assert.equal(estimate?.sigma, 1e9)
})
