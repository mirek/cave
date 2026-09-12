import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fuse } from '../packages/fusion/src/fuse.ts'

// Run alone. Two untimed warmups and nine single-call samples per fixture.
// Construction and correctness checks are outside each timing interval.
const results = []
for (const size of [128, 1024, 8192]) {
  for (const kind of ['ordinary', 'large-positive', 'overflow-cancellation', 'finite-cancellation']) {
    const leading = kind === 'overflow-cancellation'
      ? [Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE]
      : kind === 'finite-cancellation' ? [1, -1] : []
    const mean = kind === 'ordinary' ? 42 : kind === 'large-positive' ? Number.MAX_VALUE
      : kind === 'overflow-cancellation' ? Number.MIN_VALUE : 3 * Number.MIN_VALUE
    const estimates = Object.freeze(Array.from({ length: size }, (_, index) => Object.freeze({
      mean: index < leading.length ? leading[index] : mean,
      sigma: index < leading.length || kind === 'large-positive' ? 1 : 2
    })))
    const expectedPrecision = leading.length + (size - leading.length) / (kind === 'large-positive' ? 1 : 4)
    const check = result => {
      assert.ok(result)
      assert.equal(result.mean, mean)
      assert.ok(Math.abs(result.precision / expectedPrecision - 1) < 1e-14)
      assert.ok(Math.abs(result.sigma * Math.sqrt(expectedPrecision) - 1) < 1e-14)
    }
    for (let index = 0; index < 2; index++) check(fuse(estimates))
    const samples = []
    for (let index = 0; index < 9; index++) {
      const start = performance.now()
      const result = fuse(estimates)
      const elapsedMs = performance.now() - start
      check(result)
      samples.push(elapsedMs)
    }
    results.push({ kind, size, samples, medianMs: [...samples].sort((a, b) => a - b)[4] })
  }
}
const sources = ['scripts/fusion-fallback-bench.mjs', 'packages/fusion/src/fuse.ts']
console.log(JSON.stringify({
  runtime: process.version, platform: process.platform, arch: process.arch,
  warmups: 2, samplesPerCase: 9, timing: 'one fuse call; construction and assertions excluded',
  sources: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  results
}, null, 2))
