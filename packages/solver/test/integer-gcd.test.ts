import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { gcd } from '../src/integer-gcd.ts'
import { Exact } from '@cavelang/solver'

const reference = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

test('batched GCD agrees with Euclid across signs, zero, sizes and shared factors', () => {
  let seed = 123456789n
  const random = (bits: number): bigint => {
    let value = 0n
    for (let i = 0; i < bits; i += 32) {
      seed = (1664525n * seed + 1013904223n) & 0xffffffffn
      value = (value << 32n) | seed
    }
    return value
  }
  const pairs: [bigint, bigint][] = [[0n, 0n], [0n, 17n], [1n, 1n]]
  for (const bits of [32, 64, 96, 128, 512, 1024, 1056, 2048, 8192]) {
    for (let i = 0; i < 20; i++) {
      const a = random(bits), b = random(bits), factor = random(96)
      pairs.push([a, b], [a * factor, b * factor], [a, 1n], [a, a], [a, a + 1n])
    }
    pairs.push([1n << BigInt(bits), (1n << BigInt(bits)) - 1n], [(1n << BigInt(bits * 3)) + 3n, (1n << BigInt(bits)) + 1n])
  }
  for (const [a, b] of pairs) for (const sign of [-1n, 1n]) {
    const expected = reference(a, b)
    assert.equal(gcd(sign * a, b), expected)
    assert.equal(gcd(b, sign * a), expected)
    if (b !== 0n) assert.deepEqual(Exact.rational({ numerator: String(sign * a), denominator: String(-b) }), {
      numerator: String(-sign * a / expected), denominator: String(b / expected)
    })
  }
})

test('large consecutive Fibonacci fractions reduce exactly with a shared factor', () => {
  let a = 0n, b = 1n
  for (let i = 0; i < 25000; i++) [a, b] = [b, a + b]
  const factor = (1n << 1024n) + 17n
  assert.equal(gcd(a, b), 1n)
  assert.equal(gcd(a * factor, b * factor), factor)
  assert.deepEqual(Exact.rational({ numerator: String(-a * factor), denominator: String(-b * factor) }), {
    numerator: String(a), denominator: String(b)
  })
})
