import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Uncertainty, Value } from '@cavelang/core'
import { FusionUnitError, fuse, fuseClaims, estimateOf } from '@cavelang/fusion'

const metricClaim = (value: string, delta: string, conf: number): Claim.t =>
  Claim.of({
    subject: Claim.entity('revenue'),
    verb: 'IS',
    payload: Claim.metric(Value.parse(value)),
    delta: Value.parse(delta),
    conf
  })

test('fusion retains subnormal means before averaging and after cancellation', () => {
  for (const sign of [1, -1]) {
    const unequal = fuse([1, 2, 2, 2, 2].map(sigma => ({ mean: sign * Number.MIN_VALUE, sigma })))!
    assert.equal(unequal.mean, sign * Number.MIN_VALUE)
    for (const means of [
      [Number.MIN_VALUE, Number.MIN_VALUE],
      [1, -1, Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE]
    ]) {
      for (const order of [means, [...means].reverse()]) {
        const posterior = fuse(order.map(mean => ({ mean: sign * mean, sigma: 1 })))!
        assert.equal(posterior.mean, sign * Number.MIN_VALUE)
      }
    }
  }
})

test('fusion retains contributions whose root precision underflows before normalization', () => {
  // 800-digit Decimal evaluation of the binary64 inputs, rounded to binary64.
  const cases = [[1e308, 4.94065645841e-312], [5e161, 1.9762625833649865e-19]] as const
  for (const [sigma, expected] of cases) for (const sign of [-1, 1]) {
    const estimates = [{ mean: sign * 1e308, sigma, conf: Number.MIN_VALUE }, { mean: 0, sigma: 1e160 }]
    for (const order of [estimates, [...estimates].reverse()]) {
      const result = fuse(order)!
      assert.ok(Math.abs(result.mean - sign * expected) <= Math.max(Number.MIN_VALUE * 2, expected * 1e-14), String(result.mean))
      assert.ok(result.precision > 0)
      assert.equal(result.sigma, 1e160)
    }
  }
})

test('fusion preserves identical means across finite scales and unequal weights', () => {
  for (const mean of [0, Number.MIN_VALUE, Number.MIN_VALUE * 3, 2 ** -1022, 1, 3, 1e200, Number.MAX_VALUE]) {
    for (const sign of [-1, 1]) for (const sigma of [1, 2, 3, 7, 1e8]) for (const count of [2, 3, 10, 100]) {
      const estimates = Array.from({ length: count }, (_, at) => ({ mean: sign * mean, sigma: at === 0 ? 1 : sigma }))
      assert.equal(fuse(estimates)!.mean, sign * mean, JSON.stringify({ mean, sign, sigma, count }))
      assert.equal(fuse([...estimates, { mean: -sign * Number.MAX_VALUE, sigma: 1, conf: 0 }])!.mean, sign * mean)
    }
  }
})

test('fusion retains mixed signed-zero mean behavior', () => {
  for (const means of [[0, -0], [-0, 0]]) {
    assert.equal(fuse(means.map(mean => ({ mean, sigma: 1 })))!.mean, 0)
  }
})

test('fusion rejects invalid numeric inputs and inherited unit names', () => {
  for (const conf of [-1, 1.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => fuse([{ mean: 1, sigma: 1, conf }]), RangeError)
  }
  for (const mean of [NaN, Infinity, -Infinity]) {
    assert.throws(() => fuse([{ mean, sigma: 1 }]), RangeError)
  }
  for (const unit of ['toString', 'constructor', '__proto__']) {
    assert.throws(() => fuse([{ mean: 1, sigma: 1, unit: 's' }, { mean: 1, sigma: 1, unit }]), FusionUnitError)
  }
})

test('optional estimate fields reject null confidence and non-string units', () => {
  assert.throws(() => fuse([{ mean: 1, sigma: 1, conf: null as unknown as number }]), RangeError)
  for (const unit of [null, 42, false, {}, []]) {
    for (const conf of [0, 1]) {
      assert.throws(() => fuse([{ mean: 1, sigma: 1, conf, unit: unit as unknown as string }]), TypeError)
    }
  }
  assert.deepEqual(fuse([{ mean: 1, sigma: 1 }]), { mean: 1, sigma: 1, precision: 1 })
  assert.deepEqual(fuse([{ mean: 1, sigma: 1, conf: undefined, unit: undefined }]),
    { mean: 1, sigma: 1, precision: 1 })
  assert.equal(fuse([{ mean: 1, sigma: 1, unit: 'widgets' }])?.unit, 'widgets')
  const base = metricClaim('10 ms', '2 ms', 1)
  assert.throws(() => estimateOf({ ...base, conf: null as unknown as number }), RangeError)
})

