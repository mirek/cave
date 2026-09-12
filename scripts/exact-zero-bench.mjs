/** Run alone: zero detection versus full rational normalization. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Exact } from '../packages/solver/src/index.ts'

for (const digits of [1000, 100000, 1000000]) {
  const magnitude = '1' + '0'.repeat(digits - 2)
  for (const zero of [false, true]) {
    const input = { numerator: zero ? '-000' : magnitude + '1', denominator: magnitude + '7' }
    for (const [mode, isZero] of [
      ['normalization-reference', input => Exact.rational(input).numerator === '0'],
      ['zero-detection', Exact.isZero]
    ]) {
      const samples = []
      for (let sample = 0; sample < 9; sample++) {
        const start = performance.now()
        const result = isZero(input)
        const elapsed = performance.now() - start
        assert.equal(result, zero)
        if (sample >= 2) samples.push(elapsed)
      }
      console.log(JSON.stringify({ node: process.version, digits, zero, mode,
        warmups: 2, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3],
        timingScope: 'zero detection including validation; fixture and assertion excluded' }))
    }
  }
}
