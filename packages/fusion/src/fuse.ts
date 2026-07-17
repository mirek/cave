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

/** One numeric estimate: mean, σ, and confidence weight p ∈ (0, 1]. */
export type Estimate = {
  readonly mean: number
  readonly sigma: number
  /** Unit shared by the mean and σ. Missing is a distinct dimension. */
  readonly unit?: string
  /** Epistemic confidence used as a precision multiplier (default 1). */
  readonly conf?: number
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
  const fromScale = durationScale[from]
  const toScale = durationScale[to]
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

/**
 * Fuses estimates into a posterior. Estimates with `conf` 0 or a
 * non-positive σ contribute nothing and are skipped.
 * @returns `undefined` when no estimate carries usable weight.
 */
export const fuse = (estimates: readonly Estimate[]): undefined | Posterior => {
  estimates.forEach(estimate => Uncertainty.validateSigma(estimate.sigma))
  const usable = estimates.filter(estimate => (estimate.conf ?? 1) > 0)
  if (usable.length === 0) return undefined
  const unit = usable[0]!.unit
  const factors = usable.map(estimate => conversionFactor(estimate.unit, unit))
  if (factors.some(factor => factor === undefined)) {
    throw new FusionUnitError(usable.map(estimate => estimate.unit))
  }
  let totalWeight = 0
  let weightedSum = 0
  for (const [index, estimate] of usable.entries()) {
    const conf = estimate.conf ?? 1
    const factor = factors[index]!
    const sigma = estimate.sigma * factor
    const weight = conf / (sigma * sigma)
    totalWeight += weight
    weightedSum += weight * estimate.mean * factor
  }
  return {
    mean: weightedSum / totalWeight,
    sigma: 1 / Math.sqrt(totalWeight),
    precision: totalWeight,
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
  if (value?.num === undefined) {
    return undefined
  }
  const sigma = Claim.sigmaOf(claim)
  if (sigma === undefined || !(sigma > 0)) {
    return undefined
  }
  const factor = conversionFactor(claim.delta?.unit, value.unit)
  if (factor === undefined) {
    throw new FusionUnitError([value.unit, claim.delta?.unit])
  }
  return {
    mean: value.num,
    sigma: sigma * factor,
    ...value.unit === undefined ? {} : { unit: value.unit },
    conf: claim.conf
  }
}

/**
 * Fuses the numeric estimates found in `claims` (spec §10.1's worked
 * example lives in the tests). Claims without usable numeric uncertainty
 * are ignored.
 */
export const fuseClaims = (claims: readonly Claim.t[]): undefined | Posterior =>
  fuse(claims.flatMap(claim => {
    const estimate = estimateOf(claim)
    return estimate === undefined ? [] : [estimate]
  }))
