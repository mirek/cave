/**
 * Value uncertainty — `+/- delta [(Nσ)]` (spec §7.2).
 *
 * `+/-` defines a symmetric interval around the value; the default
 * interpretation is 2σ (≈95% interval). If the interval is Δ at kσ then
 * σ = Δ / k:
 *
 * - `20B +/- 2B`      → σ = 1B  (default 2σ)
 * - `20B +/- 2B (1σ)` → σ = 2B  (wider)
 * - `20B +/- 2B (3σ)` → σ ≈ 0.67B (tighter)
 *
 * Value uncertainty is aleatory (the quantity itself is imprecise) and is
 * independent of epistemic claim confidence `@ N%` (spec §7.3).
 */

/** Default σ level when `(Nσ)` is omitted (spec §7.2). */
export const defaultSigmaLevel = 2

export type Field = 'uncertainty delta' | 'sigma level' | 'sigma'

/** Typed failure for uncertainty values that cannot define a finite distribution. */
export class InvalidUncertaintyError extends RangeError {
  readonly field: Field
  readonly value: unknown

  constructor(field: Field, value: unknown) {
    super(`Expected positive finite ${field}, got ${String(value)}.`)
    this.name = 'InvalidUncertaintyError'
    this.field = field
    this.value = value
  }
}

const positiveFinite = (field: Field, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new InvalidUncertaintyError(field, value)
  }
  return value
}

/** Validates a `+/-` interval half-width. */
export const validateDelta = (value: unknown): number =>
  positiveFinite('uncertainty delta', value)

/** Validates the `N` in an `(Nσ)` override. */
export const validateSigmaLevel = (value: unknown): number =>
  positiveFinite('sigma level', value)

/** Validates a directly supplied standard deviation. */
export const validateSigma = (value: unknown): number =>
  positiveFinite('sigma', value)

/** @returns σ from an interval `delta` given at `level`σ: σ = Δ / k. */
export const sigma = (delta: number, level: number = defaultSigmaLevel): number => {
  return validateSigma(validateDelta(delta) / validateSigmaLevel(level))
}

/** @returns symmetric `[low, high]` interval around `mean`. */
export const interval = (mean: number, delta: number): [number, number] =>
  [mean - delta, mean + delta]
