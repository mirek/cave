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

/** Shift unsigned decimal text without floating-point multiplication or division. */
const shiftDecimal = (text: string, places: number): string => {
  const [mantissa, exponent = '0'] = text.split('e')
  const dot = mantissa!.indexOf('.')
  const digits = mantissa!.replace('.', '')
  const position = (dot < 0 ? digits.length : dot) + Number(exponent) + places
  const shifted = position <= 0 ? `0.${'0'.repeat(-position)}${digits}` :
    position >= digits.length ? `${digits}${'0'.repeat(position - digits.length)}` :
    `${digits.slice(0, position)}.${digits.slice(position)}`
  const trimmed = shifted.includes('.') ? shifted.replace(/0+$/, '').replace(/\.$/, '') : shifted
  return trimmed.replace(/^0+(?=\d)/, '')
}

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
  return clamp(Number(shiftDecimal(match[1], -2)))
}

/** @returns confidence clamped to [0, 1]. */
export const clamp = (conf: number): Confidence =>
  Math.min(1, Math.max(0, conf))

/** @returns human-readable percentage text, rounded to two decimal places. */
export const format = (conf: Confidence): string => {
  const percent = conf * 100
  const rounded = Math.round(percent * 100) / 100
  return `${rounded}%`
}

/** @returns lossless canonical percentage text for finite confidence in [0, 1]. */
export const formatExact = (conf: Confidence): string => {
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    throw new RangeError('confidence must be finite and between 0 and 1')
  }
  return `${shiftDecimal(String(conf), 2)}%`
}
