/** Run alone; timings describe this machine, not a test threshold. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { add, compare } from '../packages/scenario/src/exact.ts'

for (const digits of [1000, 4000, 16000, 64000]) {
  const denominator = 10n ** BigInt(digits)
  const left = { numerator: String(denominator - 1n), denominator: String(denominator) }
  const right = { numerator: String(denominator - 3n), denominator: left.denominator }
  const expected = { numerator: String(denominator / 2n - 1n), denominator: String(denominator / 4n) }
  for (const [operation, run, result] of [
    ['add', () => add(left, right), expected],
    ['compare', () => compare(left, right), 1]
  ]) {
    const samples = []
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now()
      const actual = run()
      samples.push(performance.now() - start)
      assert.deepEqual(actual, result)
    }
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, digits, operation, medianMs: samples[1] }))
  }
}

// Unequal-denominator controls make sign/numerator shortcuts measurable.
for (const digits of [10000, 100000]) {
  const n = 10n ** BigInt(digits)
  const cases = [
    ['opposite-sign', { numerator: String(1n - n), denominator: String(n + 1n) }, { numerator: String(n - 3n), denominator: String(n + 7n) }],
    ['equal-numerator', { numerator: String(n - 1n), denominator: String(n + 1n) }, { numerator: String(n - 1n), denominator: String(n + 7n) }],
    ['general', { numerator: String(n - 1n), denominator: String(n + 1n) }, { numerator: String(n - 3n), denominator: String(n + 7n) }]
  ]
  for (const [shape, left, right] of cases) {
    const delta = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator)
    const expected = delta < 0n ? -1 : delta > 0n ? 1 : 0
    const warmups = 2, sampleCount = 11, samples = []
    for (let i = 0; i < warmups + sampleCount; i++) {
      const start = performance.now()
      const actual = compare(left, right)
      const elapsed = performance.now() - start
      assert.equal(actual, expected)
      if (i >= warmups) samples.push(elapsed)
    }
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({
      node: process.version, platform: process.platform, arch: process.arch,
      digits, operation: 'compare', shape, warmups, sampleCount,
      medianMs: samples[Math.floor(samples.length / 2)],
      timingScope: 'comparison including BigInt parsing; fixture construction and assertions excluded'
    }))
  }
}
