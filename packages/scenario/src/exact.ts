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

const reduce = (numerator: bigint, denominator: bigint): ExactNumber => {
  const divisor = (() => {
    let left = numerator < 0n ? -numerator : numerator
    let right = denominator < 0n ? -denominator : denominator
    while (right !== 0n) [left, right] = [right, left % right]
    return left
  })()
  const sign = denominator < 0n ? -1n : 1n
  return {
    numerator: String((numerator / divisor) * sign),
    denominator: String((denominator / divisor) * sign)
  }
}

const multiply = (left: ExactNumber, right: ExactNumber): ExactNumber =>
  reduce(BigInt(left.numerator) * BigInt(right.numerator), BigInt(left.denominator) * BigInt(right.denominator))

export const add = (left: ExactNumber, right: ExactNumber): ExactNumber =>
  reduce(
    BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(left.denominator) * BigInt(right.denominator)
  )

export const compare = (left: ExactNumber, right: ExactNumber): number =>
  BigInt(left.numerator) * BigInt(right.denominator) < BigInt(right.numerator) * BigInt(left.denominator) ? -1 :
    BigInt(left.numerator) * BigInt(right.denominator) > BigInt(right.numerator) * BigInt(left.denominator) ? 1 : 0

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
    exact: reduce(BigInt(base.numerator) * factor, BigInt(base.denominator)),
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
