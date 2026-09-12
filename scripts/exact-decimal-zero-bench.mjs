/** Run alone: decimal suffix cancellation before bigint normalization. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Exact } from '../packages/solver/src/index.ts'

for (const zeros of [1000, 10000, 100000]) {
  for (const [prefix, expected] of [
    ['1.', { numerator: '1', denominator: '1' }],
    ['-0.125', { numerator: '-1', denominator: '8' }]
  ]) {
    const input = prefix + '0'.repeat(zeros)
    assert.deepEqual(Exact.rational(input), expected)
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const result = Exact.rational(input)
      samples.push(performance.now() - start)
      assert.deepEqual(result, expected)
    }
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, zeros, prefix, medianMs: samples[2] }))
  }
}
