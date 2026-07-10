/**
 * Values, units and multipliers (spec §7.1), and trajectories (spec §32.3).
 *
 * A value is the payload of an attribute claim (`HAS attr: value`), a metric
 * claim (`metric IS value`), or a `+/-` uncertainty delta. Parsing keeps the
 * raw text verbatim and additionally extracts a normalized numeric value and
 * unit when possible (spec §13.4 steps 7–9):
 *
 * - `30ms`           → num 30, unit `ms`
 * - `20B USD/yr`     → num 20000000000, unit `USD/yr`
 * - `~20B USD/yr`    → the same, `approx` set
 * - `94.5%`          → num 94.5, unit `%`
 * - `20 conn`        → num 20, unit `conn`
 * - `20B -> 40B USD/yr` → trajectory, from 2e10 to 4e10, unit `USD/yr`
 * - `2026-H2`        → date-like, kept textual
 * - `token-expiry`   → atom, kept textual
 *
 * Quoted (`"..."`) and backticked (`` `...` ``) values arrive from the parser
 * with their kind already known; use {@link ofText} / {@link ofCode}.
 */

import * as Multiplier from './multiplier.ts'

/** How the value text was classified. */
export type Kind =
  | 'number'     // numeric, possibly with multiplier and unit
  | 'trajectory' // two numeric endpoints: 20B -> 40B USD/yr (spec §32.3)
  | 'date'       // date-like: 2026-H2, 2026-Q1, 2026-04-10
  | 'atom'       // bare word(s): token-expiry, critical
  | 'text'       // double-quoted natural-language literal
  | 'code'       // backticked exact literal

export type Value = {
  /** Exactly as written, including `~` and multiplier letter. */
  readonly raw: string
  readonly kind: Kind
  /** `~` prefix (spec §7.1): the value is approximate. */
  readonly approx: boolean
  /**
   * Normalized numeric value with multiplier expanded, when parseable.
   * Unset for trajectories — a trajectory is not one number, so every
   * scalar consumer (fusion, filters, σ) conservatively skips it.
   */
  readonly num?: number
  /** Normalized unit expression (`USD/yr`, `ms`, `%`), when present. */
  readonly unit?: string
  /** Trajectory start value, multiplier expanded (kind `trajectory`). */
  readonly from?: number
  /** Trajectory end value, multiplier expanded (kind `trajectory`). */
  readonly to?: number
}

export type t = Value

const numberRe = /^(-?\d+(?:\.\d+)?)([A-Za-z%]*)$/
const unitRe = /^[A-Za-z%$][A-Za-z0-9%$]*(?:\/[A-Za-z0-9%$]+)*$/
const dateRe = /^\d{4}-(?:H[1-2]|Q[1-4]|W\d{1,2}|\d{2})(?:-\d{2})?$/

/** @returns `true` if `s` is a valid unit expression (`USD/yr`, `ms`, `%`). */
export const isUnit = (s: string): boolean =>
  unitRe.test(s)

/**
 * @returns `true` if `s` is date-like (spec §16 `date_like`): `2026-H2`,
 * `2026-Q1`, `2026-04`, `2026-04-10`. A bare year parses as a number instead.
 */
export const isDateLike = (s: string): boolean =>
  dateRe.test(s)

type Numeric = { num: number, unit?: string }

/**
 * Parses `body` as number [multiplier] [unit] where the unit is either glued
 * (`30ms`, `94.5%`) or space-separated (`20B USD/yr`, `20 conn`).
 * @returns `undefined` when `body` is not numeric.
 */
const parseNumeric = (body: string): undefined | Numeric => {
  const spaceAt = body.indexOf(' ')
  const head = spaceAt === -1 ? body : body.slice(0, spaceAt)
  const tail = spaceAt === -1 ? undefined : body.slice(spaceAt + 1).trim()
  const match = numberRe.exec(head)
  if (!match) {
    return undefined
  }
  const [, digits, glued] = match
  let num = Number(digits)
  let unit: undefined | string
  if (glued !== undefined && glued !== '') {
    if (Multiplier.is(glued)) {
      num *= Multiplier.factor(glued)
    } else if (isUnit(glued)) {
      unit = glued
    } else {
      return undefined
    }
  }
  if (tail !== undefined) {
    if (unit !== undefined || !isUnit(tail)) {
      return undefined
    }
    unit = tail
  }
  return unit === undefined ? { num } : { num, unit }
}

type Trajectory = Numeric & {
  to: number
  /** The unit was glued to the endpoint numbers (`5ms -> 800ms`). */
  glued: boolean
  /** An endpoint used a multiplier letter (`20B -> 40B`). */
  multiplier: boolean
}

