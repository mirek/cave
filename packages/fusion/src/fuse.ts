/**
 * Bayesian fusion of numeric estimates (spec §10.1).
 *
 * Given independent, normally distributed estimates of the same quantity —
 * each with a mean, a σ, and an epistemic confidence acting as a weight
 * multiplier — the posterior is precision-weighted:
 *
 * - weighted precision: wᵢ = pᵢ / σᵢ²
 * - posterior mean:     μ = Σ wᵢxᵢ / Σ wᵢ
 * - posterior σ:        1 / √(Σ wᵢ)
 *
 * The math is an implementation layer, not required syntax (spec §10) —
 * CAVE itself only stores claims and metadata.
 */

import { Claim, Uncertainty } from '@cavelang/core'
import { validateConfidence } from './validate.ts'

/** One numeric estimate: finite mean, positive finite σ, confidence p ∈ [0, 1]. */
export type Estimate = {
  readonly mean: number
  readonly sigma: number
  /** Unit shared by the mean and σ. Missing is a distinct dimension. */
  readonly unit?: string
  /** Epistemic confidence used as a precision multiplier (default 1). */
  readonly conf?: number
}

const validateEstimate = (estimate: Estimate): void => {
  Uncertainty.validateSigma(estimate.sigma)
  validateConfidence(estimate.conf === undefined ? 1 : estimate.conf)
  if (!Number.isFinite(estimate.mean)) throw new RangeError('estimate mean must be finite')
  if (estimate.unit !== undefined && typeof estimate.unit !== 'string') {
    throw new TypeError('estimate unit must be a string when supplied')
  }
}

export type Posterior = {
  readonly mean: number
  readonly sigma: number
  /** Total weighted precision Σ wᵢ. */
  readonly precision: number
  /** Unit in which the posterior mean and σ are expressed. */
  readonly unit?: string
}

const durationScale: Readonly<Record<string, number>> = {
  ms: 0.001,
  s: 1,
  min: 60,
  h: 3_600
}

const conversionFactor = (from: undefined | string, to: undefined | string): undefined | number => {
  if (from === to) return 1
  if (from === undefined || to === undefined) return undefined
  const fromScale = Object.hasOwn(durationScale, from) ? durationScale[from] : undefined
  const toScale = Object.hasOwn(durationScale, to) ? durationScale[to] : undefined
  return fromScale === undefined || toScale === undefined ? undefined : fromScale / toScale
}

/** Typed boundary failure for estimates that do not share a compatible unit. */
export class FusionUnitError extends Error {
  readonly units: readonly (string | undefined)[]

  constructor(units: readonly (string | undefined)[]) {
    const unique = [...new Set(units)].sort((a, b) => (a ?? '').localeCompare(b ?? ''))
    super('cannot fuse mixed units: ' +
      `${unique.map(unit => unit ?? '(none)').join(', ')} — convert the estimates to one unit first`)
    this.name = 'FusionUnitError'
    this.units = unique
  }
}

/** Sum finite weighted binary64 terms exactly, then round once. Rare overflow/underflow fallback. */
const exactAverage = (terms: readonly { mean: number, ratio: number }[], weight: number): number => {
  const view = new DataView(new ArrayBuffer(8))
  // Every finite double is an integer multiple of 2^-1074. Using that common
  // scale preserves tiny residuals even when large partial sums overflow.
  const units = (value: number): bigint => {
    view.setFloat64(0, value)
    const bits = view.getBigUint64(0)
    const exponent = Number((bits >> 52n) & 0x7ffn)
    const fraction = bits & ((1n << 52n) - 1n)
    const magnitude = exponent === 0 ? fraction : ((1n << 52n) | fraction) << BigInt(exponent - 1)
    return bits >> 63n === 0n ? magnitude : -magnitude
  }
  let numerator = 0n
  for (const term of terms) {
    const ratio = units(term.ratio)
    numerator += units(term.mean) * ratio * ratio
  }
  if (numerator === 0n) return 0
  const sign = numerator < 0n ? -1 : 1
  if (numerator < 0n) numerator = -numerator
  // Three factors in each numerator term versus one in the denominator.
  let denominator = units(weight) << 2148n
  // Find the quotient's binary exponent,
  // then round its 53-bit significand (or subnormal integer) ties to even.
  let exponent = numerator.toString(2).length - denominator.toString(2).length
  if (exponent >= 0 ? numerator < (denominator << BigInt(exponent)) :
    (numerator << BigInt(-exponent)) < denominator) exponent--
  const shift = Math.max(-1074, exponent - 52)
  if (shift < 0) numerator <<= BigInt(-shift)
  else denominator <<= BigInt(shift)
  let rounded = numerator / denominator
  const remainder = numerator % denominator
  if (remainder * 2n > denominator || (remainder * 2n === denominator && (rounded & 1n) !== 0n)) rounded++
  return sign * Number(rounded) * 2 ** shift
}

