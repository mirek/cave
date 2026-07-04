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

import { Claim } from '@cavelang/core'

/** One numeric estimate: mean, σ, and confidence weight p ∈ (0, 1]. */
export type Estimate = {
  readonly mean: number
  readonly sigma: number
  /** Epistemic confidence used as a precision multiplier (default 1). */
  readonly conf?: number
}

export type Posterior = {
  readonly mean: number
  readonly sigma: number
  /** Total weighted precision Σ wᵢ. */
  readonly precision: number
}

/**
 * Fuses estimates into a posterior. Estimates with `conf` 0 or a
 * non-positive σ contribute nothing and are skipped.
 * @returns `undefined` when no estimate carries usable weight.
 */
export const fuse = (estimates: readonly Estimate[]): undefined | Posterior => {
  let totalWeight = 0
  let weightedSum = 0
  for (const estimate of estimates) {
    const conf = estimate.conf ?? 1
    if (!(estimate.sigma > 0) || !(conf > 0)) {
      continue
    }
    const weight = conf / (estimate.sigma * estimate.sigma)
    totalWeight += weight
    weightedSum += weight * estimate.mean
  }
  if (totalWeight === 0) {
    return undefined
  }
  return {
    mean: weightedSum / totalWeight,
    sigma: 1 / Math.sqrt(totalWeight),
    precision: totalWeight
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
  return { mean: value.num, sigma, conf: claim.conf }
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
