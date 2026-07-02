/**
 * Numeric multipliers (spec §7.1).
 *
 * A multiplier is a single uppercase letter glued to a number: `20B`, `900M`,
 * `1.5T`, `10K`. It scales the numeric value during canonicalization
 * (spec §13.4 step 8: `20B` → `20000000000`); the raw text is preserved.
 */

/** Multiplier letter. */
export type Multiplier = 'T' | 'B' | 'M' | 'K'

export type t = Multiplier

/** Scale factor per multiplier letter. */
export const factors: Readonly<Record<Multiplier, number>> = {
  T: 1e12,
  B: 1e9,
  M: 1e6,
  K: 1e3
}

/** @returns `true` if `s` is exactly one multiplier letter. */
export const is = (s: string): s is Multiplier =>
  s === 'T' || s === 'B' || s === 'M' || s === 'K'

/** @returns scale factor of multiplier. */
export const factor = (m: Multiplier): number =>
  factors[m]
