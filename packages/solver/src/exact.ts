import type { Integer, Rational } from './model.ts'

export type Normalized = {
  readonly numerator: string
  readonly denominator: string
}

const integerPattern = /^[+-]?\d+$/
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

const gcd = (left: bigint, right: bigint): bigint => {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

export const integer = (input: Integer): bigint => {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      throw new TypeError(`expected a safe integer, received ${String(input)}`)
    }
    return BigInt(input)
  }
  if (!integerPattern.test(input)) {
    throw new TypeError(`expected an integer string, received ${JSON.stringify(input)}`)
  }
  return BigInt(input)
}

const decimal = (input: string): readonly [bigint, bigint] => {
  if (!decimalPattern.test(input)) {
    throw new TypeError(`expected an exact decimal string, received ${JSON.stringify(input)}`)
  }
  const [coefficient = '', exponentText] = input.toLowerCase().split('e')
  const exponent = exponentText === undefined ? 0 : Number(exponentText)
  if (!Number.isSafeInteger(exponent)) {
    throw new TypeError(`decimal exponent is outside the supported range: ${JSON.stringify(input)}`)
  }
  const negative = coefficient.startsWith('-')
  const unsigned = coefficient.replace(/^[+-]/, '')
  const [whole = '', fraction = ''] = unsigned.split('.')
  const digits = `${whole === '' ? '0' : whole}${fraction}`
  const scale = fraction.length - exponent
  const signed = BigInt(digits === '' ? '0' : digits) * (negative ? -1n : 1n)
  return scale <= 0
    ? [signed * (10n ** BigInt(-scale)), 1n]
    : [signed, 10n ** BigInt(scale)]
}

export const rational = (input: Rational): Normalized => {
  let numerator: bigint
  let denominator: bigint
  if (typeof input === 'string') {
    ;[numerator, denominator] = decimal(input)
  } else {
    numerator = integer(input.numerator)
    denominator = integer(input.denominator)
  }
  if (denominator === 0n) {
    throw new TypeError('rational denominator must not be zero')
  }
  if (denominator < 0n) {
    numerator = -numerator
    denominator = -denominator
  }
  const divisor = gcd(numerator, denominator)
  return {
    numerator: String(numerator / divisor),
    denominator: String(denominator / divisor)
  }
}

export const compare = (left: Rational, right: Rational): -1 | 0 | 1 => {
  const a = rational(left)
  const b = rational(right)
  const difference = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator)
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

export const isZero = (input: Rational): boolean => rational(input).numerator === '0'