test('estimate extraction validates structurally constructed claim means and confidence', () => {
  const base = metricClaim('10 ms', '2 ms', 1)
  for (const conf of [-1, 1.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => estimateOf({ ...base, conf }), /confidence must be finite and between 0 and 1/)
  }
  for (const num of [NaN, Infinity, -Infinity]) {
    for (const conf of [0, 1]) {
      const payload = Claim.metric({ ...Value.parse('10 ms'), num })
      assert.throws(() => estimateOf({ ...base, payload, conf }), /estimate mean must be finite/)
    }
  }
  const zero = estimateOf({ ...base, conf: 0 })!
  assert.deepEqual(zero, { mean: 10, sigma: 1, unit: 'ms', conf: 0 })
  assert.equal(fuse([zero]), undefined)
})

test('fusion rejects missing estimate slots instead of skipping evidence', () => {
  const estimate = { mean: 10, sigma: 1, conf: 0 }
  for (const estimates of [new Array<typeof estimate>(1), [estimate, , estimate]]) {
    assert.throws(() => fuse(estimates as typeof estimate[]))
  }
  const claim = metricClaim('10 ms', '2 ms', 1)
  for (const claims of [new Array<Claim.t>(1), [claim, , claim]]) {
    assert.throws(() => fuseClaims(claims as Claim.t[]))
  }
})

test('fusion avoids intermediate overflow and rejects unrepresentable posteriors', () => {
  assert.equal(fuse([{ mean: 1e308, sigma: 0.1 }])?.mean, 1e308)
  assert.equal(fuse([{ mean: 1e308, sigma: 1 }, { mean: -1e308, sigma: 1 }])?.mean, 0)
  for (const sign of [-1, 1]) {
    for (const count of [3, 5, 7]) {
      const posterior = fuse(Array.from({ length: count }, () => ({ mean: sign * Number.MAX_VALUE, sigma: 1 })))!
      assert.ok(Number.isFinite(posterior.mean))
      assert.ok(Math.abs(posterior.mean / (sign * Number.MAX_VALUE) - 1) < 1e-14)
    }
  }
  const tinyPrecision = fuse([{ mean: 10, sigma: 1e160 }])!
  assert.equal(tinyPrecision.mean, 10)
  assert.ok(Math.abs(tinyPrecision.sigma / 1e160 - 1) < 1e-12)
  assert.ok(tinyPrecision.precision > 0 && Number.isFinite(tinyPrecision.precision))
  const tinyWeight = fuse([{ mean: 1e308, sigma: 1e200 }, { mean: 0, sigma: 1 }])!
  assert.ok(Math.abs(tinyWeight.mean / 1e-92 - 1) < 1e-12)
  for (const sigma of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.throws(() => fuse([{ mean: 1, sigma }]), RangeError)
  }
})

test('fusion retains the combined precision of many weak estimates', () => {
  const weak = Array.from({ length: 10_000 }, () => ({ mean: 1, sigma: 1e8 }))
  const strong = { mean: 1, sigma: 1 }
  const expectedPrecision = 1 + weak.length / 1e16
  for (const estimates of [[strong, ...weak], [...weak, strong]]) {
    const posterior = fuse(estimates)!
    assert.ok(Math.abs(posterior.precision - expectedPrecision) < 1e-15, String(posterior.precision))
    assert.ok(Math.abs(posterior.sigma - 1 / Math.sqrt(expectedPrecision)) < 1e-15)
    assert.ok(Math.abs(posterior.mean - 1) < 1e-15, String(posterior.mean))
  }
})

