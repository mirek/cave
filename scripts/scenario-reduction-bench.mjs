/** Run alone: consecutive Fibonacci fractions stress scenario reduction. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { add, convert } from '../packages/scenario/src/exact.ts'

const fib = index => {
  if (index === 0) return [0n, 1n]
  const [a, b] = fib(Math.floor(index / 2))
  const c = a * (2n * b - a), d = a * a + b * b
  return index % 2 === 0 ? [c, d] : [d, c + d]
}
for (const index of [5000, 25000, 50000, 100000]) {
  const [a, b] = fib(index)
  const exact = { numerator: String(a), denominator: String(b) }
  const parsed = { exact: { numerator: '1', denominator: '1' }, unit: 's', approximate: false }
  for (const [operation, run] of [
    ['add-zero', () => add({ numerator: '0', denominator: '1' }, exact)],
    ['convert', () => convert(parsed, 'ms', [{ from: 's', to: 'ms', factor: exact }], 'bench').exact]
  ]) {
    const samples = []
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now()
      const result = run()
      samples.push(performance.now() - start)
      assert.deepEqual(result, exact)
    }
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, index, digits: exact.numerator.length + exact.denominator.length,
      operation, medianMs: samples[1] }))
  }
}
