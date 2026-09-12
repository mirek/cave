import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'

// Control fixture: every exported parent requires historical edge remapping.
for (const parents of [100, 500, 1_000]) {
  const store = open()
  try {
    const initial = store.ingest(Array.from({ length: parents }, (_, index) =>
      `api-${index} HAS count: 0\n  WHEN condition-${index} IS satisfied`).join('\n'))
    assert.equal(initial.edges, parents)
    store.ingest(Array.from({ length: parents }, (_, index) => `api-${index} HAS count: 1`).join('\n'))
    assert.equal(store.currentBeliefs().length, parents * 2)
    const options = { current: true, tx: true }
    const expected = store.exportText(options)
    assert.equal((expected.match(/WHEN condition-/g) ?? []).length, parents)
    const timings = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const output = store.exportText(options)
      timings.push(performance.now() - start)
      assert.equal(output, expected)
    }
    timings.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, historyRows: parents * 3, currentRows: parents * 2, edges: parents, medianMs: timings[2] }))
  } finally { store.close() }
}
