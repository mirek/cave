/**
 * Valid time — periods, ranges, instants (spec §32).
 *
 * A date-like context names a calendar *period*, read as a UTC interval
 * `[start, end)`: `@2025` the year, `@2026-04` the month, `@2026-04-10`
 * the day, `@2026-Q1` / `@2026-H2` the quarter/half, `@2026-W15` the ISO
 * week. A *range* context joins two points with `..` — `@2025..2028`,
 * open-ended `@..2025` / `@2026..` — and covers whole periods at both
 * ends. Ranges are lexically ordinary contexts (spec §6.1 already admits
 * `.` in context atoms); this module is the semantic pass that reads
 * them, exactly like `REVERSE` declarations are ordinary claims read
 * semantically (spec §5.5).
 *
 * These are *valid-time* semantics — when a claim applies in the world —
 * independent of transaction time (when the store learned it, spec §9.1,
 * §12.3). `cave query --at` filters and interpolates on this axis.
 */

/** Calendar period as a UTC interval `[start, end)`, in ms since epoch. */
export type Period = {
  readonly start: number
  readonly end: number
}

export type t = Period

/** A query boundary as a UTC half-open interval. */
export type Boundary = Period

/** How a context reads as time: a point period, or a `..` range. */
export type TimeContext =
  | { readonly kind: 'point', readonly period: Period }
  | { readonly kind: 'range', readonly start?: Period, readonly end?: Period }

const dayMs = 86_400_000

const utcDay = (year: number, month: number, day: number): number =>
  Date.UTC(year, month - 1, day)

/** Monday starting ISO week `week` of `year` (ISO 8601: week 1 contains Jan 4). */
const isoWeekStart = (year: number, week: number): number => {
  const jan4 = utcDay(year, 1, 4)
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * dayMs
  return monday + (week - 1) * 7 * dayMs
}

const periodRe = /^(\d{4})(?:-(?:Q([1-4])|H([1-2])|W(\d{1,2})|(\d{2})(?:-(\d{2}))?))?$/

/**
 * Parses a date-like time point as the calendar period it names:
 * `2025`, `2026-04`, `2026-04-10`, `2026-Q1`, `2026-H2`, `2026-W15`.
 * @returns `undefined` when `text` is not a time point (including
 * out-of-calendar dates like `2026-02-30`).
 */
export const parsePeriod = (text: string): undefined | Period => {
  const match = periodRe.exec(text)
  if (!match) {
    return undefined
  }
  const year = Number(match[1])
  const [, , quarter, half, week, month, day] = match
  if (quarter !== undefined) {
    const q = Number(quarter)
    return { start: utcDay(year, (q - 1) * 3 + 1, 1), end: utcDay(year, q * 3 + 1, 1) }
  }
  if (half !== undefined) {
    const h = Number(half)
    return { start: utcDay(year, (h - 1) * 6 + 1, 1), end: utcDay(year, h * 6 + 1, 1) }
  }
  if (week !== undefined) {
    const w = Number(week)
    if (w < 1 || w > 53) {
      return undefined
    }
    const start = isoWeekStart(year, w)
    return { start, end: start + 7 * dayMs }
  }
  if (month !== undefined) {
    const m = Number(month)
    if (m < 1 || m > 12) {
      return undefined
    }
    if (day !== undefined) {
      const d = Number(day)
      const start = utcDay(year, m, d)
      const date = new Date(start)
      if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        return undefined
      }
      return { start, end: start + dayMs }
    }
    return { start: utcDay(year, m, 1), end: utcDay(year, m + 1, 1) }
  }
  return { start: utcDay(year, 1, 1), end: utcDay(year + 1, 1, 1) }
}

const numericPointRe = /^[\d-]+$/

/**
 * Parses a `A..B` / `..B` / `A..` time range. The end point of a closed
 * range may abbreviate by dropping *leading* numeric segments, inherited
 * from the start point (spec §32.2): `2026-04-10..04-11` reads as
 * `2026-04-10..2026-04-11`, `2026-04-10..11` likewise. `Q`/`H`/`W`
 * points are always written in full. A closed range must be non-empty
 * (`2028..2025` is not a time range).
 * @returns `undefined` when `text` is not a range.
 */
export const parseRange = (text: string): undefined | { start?: Period, end?: Period } => {
  const at = text.indexOf('..')
  if (at === -1 || text.indexOf('..', at + 2) !== -1) {
    return undefined
  }
  const leftText = text.slice(0, at)
  const rightText = text.slice(at + 2)
  if (leftText === '' && rightText === '') {
    return undefined
  }
  if (leftText === '') {
    const end = parsePeriod(rightText)
    return end === undefined ? undefined : { end }
  }
  const start = parsePeriod(leftText)
  if (start === undefined) {
    return undefined
  }
  if (rightText === '') {
    return { start }
  }
  let end = parsePeriod(rightText)
  if (end === undefined && numericPointRe.test(leftText) && numericPointRe.test(rightText)) {
    const leftSegments = leftText.split('-')
    const rightSegments = rightText.split('-')
    if (rightSegments.length < leftSegments.length) {
      end = parsePeriod([...leftSegments.slice(0, leftSegments.length - rightSegments.length), ...rightSegments].join('-'))
    }
  }
  if (end === undefined || end.end <= start.start) {
    return undefined
  }
  return { start, end }
}

