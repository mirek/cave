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

/** @returns σ from an interval `delta` given at `level`σ: σ = Δ / k. */
export const sigma = (delta: number, level: number = defaultSigmaLevel): number => {
  if (!(level > 0)) {
    throw new Error(`Expected positive sigma level, got ${level}.`)
  }
  return delta / level
}

/** @returns symmetric `[low, high]` interval around `mean`. */
export const interval = (mean: number, delta: number): [number, number] =>
  [mean - delta, mean + delta]
