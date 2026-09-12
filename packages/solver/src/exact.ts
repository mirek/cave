import { diagnosticText } from './diagnostic-text.ts'
import { gcd } from './integer-gcd.ts'
import type { Integer, Rational } from './model.ts'

export type Normalized = {
  readonly numerator: string
  readonly denominator: string
}

const integerPattern = /^[+-]?\d+$/
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

const assertIntegerText = (input: string): void => {
  if (input.match(integerPattern)?.[0] !== input) {
    throw new TypeError(`expected an integer string, received ${diagnosticText(input)}`)
  }
}

export const integer = (input: Integer): bigint => {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      throw new TypeError(`expected a safe integer, received ${String(input)}`)
    }
    return BigInt(input)
  }
  if (typeof input !== 'string') {
    throw new TypeError('expected a safe integer number or an integer string')
  }
  assertIntegerText(input)
  return BigInt(input)
}

const decimalParts = (input: string): { coefficient: string, exponent: number } => {
  if (input.match(decimalPattern)?.[0] !== input) {
    throw new TypeError(`expected an exact decimal string, received ${diagnosticText(input)}`)
  }
  const [coefficient = '', exponentText] = input.toLowerCase().split('e')
  const exponent = exponentText === undefined ? 0 : Number(exponentText)
  if (!Number.isSafeInteger(exponent)) {
    throw new TypeError(`decimal exponent is outside the supported range: ${diagnosticText(input)}`)
  }
  return { coefficient, exponent }
}

const decimal = (input: string): Normalized => {
  const { coefficient, exponent } = decimalParts(input)
  const negative = coefficient.startsWith('-')
  const unsigned = coefficient.replace(/^[+-]/, '')
  const [whole = '', fraction = ''] = unsigned.split('.')
  const digits = `${whole === '' ? '0' : whole}${fraction}`
  let scale = fraction.length - exponent
  let magnitude = digits.replace(/^0+/, '')
  if (magnitude === '') return { numerator: '0', denominator: '1' }
  // Cancel powers of ten in text before allocating either bigint operand.
  let cancelled = 0
  while (cancelled < scale && magnitude[magnitude.length - cancelled - 1] === '0') cancelled++
  if (cancelled > 0) {
    magnitude = magnitude.slice(0, -cancelled)
    scale -= cancelled
  }
  if (scale <= 0) {
    return { numerator: `${negative ? '-' : ''}${magnitude}${'0'.repeat(-scale)}`, denominator: '1' }
  }
  return fromBigInts(BigInt(magnitude) * (negative ? -1n : 1n), 10n ** BigInt(scale))
}

const assertRationalObject = (input: unknown): void => {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('expected an exact decimal string or a numerator/denominator object')
  }
}

export const rational = (input: Rational): Normalized => {
  let numerator = 0n
  let denominator: bigint
  if (typeof input === 'string') {
    return decimal(input)
  } else {
    assertRationalObject(input)
    const suppliedNumerator = input.numerator
    const numeratorText = typeof suppliedNumerator === 'string' ? suppliedNumerator : undefined
    let zero: boolean
    if (numeratorText !== undefined) {
      assertIntegerText(numeratorText)
      zero = !/[1-9]/.test(numeratorText)
    } else {
      numerator = integer(suppliedNumerator)
      zero = numerator === 0n
    }
    const suppliedDenominator = input.denominator
    if (zero && typeof suppliedDenominator === 'string') {
      assertIntegerText(suppliedDenominator)
      if (!/[1-9]/.test(suppliedDenominator)) {
        throw new TypeError('rational denominator must not be zero')
      }
      return { numerator: '0', denominator: '1' }
    }
    denominator = integer(suppliedDenominator)
    if (numeratorText !== undefined) {
      if (denominator === 1n || denominator === -1n) {
        const magnitude = numeratorText.replace(/^[+-]?0*/, '')
        const negative = numeratorText.startsWith('-') !== (denominator === -1n)
        return { numerator: magnitude === '' ? '0' : `${negative ? '-' : ''}${magnitude}`, denominator: '1' }
      }
      numerator = BigInt(numeratorText)
    }
  }
  return fromBigInts(numerator, denominator)
}

/** Normalize integer intermediates without serializing and parsing them again. */
export const fromBigInts = (numerator: bigint, denominator: bigint): Normalized => {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
    throw new TypeError('expected bigint numerator and denominator')
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

/** Compare canonical integer text without allocating bigint magnitudes. */
const integerOrder = (left: string, right: string): -1 | 0 | 1 => {
  if (left === right) return 0
  const negative = left.startsWith('-')
  if (negative !== right.startsWith('-')) return negative ? -1 : 1
  const a = negative ? left.slice(1) : left
  const b = negative ? right.slice(1) : right
  const order = a.length === b.length ? (a < b ? -1 : 1) : a.length < b.length ? -1 : 1
  return negative ? (order === -1 ? 1 : -1) : order
}

export const compare = (left: Rational, right: Rational): -1 | 0 | 1 => {
  const a = rational(left)
  const b = rational(right)
  const numerators = integerOrder(a.numerator, b.numerator)
  const negative = a.numerator.startsWith('-')
  if (a.denominator === b.denominator || a.numerator === '0' || b.numerator === '0' ||
      negative !== b.numerator.startsWith('-')) {
    return numerators
  }
  const denominators = integerOrder(a.denominator, b.denominator)
  if (numerators === 0) {
    // Equal denominators were handled above. A positive common numerator
    // reverses denominator order; a negative one preserves it.
    return negative ? denominators : denominators === -1 ? 1 : -1
  }
  // With equal signs, a smaller magnitude numerator and larger denominator
  // reinforce each other. Their ordering needs no cross-product allocation.
  if ((numerators < 0) === (negative ? denominators < 0 : denominators > 0)) {
    return numerators
  }
  const numeratorA = BigInt(a.numerator), numeratorB = BigInt(b.numerator)
  const denominatorA = BigInt(a.denominator), denominatorB = BigInt(b.denominator)
  const productA = numeratorA * denominatorB
  const productB = numeratorB * denominatorA
  return productA < productB ? -1 : productA > productB ? 1 : 0
}

const integerIsZero = (input: Integer): boolean => {
  if (typeof input !== 'string') return integer(input) === 0n
  assertIntegerText(input)
  return !/[1-9]/.test(input)
}

export const isZero = (input: Rational): boolean => {
  if (typeof input === 'string') return !/[1-9]/.test(decimalParts(input).coefficient)
  assertRationalObject(input)
  const zero = integerIsZero(input.numerator)
  if (integerIsZero(input.denominator)) throw new TypeError('rational denominator must not be zero')
  return zero
}
