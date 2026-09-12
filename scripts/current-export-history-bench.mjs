import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'

// Run alone. Historical-edge cases exercise the remapping fallback too.
for (const revisions of [100, 1_000, 10_000]) for (const edge of ['none', 'current', 'historical']) {
  const store = open()
  try {
    const inserted = store.ingest(Array.from({ length: revisions }, (_, index) => `api HAS count: ${index}`).join('\n'))
    if (edge !== 'none') {
      const condition = store.ingest('condition IS satisfied').ids[0]
      store.appendEdges([{ parentId: inserted.ids[edge === 'current' ? revisions - 1 : 0], role: 'WHEN', childId: condition }])
    }
    const options = { current: true, tx: true }
    assert.equal(store.currentBeliefs().length, edge === 'none' ? 1 : 2)
    const expected = store.exportText(options)
    assert.match(expected, new RegExp(`count: ${revisions - 1}(?:\\s|$)`))
    if (edge !== 'none') assert.match(expected, /WHEN condition IS satisfied/)
    const timings = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const output = store.exportText(options)
      timings.push(performance.now() - start)
      assert.equal(output, expected)
    }
    timings.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, revisions, edge, medianMs: timings[2] }))
  } finally { store.close() }
}
