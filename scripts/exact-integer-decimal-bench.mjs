import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { rational } from '../packages/solver/src/exact.ts'

// Run alone; negative exponents control for fractional decimal reduction.
for (const exponent of [1_000, 100_000, 1_000_000]) for (const direction of [1, -1]) {
  const input = `+001.25e${direction * exponent}`
  const expected = direction === 1
    ? { numerator: `125${'0'.repeat(exponent - 2)}`, denominator: '1' }
    : { numerator: '1', denominator: `8${'0'.repeat(exponent - 1)}` }
  assert.deepEqual(rational(input), expected)
  const samples = []
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now()
    const result = rational(input)
    samples.push(performance.now() - start)
    assert.deepEqual(result, expected)
  }
  samples.sort((a, b) => a - b)
  console.log(JSON.stringify({ node: process.version, exponent, direction, medianMs: samples[2] }))
}