/**
 * Fuses finite estimates into a posterior. Zero-confidence estimates are
 * skipped after validating every input; invalid inputs and unrepresentable
 * posteriors throw instead of returning NaN or infinity.
 * @returns `undefined` when no estimate carries usable weight.
 */
export const fuse = (estimates: readonly Estimate[]): undefined | Posterior => {
  estimates = Array.from(estimates, ({ mean, sigma, conf, unit }) => ({ mean, sigma, conf, unit }))
  for (const estimate of estimates) validateEstimate(estimate)
  const usable = estimates.filter(estimate => (estimate.conf ?? 1) > 0)
  if (usable.length === 0) return undefined
  const unit = usable[0]!.unit
  const factors = usable.map(estimate => conversionFactor(estimate.unit, unit))
  if (factors.some(factor => factor === undefined)) {
    throw new FusionUnitError(usable.map(estimate => estimate.unit))
  }
  let maxRootWeight = 0
  let maxMean = 0
  let lowestMean = Infinity
  let highestMean = -Infinity
  const scaled = usable.map((estimate, index) => {
    const factor = factors[index]!
    const sigma = estimate.sigma * factor
    const mean = estimate.mean * factor
    if (!Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) {
      throw new RangeError('converted estimate is outside the finite numeric range')
    }
    const rootConfidence = Math.sqrt(estimate.conf ?? 1)
    const rootWeight = rootConfidence / sigma
    maxRootWeight = Math.max(maxRootWeight, rootWeight)
    maxMean = Math.max(maxMean, Math.abs(mean))
    lowestMean = Math.min(lowestMean, mean)
    highestMean = Math.max(highestMean, mean)
    return { mean, rootWeight, rootConfidence, sigma }
  })
  if (!Number.isFinite(maxRootWeight) || maxRootWeight === 0) {
    throw new RangeError('posterior precision is outside the finite numeric range')
  }
  // A root weight may underflow even though its ratio to a small maximum,
  // and the resulting weighted mean, are representable. Keep its factors.
  const ratioOf = (estimate: typeof scaled[number]): number => {
    const denominator = estimate.sigma * maxRootWeight
    return estimate.rootWeight < 2 ** -1022 && Number.isFinite(denominator)
      ? estimate.rootConfidence / denominator
      : estimate.rootWeight / maxRootWeight
  }
  // Normalize before squaring or multiplying by means. Direct σ² and w*x
  // intermediates can overflow even when the posterior is representable.
  let totalWeight = 0
  let weightCorrection = 0
  for (const estimate of scaled) {
    const weight = ratioOf(estimate) ** 2
    const next = totalWeight + weight
    weightCorrection += totalWeight >= weight
      ? (totalWeight - next) + weight : (weight - next) + totalWeight
    totalWeight = next
  }
  totalWeight += weightCorrection
  const rootPrecision = maxRootWeight * Math.sqrt(totalWeight)
  const precision = rootPrecision * rootPrecision
  const sigma = 1 / rootPrecision
  if (!Number.isFinite(precision) || precision === 0 || !Number.isFinite(sigma) || sigma === 0) {
    throw new RangeError('posterior precision is outside the finite numeric range')
  }
  // A convex average of identical converted means is that mean. Precision and
  // input validation above still apply; Object.is keeps mixed signed zeros on
  // the general path with its existing rounding behavior.
  if (Object.is(lowestMean, highestMean)) {
    return { mean: lowestMean, sigma, precision, ...unit === undefined ? {} : { unit } }
  }
  // Multiply each root-weight factor separately: squaring a tiny ratio first
  // could erase a representable contribution from a very large mean.
  let mean = 0
  let meanCorrection = 0
  // A power-of-two scale preserves subnormal inputs exactly while preventing
  // their weighted products from rounding away before they can be added.
  const meanScale = maxMean > 0 && maxMean < 2 ** -1022 ? 2 ** -1022 : 1
  let numerator = 0
  let numeratorCorrection = 0
  let subnormalProduct = false
  for (const estimate of scaled) {
    const ratio = ratioOf(estimate)
    const weightedMean = ((estimate.mean / meanScale) * ratio) * ratio
    if (estimate.mean !== 0 && ratio !== 0 && Math.abs(weightedMean) < 2 ** -1022) subnormalProduct = true
    const numeratorNext = numerator + weightedMean
    numeratorCorrection += Math.abs(numerator) >= Math.abs(weightedMean)
      ? (numerator - numeratorNext) + weightedMean : (weightedMean - numeratorNext) + numerator
    numerator = numeratorNext
    const contribution = weightedMean / totalWeight
    const next = mean + contribution
    // Keep small contributions when large positive and negative means cancel.
    meanCorrection += Math.abs(mean) >= Math.abs(contribution)
      ? (mean - next) + contribution : (contribution - next) + mean
    mean = next
  }
  mean += meanCorrection
  // Divide once when possible: separate divisions can erase subnormal terms
  // that would survive their combined average, including after cancellation.
  const correctedNumerator = numerator + numeratorCorrection
  if (Number.isFinite(correctedNumerator)) mean = correctedNumerator / totalWeight
  // A finite sum cannot recover contributions already rounded during weighting.
  // Recompute only when those subnormal products may determine a tiny result.
  if (!Number.isFinite(correctedNumerator) || (subnormalProduct && Math.abs(mean) < 2 ** -1022)) {
    mean = exactAverage(scaled.map(estimate => ({
      mean: estimate.mean / meanScale, ratio: ratioOf(estimate)
    })), totalWeight)
  }
  mean *= meanScale
  if (!Number.isFinite(mean)) {
    // Near Number.MAX_VALUE, rounded convex contributions can sum just beyond
    // the finite range. Rescale that boundary case before summing.
    const normalized = scaled.reduce((sum, estimate) => sum +
      ratioOf(estimate) ** 2 * (estimate.mean / maxMean), 0) / totalWeight
    mean = Math.max(-1, Math.min(1, normalized)) * maxMean
  }
  // Positive weights form a convex average. Bound floating-point roundoff to
  // the converted input interval, including identical and subnormal means.
  mean = Math.max(lowestMean, Math.min(highestMean, mean))
  return {
    mean,
    sigma,
    precision,
    ...unit === undefined ? {} : { unit }
  }
}

