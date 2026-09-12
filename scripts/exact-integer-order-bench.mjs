/** Run alone: canonical integer ordering versus reparsing normalized magnitudes. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Exact } from '../packages/solver/src/index.ts'

const reference = (left, right) => {
  const a = Exact.rational(left), b = Exact.rational(right)
  const x = BigInt(a.numerator), y = BigInt(b.numerator)
  return x < y ? -1 : x > y ? 1 : 0
}

for (const digits of [1000, 100000, 1000000]) {
  for (const sign of [1, -1]) {
    const prefix = sign === -1 ? '-' : ''
    const left = prefix + '9'.repeat(digits), right = prefix + '8'.repeat(digits)
    assert.equal(Exact.rational(left).denominator, '1')
    assert.equal(Exact.rational(right).denominator, '1')
    for (const [mode, compare] of [['bigint-reference', reference], ['text-order', Exact.compare]]) {
      const samples = []
      for (let sample = 0; sample < 9; sample++) {
        const start = performance.now()
        const result = compare(left, right)
        const elapsed = performance.now() - start
        assert.equal(result, sign)
        if (sample >= 2) samples.push(elapsed)
      }
      console.log(JSON.stringify({ node: process.version, digits, sign, mode,
        warmups: 2, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3],
        timingScope: 'comparison including normalization; fixture and assertion excluded' }))
    }
  }
}