test('fusion retains small mean contributions through cancellation', () => {
  for (const means of [
    [1e16, 1, -1e16], [1e16, -1e16, 1],
    [1, 1e16, -1e16], [1, -1e16, 1e16],
    [-1e16, 1, 1e16], [-1e16, 1e16, 1]
  ]) {
    const posterior = fuse(means.map(mean => ({ mean, sigma: 1 })))!
    assert.equal(posterior.mean, 1 / 3, means.join(', '))
    assert.ok(Math.abs(posterior.precision - 3) < 1e-14)
  }
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

test('claim fusion weights supplied occurrences without resolving history or source identity', () => {
  const estimate = Claim.of({ ...metricClaim('10 ms', '4 ms', 1), contexts: ['src:instrument'] })
  const retraction = Claim.of({ ...estimate, conf: 0 })
  const single = fuseClaims([estimate])!
  assert.deepEqual(fuseClaims([estimate, retraction]), single)
  assert.equal(fuseClaims([retraction]), undefined)
  const repeated = fuseClaims([estimate, estimate, estimate, estimate])!
  assert.equal(repeated.mean, single.mean)
  assert.equal(repeated.precision, single.precision * 4)
  assert.equal(repeated.sigma, single.sigma / 2)
  assert.deepEqual(fuseClaims([Claim.of({ ...estimate, contexts: ['src:renamed'] })]), single)
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
  assert.equal(estimateOf(metricClaim('1s', '200ms', 1))?.sigma, 0.1)
  assert.throws(() => estimateOf(metricClaim('1s', '2 USD', 1)), FusionUnitError)
})

test('claim estimates reject sigma overflow and underflow after unit conversion', () => {
  for (const [value, delta] of [
    ['1 ms', `${Value.formatNumber(Number.MAX_VALUE)} h`],
    ['1 s', `${Value.formatNumber(Number.MIN_VALUE * 2)} ms`]
  ]) {
    const claim = metricClaim(value!, delta!, 1)
    assert.ok(Number.isFinite(Claim.sigmaOf(claim)))
    assert.ok(Claim.sigmaOf(claim)! > 0)
    assert.throws(() => estimateOf(claim), Uncertainty.InvalidUncertaintyError)
  }
  for (const [value, delta, expected] of [
    ['1 ms', `${Value.formatNumber(1e300)} s`, 5e302],
    ['1 s', `${Value.formatNumber(1e-310)} ms`, 5e-314]
  ] as const) {
    const estimate = estimateOf(metricClaim(value, delta, 1))!
    assert.ok(estimate.sigma > 0 && Number.isFinite(estimate.sigma))
    assert.ok(Math.abs(estimate.sigma / expected - 1) < 1e-9)
  }
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

test('fusion units: missing and equal units agree, fixed durations convert', () => {
  assert.equal(fuse([{ mean: 10, sigma: 2 }, { mean: 12, sigma: 2 }])?.unit, undefined)
  assert.equal(fuse([{ mean: 10, sigma: 2, unit: 'USD' }, { mean: 12, sigma: 2, unit: 'USD' }])?.unit, 'USD')
  const converted = fuse([
    { mean: 1, sigma: 0.1, unit: 's' },
    { mean: 500, sigma: 100, unit: 'ms' }
  ])
  assert.equal(converted?.unit, 's')
  assert.ok(Math.abs(converted!.mean - 0.75) < 1e-12)
  assert.ok(Math.abs(converted!.sigma - 0.1 / Math.SQRT2) < 1e-12)
  const claims = fuseClaims([
    metricClaim('1s', '200ms', 1),
    metricClaim('500ms', '200ms', 1)
  ])
  assert.equal(claims?.unit, 's')
  assert.ok(Math.abs(claims!.mean - 0.75) < 1e-12)
})

test('fusion rejects missing/present and incompatible units with a typed error', () => {
  for (const estimates of [
    [{ mean: 1, sigma: 1 }, { mean: 2, sigma: 1, unit: 'ms' }],
    [{ mean: 1, sigma: 1, unit: 'USD/yr' }, { mean: 2, sigma: 1, unit: 'ms' }]
  ]) {
    assert.throws(() => fuse(estimates), error =>
      error instanceof FusionUnitError && error.message.includes('cannot fuse mixed units'))
  }
  assert.throws(() => fuseClaims([
    metricClaim('1 ms', '1 ms', 1),
    metricClaim('1 USD/yr', '1 USD/yr', 1)
  ]), FusionUnitError)
})

test('zero-confidence estimates are skipped; invalid sigma fails loudly', () => {
  const posterior = fuse([
    { mean: 100, sigma: 1, conf: 0 },
    { mean: 10, sigma: 2 }
  ])
  assert.ok(posterior)
  assert.equal(posterior.mean, 10)
  for (const sigma of [0, -1, Infinity, -Infinity, NaN]) {
    assert.throws(() => fuse([{ mean: 1, sigma }]), Uncertainty.InvalidUncertaintyError)
  }
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
  assert.equal(estimate?.unit, 'USD/yr')
})

test('duration fusion preserves the physical result across units, order and zero-weight entries', () => {
  const seconds = [
    { mean: -2, sigma: 0.5, conf: 0.75 },
    { mean: 3, sigma: 2, conf: 0.5 },
    { mean: 7, sigma: 1, conf: 1 }
  ]
  // Independent closed-form reference in seconds, kept in a safe numeric range.
  const precision = seconds.reduce((sum, item) => sum + item.conf / item.sigma ** 2, 0)
  const mean = seconds.reduce((sum, item) => sum + item.mean * item.conf / item.sigma ** 2, 0) / precision
  const sigma = 1 / Math.sqrt(precision)
  const scales = { ms: 0.001, s: 1, min: 60, h: 3600 }
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) <= 1e-13 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)
  for (const firstUnit of Object.keys(scales) as (keyof typeof scales)[]) {
    for (const order of orders) {
      const estimates = order.map((index, position) => {
        const unit = position === 0 ? firstUnit : position === 1 ? 'ms' : 'min'
        const item = seconds[index!]!
        return Object.freeze({ mean: item.mean / scales[unit], sigma: item.sigma / scales[unit], conf: item.conf, unit })
      })
      const posterior = fuse(Object.freeze([
        Object.freeze({ mean: Number.MAX_VALUE, sigma: 1, conf: 0, unit: 'ignored-unit' }), ...estimates
      ]))!
      assert.equal(posterior.unit, firstUnit)
      near(posterior.mean * scales[firstUnit], mean)
      near(posterior.sigma * scales[firstUnit], sigma)
      near(posterior.precision / scales[firstUnit] ** 2, precision)
    }
  }
})

test('fusion captures estimate properties once before validation and calculation', () => {
  const reads = { mean: 0, sigma: 0, conf: 0, unit: 0 }
  const estimate = {
    get mean() { return ++reads.mean === 1 ? 10 : NaN },
    get sigma() { return ++reads.sigma === 1 ? 2 : NaN },
    get conf() { return ++reads.conf === 1 ? 1 : NaN },
    get unit() { return ++reads.unit === 1 ? 'ms' : 'incompatible' }
  }
  assert.deepEqual(fuse([estimate]), fuse([{ mean: 10, sigma: 2, conf: 1, unit: 'ms' }]))
  assert.deepEqual(reads, { mean: 1, sigma: 1, conf: 1, unit: 1 })
})

test('claim estimate extraction captures numeric fields and uncertainty once', () => {
  const base = metricClaim('10 ms', '4 ms', 0.8)
  const reads = { mean: 0, unit: 0, delta: 0, deltaNum: 0, deltaUnit: 0 }
  const value = { ...Value.parse('10 ms'),
    get num() { return ++reads.mean === 1 ? 10 : NaN },
    get unit() { return ++reads.unit === 1 ? 'ms' : 's' }
  }
  const delta = { ...Value.parse('4 ms'),
    get num() { return ++reads.deltaNum === 1 ? 4 : NaN },
    get unit() { return ++reads.deltaUnit === 1 ? 'ms' : 's' }
  }
  const claim = { ...base, payload: Claim.metric(value),
    get delta() { ++reads.delta; return delta }
  }
  assert.deepEqual(estimateOf(claim), { mean: 10, sigma: 2, unit: 'ms', conf: 0.8 })
  assert.deepEqual(reads, { mean: 1, unit: 1, delta: 1, deltaNum: 1, deltaUnit: 1 })
})

test('fusion retains subnormal residuals when its unnormalized numerator overflows', () => {
  const max = Number.MAX_VALUE
  for (const sign of [-1, 1]) {
    assert.equal(fuse([max, max, -max].map(mean => ({ mean: sign * mean, sigma: 1 })))!.mean, sign * (max / 3))
    for (const tinyCount of [4, 5, 12]) {
      const tiny = Array(tinyCount).fill(sign * Number.MIN_VALUE) as number[]
      for (const means of [
        [max, max, -max, -max, ...tiny],
        [...tiny, max, max, -max, -max],
        [-max, -max, ...tiny, max, max]
      ]) {
        const result = fuse(means.map(mean => ({ mean, sigma: 1 })))!
        assert.equal(result.mean, sign * (tinyCount === 4 ? 0 : Number.MIN_VALUE))
        assert.ok(Number.isFinite(result.precision))
      }
    }
  }
})


test('overflow fallback retains weighted residuals before product underflow', () => {
  for (const sign of [-1, 1]) {
    const large = [Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE]
      .map(mean => ({ mean, sigma: 1 }))
    const small = Array.from({ length: 32 }, () => ({ mean: sign * Number.MIN_VALUE, sigma: 2 }))
    for (const estimates of [[...large, ...small], [...small, ...large]]) {
      // Tiny total weight is 8; total weight is 12, so the mean rounds to MIN_VALUE.
      assert.equal(fuse(estimates)!.mean, sign * Number.MIN_VALUE)
    }
  }
})

test('fusion recovers subnormal weighted products after finite cancellation', () => {
  for (const large of [1, Number.MAX_VALUE]) {
    for (const sign of [-1, 1]) {
      for (const [count, units, expectedUnits] of [[8, 1, 0], [9, 1, 1], [32, 1, 1], [32, 3, 2]] as const) {
        const positive = { mean: large, sigma: 1 }
        const negative = { mean: -large, sigma: 1 }
        const tiny = Array.from({ length: count }, () => ({ mean: sign * units * Number.MIN_VALUE, sigma: 2 }))
        // Exact mean in MIN_VALUE units is count * units / (8 + count).
        for (const estimates of [[positive, negative, ...tiny], [positive, ...tiny, negative], [...tiny, negative, positive]]) {
          assert.equal(fuse(estimates)!.mean, sign * expectedUnits * Number.MIN_VALUE)
        }
      }
    }
  }
})

test('fusion cancellation agrees with an independent integer-weight oracle', () => {
  let seed = 0x5ca1ab1e
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 16 }
  const sigmas = [1, 2, 4, 8] as const
  const confidences = [1, 0.25, 0.0625] as const
  let checked = 0
  for (let fixture = 0; fixture < 64; fixture++) {
    const tiny = Array.from({ length: 1 + next() % 32 }, () => ({ units: next() % 63 - 31, sigma: sigmas[next() % 4]!, conf: confidences[next() % 3]! }))
    const largeSigma = sigmas[next() % 4]!
    const largeConfidence = confidences[next() % 3]!
    for (const large of [1, Number.MAX_VALUE]) for (const pairs of [1, 2]) {
      // Sigma and confidence are powers of two: scaling weights by 1024 makes all
      // weights small exact integers. Large terms cancel analytically.
      const numerator = tiny.reduce((sum, item) => sum + item.units * (1024 * item.conf / item.sigma ** 2), 0)
      const denominator = pairs * 2 * (1024 * largeConfidence / largeSigma ** 2) +
        tiny.reduce((sum, item) => sum + 1024 * item.conf / item.sigma ** 2, 0)
      const magnitude = Math.abs(numerator)
      let rounded = Math.floor(magnitude / denominator)
      const remainder = magnitude % denominator
      if (2 * remainder > denominator || (2 * remainder === denominator && rounded % 2 === 1)) rounded++
      const expected = Math.sign(numerator) * rounded * Number.MIN_VALUE
      const positive = Array.from({ length: pairs }, () => ({ mean: large, sigma: largeSigma, conf: largeConfidence }))
      const negative = Array.from({ length: pairs }, () => ({ mean: -large, sigma: largeSigma, conf: largeConfidence }))
      const residual = tiny.map(item => ({ mean: item.units * Number.MIN_VALUE, sigma: item.sigma, conf: item.conf }))
      for (const estimates of [
        [...positive, ...negative, ...residual],
        [...positive, ...residual, ...negative],
        [...residual, ...negative, ...positive]
      ]) {
        const result = fuse(estimates)!
        assert.equal(result.mean, expected, JSON.stringify({ fixture, large, pairs, numerator, denominator, order: checked % 3 }))
        assert.ok(Math.abs(result.precision / (denominator / 1024) - 1) < 1e-14)
        checked++
      }
    }
  }
  assert.equal(checked, 768)
})
