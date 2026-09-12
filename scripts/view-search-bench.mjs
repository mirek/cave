/** Run alone: measure complete search view construction, without HTTP/browser work. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { search } from '../packages/view/src/api.ts'

const measurements = []
for (const metadata of ['empty', 'populated']) for (const kind of ['numeric', 'text']) for (const rows of [100, 1000]) {
  const store = open()
  const value = kind === 'numeric' ? '123456789012345678901234567890.125' : '"' + 'x'.repeat(2048) + '"'
  try {
    const seeded = store.ingest(Array.from({ length: rows }, (_, index) =>
      `item-${index} HAS sample: ${value}` + (metadata === 'empty' ? '' :
        ` @origin-${index} @benchmark @sample #label:item-${index} #benchmark #shape:populated`)).join('\n'))
    assert.equal(seeded.problems.length, 0)
    const edgesPerClaim = metadata === 'empty' ? 0 : 5
    store.appendEdges(seeded.ids.flatMap((parentId, index) =>
      Array.from({ length: edgesPerClaim }, (_, offset) => ({
        parentId, role: 'BECAUSE', childId: seeded.ids[(index + offset + 1) % rows]
      }))))
    const samplesMs = []
    for (let iteration = 0; iteration < 6; iteration++) {
      const start = performance.now()
      const result = search(store, 'sample', { limit: rows })
      const elapsed = performance.now() - start
      assert.equal(result.length, rows)
      assert.ok(result.every(row => row.attribute === 'sample' && row.value === value && !row.negated && !row.importance))
      for (const row of result) {
        assert.equal(row.cites, edgesPerClaim)
        assert.equal(row.citedBy, edgesPerClaim)
        assert.deepEqual([...row.contexts].sort(), metadata === 'empty' ? [] :
          ['benchmark', `origin-${row.subject.slice(5)}`, 'sample'])
        assert.deepEqual([...row.tags].sort((a, b) => a.key.localeCompare(b.key)), metadata === 'empty' ? [] :
          [{ key: 'benchmark' }, { key: 'label', value: row.subject }, { key: 'shape', value: 'populated' }])
      }
      if (iteration > 0) samplesMs.push(elapsed)
    }
    measurements.push({ metadata, contextsPerClaim: metadata === 'empty' ? 0 : 3,
      tagsPerClaim: metadata === 'empty' ? 0 : 3, edgesPerClaim, kind, rows, valueBytes: Buffer.byteLength(value),
      medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.view-search-benchmark', version: 2,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: 'One warmup and five timed complete search view calls per case. In-memory SQLite, default internal sensitivity, numeric or 2048-character text payloads. Empty metadata or three contexts, three tags, five incoming and five outgoing BECAUSE edges per claim. Seeding and result assertions excluded. Includes query, metadata reads and view construction, primary-field validation; excludes HTTP and browser rendering.',
  measurements }, null, 2))