/**
 * Reads a context as time, when it is one (spec §32.2): a bare or
 * `time:`-prefixed date-like point or `..` range. Every other context —
 * `production`, `src:filing`, `auth.ts:42` — is opaque and returns
 * `undefined`; a context that fails to parse as time is opaque too, the
 * robust-extraction default (spec §1.6).
 */
export const ofContext = (context: string): undefined | TimeContext => {
  const body = context.startsWith('time:') ? context.slice('time:'.length) : context
  if (body.includes('..')) {
    const range = parseRange(body)
    return range === undefined ? undefined : { kind: 'range', ...range }
  }
  const period = parsePeriod(body)
  return period === undefined ? undefined : { kind: 'point', period }
}

const timestampRe = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([zZ]|[+-]\d{2}:\d{2})?$/

/**
 * Parses an ISO timestamp into a UTC instant. An omitted offset means UTC,
 * never the host's local timezone; explicit `Z` and numeric offsets retain
 * their usual ISO meaning. Date and clock fields are validated before the
 * platform parser can normalize them.
 */
export const parseTimestamp = (text: string): undefined | number => {
  const match = timestampRe.exec(text)
  if (match === null) return undefined
  const [, date, hour, minute, second, , zone] = match
  if (parsePeriod(date!) === undefined || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return undefined
  }
  if (zone !== undefined && zone !== 'Z' && zone !== 'z') {
    const [offsetHour, offsetMinute] = zone.slice(1).split(':').map(Number)
    if (offsetHour! > 23 || offsetMinute! > 59) return undefined
  }
  const parsed = Date.parse(zone === undefined ? `${text}Z` : text)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Parses the shared query-time boundary: a date-like period keeps its whole
 * UTC interval, while a timestamp covers one second from its exact instant.
 */
export const parseBoundary = (text: string): undefined | Boundary => {
  const period = parsePeriod(text)
  if (period !== undefined) return period
  const start = parseTimestamp(text)
  return start === undefined ? undefined : { start, end: start + 1_000 }
}

/**
 * Parses a query anchor into an instant (ms since epoch): a date-like
 * period reads as its *start* instant (`2026` is 2026-01-01T00:00:00Z —
 * name the finer period to anchor inside one), a `T` timestamp reads
 * exactly. @returns `undefined` when `text` is neither.
 */
export const parseInstant = (text: string): undefined | number => {
  return parseBoundary(text)?.start
}

/** @returns whether a time context covers the instant (spec §32.4). */
export const covers = (context: TimeContext, instant: number): boolean =>
  context.kind === 'point' ?
    instant >= context.period.start && instant < context.period.end :
    (context.start === undefined || instant >= context.start.start) &&
    (context.end === undefined || instant < context.end.end)

/**
 * Whether a claim with these contexts applies at the instant
 * (spec §32.4): timeless claims — no time context — always apply; a
 * time-anchored claim applies when *any* of its time contexts covers
 * the instant. Opaque contexts never participate.
 */
export const appliesAt = (contexts: readonly string[], instant: number): boolean => {
  let anchored = false
  for (const context of contexts) {
    const time = ofContext(context)
    if (time === undefined) {
      continue
    }
    anchored = true
    if (covers(time, instant)) {
      return true
    }
  }
  return !anchored
}

/**
 * The single closed range among a claim's contexts — the interval a
 * trajectory value interpolates over (spec §32.3). @returns `undefined`
 * when there is none, or more than one (ambiguous — no interpolation).
 */
export const closedRangeOf = (contexts: readonly string[]): undefined | { start: Period, end: Period } => {
  let found: undefined | { start: Period, end: Period }
  for (const context of contexts) {
    const time = ofContext(context)
    if (time === undefined || time.kind !== 'range' || time.start === undefined || time.end === undefined) {
      continue
    }
    if (found !== undefined) {
      return undefined
    }
    found = { start: time.start, end: time.end }
  }
  return found
}

/**
 * Where an instant sits along a closed range, as the interpolation
 * fraction in [0, 1] (spec §32.3): endpoint values anchor at the *start*
 * instants of the periods that name them — `20B -> 40B @2025..2028` is
 * 20B at 2025-01-01 and 40B at 2028-01-01 — and the fraction clamps to 1
 * through the end period's tail ("40B *in* 2028" holds all of 2028).
 */
export const fractionAt = (range: { start: Period, end: Period }, instant: number): number => {
  const span = range.end.start - range.start.start
  if (span <= 0) {
    return 1
  }
  return Math.min(1, Math.max(0, (instant - range.start.start) / span))
}