/**
 * @returns the estimate a claim carries, when it is numeric with `+/-`
 * uncertainty: mean from the payload value, σ = Δ / k (spec §7.2),
 * confidence from `@ N%`. `undefined` otherwise.
 */
export const estimateOf = (claim: Claim.t): undefined | Estimate => {
  const payload = claim.payload
  const value =
    payload.kind === 'attribute' ? payload.value :
    payload.kind === 'metric' ? payload.value :
    undefined
  if (value === undefined) return undefined
  const mean = value.num
  if (mean === undefined) return undefined
  const delta = claim.delta
  if (delta === undefined) return undefined
  const magnitude = delta.num
  if (magnitude === undefined) return undefined
  const sigma = Uncertainty.sigma(magnitude, claim.sigmaLevel)
  const unit = value.unit
  const deltaUnit = delta.unit
  const factor = conversionFactor(deltaUnit, unit)
  if (factor === undefined) {
    throw new FusionUnitError([unit, deltaUnit])
  }
  const estimate: Estimate = {
    mean,
    sigma: sigma * factor,
    ...unit === undefined ? {} : { unit },
    conf: claim.conf
  }
  validateEstimate(estimate)
  return estimate
}

/**
 * Fuses the numeric estimates found in `claims` (spec §10.1's worked
 * example lives in the tests). Claims without usable numeric uncertainty
 * are ignored.
 */
export const fuseClaims = (claims: readonly Claim.t[]): undefined | Posterior => {
  const estimates: Estimate[] = []
  for (const claim of claims) {
    const estimate = estimateOf(claim)
    if (estimate !== undefined) estimates.push(estimate)
  }
  return fuse(estimates)
}
