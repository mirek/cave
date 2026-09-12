import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'

// Run alone: setup and correctness checks stay outside measured calls.
for (const pairs of [100, 1_000, 5_000]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: pairs }, (_, index) =>
      `hidden-${index} IS retained #sensitivity:restricted\n  WHEN condition-${index} IS satisfied #sensitivity:restricted`).join('\n'), { strict: true })
    for (const current of [false, true]) {
      const options = { current, tx: true, maxSensitivity: 'public' }
      assert.equal(store.exportText(options), '')
      const timings = []
      for (let sample = 0; sample < 5; sample++) {
        const start = performance.now()
        const text = store.exportText(options)
        timings.push(performance.now() - start)
        assert.equal(text, '')
      }
      timings.sort((a, b) => a - b)
      console.log(JSON.stringify({ node: process.version, claims: pairs * 2, edges: pairs, current, medianMs: timings[2] }))
    }
  } finally { store.close() }
}
