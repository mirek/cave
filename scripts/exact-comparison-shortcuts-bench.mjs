/** Run alone: comparisons whose order does not require cross-products. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Exact } from '../packages/solver/src/index.ts'
for (const digits of [10, 1000, 10000, 100000]) {
  const numerator = '1' + '0'.repeat(digits)
  const firstDenominator = '1' + '0'.repeat(digits - 1) + '1'
  const secondDenominator = '1' + '0'.repeat(digits - 1) + '3'
  for (const [operation, left, right, expected] of [
    ['opposite-signs', { numerator, denominator: firstDenominator }, { numerator: '-' + numerator, denominator: secondDenominator }, 1],
    ['same-positive-numerator', { numerator, denominator: firstDenominator }, { numerator, denominator: secondDenominator }, 1],
    ['same-negative-numerator', { numerator: '-' + numerator, denominator: firstDenominator }, { numerator: '-' + numerator, denominator: secondDenominator }, -1]
  ]) {
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const result = Exact.compare(left, right)
      samples.push(performance.now() - start)
      assert.equal(result, expected)
    }
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, digits, operation, medianMs: samples[2] }))
  }
}
