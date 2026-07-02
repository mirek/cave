/**
 * Claim confidence — `@ N%` (spec §6.3).
 *
 * Epistemic belief in the assertion, stored as a decimal in [0, 1].
 * Omitted confidence means `@ 100%` — directly observed, certain for
 * practical purposes. `@ 0%` means evidentially false or fully rejected
 * (retraction, spec §9.3).
 */

export type Confidence = number

export type t = Confidence

/** Confidence of a claim with no explicit `@ N%` (spec §6.3). */
export const defaultConfidence = 1

/**
 * Parses a percentage token (`90%`) to a decimal clamped to [0, 1]
 * (spec §13.4 step 6: `@ 90%` → `0.9`). The `%` is required — the grammar
 * (spec §16) defines confidence as a percentage ending in `%`, and demanding
 * it keeps a mistyped context like `@ 2026` from silently becoming
 * certainty.
 * @returns `undefined` when the token is not a percentage.
 */
export const parse = (token: string): undefined | Confidence => {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(token.trim())
  if (!match || match[1] === undefined) {
    return undefined
  }
  return clamp(Number(match[1]) / 100)
}

/** @returns confidence clamped to [0, 1]. */
export const clamp = (conf: number): Confidence =>
  Math.min(1, Math.max(0, conf))

/** @returns canonical `N%` text: `0.9` → `90%`. */
export const format = (conf: Confidence): string => {
  const percent = conf * 100
  const rounded = Math.round(percent * 100) / 100
  return `${rounded}%`
}
