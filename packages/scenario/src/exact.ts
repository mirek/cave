import { Exact, type Model } from '@cavelang/solver'
import type { Conversion, ExactNumber } from './model.ts'
import { ScenarioInputError } from './error.ts'

const multiplier: Readonly<Record<string, bigint>> = {
  K: 1_000n,
  M: 1_000_000n,
  B: 1_000_000_000n,
  T: 1_000_000_000_000n
}

const hasMultiplier = (value: string): boolean => Object.hasOwn(multiplier, value)

type Parsed = {
  readonly exact: ExactNumber
  readonly unit?: string
  readonly approximate: boolean
}

const reduce = Exact.fromBigInts

const multiply = (left: ExactNumber, right: ExactNumber): ExactNumber =>
  reduce(BigInt(left.numerator) * BigInt(right.numerator), BigInt(left.denominator) * BigInt(right.denominator))

export const add = (left: ExactNumber, right: ExactNumber): ExactNumber => {
  const a = BigInt(left.numerator), b = BigInt(left.denominator)
  const c = BigInt(right.numerator), d = BigInt(right.denominator)
  return b === d ? reduce(a + c, b) : reduce(a * d + c * b, b * d)
}

export const compare = (left: ExactNumber, right: ExactNumber): number => {
  const a = BigInt(left.numerator), b = BigInt(left.denominator)
  const c = BigInt(right.numerator), d = BigInt(right.denominator)
  if (b > 0n && d > 0n) {
    if (b === d || a === 0n || c === 0n || (a < 0n) !== (c < 0n)) {
      return a < c ? -1 : a > c ? 1 : 0
    }
    if (a === c) return (b < d) === (a > 0n) ? 1 : -1
    if ((a < c) === (a > 0n ? b > d : b < d)) return a < c ? -1 : 1
  }
  // Scenario values are normalized with positive denominators. Other fraction
  // forms need the sign of the cross-products' common denominator as well.
  const difference = b === d && b > 0n ? a - c : a * d - c * b
  if (difference === 0n) return 0
  const order = difference < 0n ? -1 : 1
  return (b < 0n) !== (d < 0n) ? -order : order
}

const rational = (value: Model.Rational): ExactNumber => Exact.rational(value)

/** Parses CAVE's exact scalar spelling without passing the digits through `number`. */
export const parse = (authored: string, bindingId: string): Parsed => {
  const approximate = authored.startsWith('~')
  const body = approximate ? authored.slice(1) : authored
  const [head = '', ...tailParts] = body.trim().split(/\s+/)
  const tail = tailParts.length === 0 ? undefined : tailParts.join(' ')
  const match = /^([+-]?\d+(?:\.\d+)?)([A-Za-z%]*)$/.exec(head)
  if (match === null || tailParts.length > 1) {
    throw new ScenarioInputError('invalid-value', `expected a scalar number, received ${JSON.stringify(authored)}`, bindingId)
  }
  const digits = match[1]!
  const suffix = match[2] ?? ''
  const factor = hasMultiplier(suffix) ? multiplier[suffix]! : 1n
  const unit = hasMultiplier(suffix) ? tail : suffix === '' ? tail : suffix
  if (suffix !== '' && !hasMultiplier(suffix) && tail !== undefined) {
    throw new ScenarioInputError('invalid-value', `cannot combine glued unit ${JSON.stringify(suffix)} with ${JSON.stringify(tail)}`, bindingId)
  }
  const base = rational(digits)
  return {
    exact: factor === 1n ? base : reduce(BigInt(base.numerator) * factor, BigInt(base.denominator)),
    ...(unit === undefined ? {} : { unit }),
    approximate
  }
}

export const convert = (
  parsed: Parsed,
  expectedUnit: string | undefined,
  conversions: readonly Conversion[] | undefined,
  bindingId: string
): Parsed => {
  if (expectedUnit === undefined || parsed.unit === expectedUnit) return parsed
  if (parsed.unit === undefined) {
    throw new ScenarioInputError('incompatible-unit', `expected unit ${JSON.stringify(expectedUnit)}, received a unitless value`, bindingId)
  }
  const conversion = conversions?.find(item => item.from === parsed.unit && item.to === expectedUnit)
  if (conversion === undefined) {
    throw new ScenarioInputError(
      'incompatible-unit',
      `cannot convert ${JSON.stringify(parsed.unit)} to ${JSON.stringify(expectedUnit)} without an explicit conversion`,
      bindingId
    )
  }
  return { ...parsed, exact: multiply(parsed.exact, rational(conversion.factor)), unit: expectedUnit }
}
