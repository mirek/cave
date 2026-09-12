import type { Rational } from './model.ts'
import { numericDigits } from './numeric-size.ts'

/** Conservative pre-allocation bounds for local fraction arithmetic, not a time or heap limit. */
export class ExplanationBudget {
  readonly maximum: number
  readonly maximumWork: number
  private used = 0
  constructor(maximum: number, maximumWork = Number.MAX_SAFE_INTEGER) {
    this.maximum = maximum
    this.maximumWork = maximumWork
  }

  check(...bounds: number[]): void {
    const actual = Math.max(0, ...bounds)
    if (actual > this.maximum) {
      throw new RangeError(`explanation exceeds maxExplanationBits: estimated ${actual} > ${this.maximum}`)
    }
    if (actual > this.maximumWork - this.used) {
      throw new RangeError(`explanation exceeds maxExplanationWork: estimated ${actual} with ${this.maximumWork - this.used} remaining`)
    }
    this.used += actual
  }

  input(value: Rational): void {
    // Four bits per decimal digit also bounds either member of an unreduced pair.
    // Charge text before Exact can allocate powers of ten or parse large BigInts.
    this.check(numericDigits(value, 'real') * 4)
  }

  bits(value: bigint): number {
    return value === 0n ? 0 : (value < 0n ? -value : value).toString(2).length
  }

  product(left: bigint, right: bigint): number {
    if (left === 0n || right === 0n) return 0
    if (left === 1n || left === -1n) return this.bits(right)
    if (right === 1n || right === -1n) return this.bits(left)
    return this.bits(left) + this.bits(right)
  }

  sum(left: bigint, right: bigint): number {
    if (left === 0n) return this.bits(right)
    if (right === 0n) return this.bits(left)
    return Math.max(this.bits(left), this.bits(right)) + 1
  }
}
