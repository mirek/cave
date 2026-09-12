/** Run alone: public exact comparisons that require unequal cross-products. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Exact } from '../packages/solver/src/index.ts'

const reference = (left, right) => {
  const a = Exact.rational(left), b = Exact.rational(right)
  const x = BigInt(a.numerator) * BigInt(b.denominator)
  const y = BigInt(b.numerator) * BigInt(a.denominator)
  return x < y ? -1 : x > y ? 1 : 0
}

for (const digits of [1000, 10000, 100000]) {
  const n = 10n ** BigInt(digits)
  for (const sign of [1n, -1n]) {
    const left = { numerator: String(sign * (n + 1n)), denominator: String(n + 3n) }
    const right = { numerator: String(sign * (n + 4n)), denominator: String(n + 7n) }
    // Positive cross-products differ by n - 5; neither fraction reduces.
    const expected = Number(sign)
    for (const [mode, compare] of [['reference', reference], ['current', Exact.compare]]) {
      const samples = []
      for (let sample = 0; sample < 9; sample++) {
        const start = performance.now()
        const result = compare(left, right)
        const elapsed = performance.now() - start
        assert.equal(result, expected)
        if (sample >= 2) samples.push(elapsed)
      }
      console.log(JSON.stringify({ node: process.version, digits, sign: Number(sign), mode,
        warmups: 2, samplesMs: samples, medianMs: [...samples].sort((a, b) => a - b)[3],
        timingScope: 'comparison including normalization; fixture and assertion excluded' }))
    }
  }
}