const multiplierHeadRe = /^-?\d+(?:\.\d+)?[TBMK]$/

/**
 * Splits `body` as trajectory `from -> to [unit]` (spec §32.3). Each side
 * parses like a scalar; the unit is shared — glued per endpoint or spaced
 * after either — and both sides naming different units is not a
 * trajectory. Style (glue, multipliers) is kept for {@link formatAt}.
 */
const parseTrajectory = (body: string): undefined | Trajectory => {
  const parts = body.split(' -> ')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return undefined
  }
  const [leftText, rightText] = parts as [string, string]
  const left = parseNumeric(leftText)
  const right = parseNumeric(rightText)
  if (left === undefined || right === undefined) {
    return undefined
  }
  if (left.unit !== undefined && right.unit !== undefined && left.unit !== right.unit) {
    return undefined
  }
  const unit = left.unit ?? right.unit
  return {
    num: left.num,
    to: right.num,
    ...unit === undefined ? {} : { unit },
    glued: unit !== undefined && !leftText.includes(' ') && !rightText.includes(' '),
    multiplier: multiplierHeadRe.test(leftText.split(' ')[0]!) || multiplierHeadRe.test(rightText.split(' ')[0]!)
  }
}

/**
 * Parses an unquoted value string (spec §16 `value`), classifying it as
 * number, trajectory, date or atom. The raw text (including `~` and
 * multiplier letters) is preserved verbatim.
 */
export const parse = (raw: string): Value => {
  const approx = raw.startsWith('~')
  const body = approx ? raw.slice(1) : raw
  const trajectory = body.includes(' -> ') ? parseTrajectory(body) : undefined
  if (trajectory !== undefined) {
    return {
      raw, kind: 'trajectory', approx, from: trajectory.num, to: trajectory.to,
      ...trajectory.unit === undefined ? {} : { unit: trajectory.unit }
    }
  }
  const numeric = parseNumeric(body)
  if (numeric !== undefined) {
    return numeric.unit === undefined ?
      { raw, kind: 'number', approx, num: numeric.num } :
      { raw, kind: 'number', approx, num: numeric.num, unit: numeric.unit }
  }
  if (isDateLike(body)) {
    return { raw, kind: 'date', approx }
  }
  return { raw, kind: 'atom', approx }
}

/**
 * Linear interpolation of a trajectory at `fraction` ∈ [0, 1], clamped
 * (spec §32.3). @returns `undefined` for non-trajectory values.
 */
export const interpolate = (value: Value, fraction: number): undefined | number =>
  value.from === undefined || value.to === undefined ?
    undefined :
    value.from + (value.to - value.from) * Math.min(1, Math.max(0, fraction))

/**
 * Canonical scalar text of a trajectory at `fraction`, in the
 * trajectory's own style (spec §32.3): multipliers re-compress when the
 * endpoints used them, a glued unit stays glued, 4 significant digits.
 * `20B -> 40B USD/yr` at 0.5 → `30B USD/yr`; `5ms -> 800ms` at 0.5 →
 * `402.5ms`. @returns `undefined` for non-trajectory values.
 */
export const formatAt = (value: Value, fraction: number): undefined | string => {
  const num = interpolate(value, fraction)
  if (num === undefined) {
    return undefined
  }
  const style = parseTrajectory(value.approx ? value.raw.slice(1) : value.raw)
  let scaled = num
  let letter = ''
  if (style?.multiplier === true) {
    for (const m of ['T', 'B', 'M', 'K'] as const) {
      if (Math.abs(num) >= Multiplier.factor(m)) {
        scaled = num / Multiplier.factor(m)
        letter = m
        break
      }
    }
  }
  const digits = Number(scaled.toPrecision(4)).toString()
  return value.unit === undefined ?
    `${digits}${letter}` :
    `${digits}${letter}${style?.glued === true ? '' : ' '}${value.unit}`
}

/** @returns value for a double-quoted natural-language literal (spec §4.2). */
export const ofText = (text: string): Value =>
  ({ raw: text, kind: 'text', approx: false })

/** @returns value for a backticked exact code literal (spec §4.2). */
export const ofCode = (code: string): Value =>
  ({ raw: code, kind: 'code', approx: false })

/**
 * @returns canonical text of the value for emission. Raw text is already
 * canonical (spec normalizes multipliers only in storage, never in text);
 * quoted kinds are re-wrapped in their delimiters.
 */
export const format = (value: Value): string => {
  switch (value.kind) {
    case 'text':
      return `"${value.raw}"`
    case 'code':
      return `\`${value.raw}\``
    default:
      return value.raw
  }
}
