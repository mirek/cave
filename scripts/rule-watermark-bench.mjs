/** Quiet derivation cost as the number of settled rules grows. Run in isolation. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { declareRules, derive } from '../packages/rules/src/index.ts'

console.log(JSON.stringify({ format: 'cave.rule-watermark-benchmark', version: 1,
  node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch }))
for (const count of [100, 500, 1000]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: count }, (_, i) => `item HAS input-${i}: value`).join('\n'))
    const declared = declareRules(store, Array.from({ length: count }, (_, i) =>
      `?x HAS input-${i}: ?value => ?x HAS output-${i}: ?value`).join('\n'))
    assert.deepEqual(declared.problems, [])
    const initial = derive(store)
    assert.equal(initial.complete, true)
    assert.equal(initial.appended, count)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const report = derive(store)
      samples.push(performance.now() - start)
      assert.equal(report.complete, true)
      assert.equal(report.rules.length, count)
      assert.equal(report.appended + report.updated + report.retracted, 0)
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ rules: count, samples: samples.length, medianMs: samples[2],
      minimumMs: samples[0], maximumMs: samples.at(-1), writes: 0 }))
  } finally { store.close() }
}

// Isolate hashing from store reads before attributing quiet-run cost to it.
const hashSamples = []
for (let sample = 0; sample < 7; sample++) {
  const start = performance.now()
  for (let i = 0; i < 1000; i++) {
    createHash('sha256').update(JSON.stringify(['v1-' + 'a'.repeat(64), false, 0.05])).digest('hex')
  }
  hashSamples.push(performance.now() - start)
}
hashSamples.sort((a, b) => a - b)
console.log(JSON.stringify({ phase: 'isolated-policy-hashing', hashes: 1000,
  samples: hashSamples.length, medianMs: hashSamples[3] }))
