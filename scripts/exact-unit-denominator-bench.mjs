import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { rational } from '../packages/solver/src/exact.ts'

// Run alone. Denominator 3 controls for the general normalization path.
for (const digits of [1_000, 100_000, 1_000_000]) for (const denominator of ['1', '-1', '3']) {
  const unsigned = `1${'0'.repeat(digits - 1)}`
  const input = { numerator: `+000${unsigned}`, denominator }
  const expected = { numerator: denominator === '-1' ? `-${unsigned}` : unsigned,
    denominator: denominator === '-1' ? '1' : denominator }
  assert.deepEqual(rational(input), expected)
  const samples = []
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now()
    const result = rational(input)
    samples.push(performance.now() - start)
    assert.deepEqual(result, expected)
  }
  samples.sort((a, b) => a - b)
  console.log(JSON.stringify({ node: process.version, digits, denominator, medianMs: samples[2] }))
}
