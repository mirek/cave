/** Run alone: cold, cached and provenance-invalidated complete entity views. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { entity } from '../packages/view/src/api.ts'
import { scopedStoreCacheStats, withScopedStore } from '../packages/view/src/scope.ts'

const measurements = []
for (const rows of [100, 1000]) {
  const store = open()
  try {
    const seeded = store.ingest(Array.from({ length: rows }, (_, index) =>
      `api HAS sample-${index}: ${index} @src:cli #sensitivity:public`).join('\n'), {
      provenance: { actor: 'benchmark', sources: ['file-a', 'file-b'], run: 'run-1', domains: ['trial'] }
    })
    assert.equal(seeded.problems.length, 0)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cave_provenance').get().n, rows * 6)
    const expected = entity(store, 'api', { maxSensitivity: 'restricted' })
    assert.equal(expected.facts.length, rows)
    const read = () => {
      const start = performance.now()
      const result = entity(store, 'api', { maxSensitivity: 'public' })
      const elapsed = performance.now() - start
      assert.deepEqual(result, expected)
      return elapsed
    }
    const coldMs = read()
    assert.equal(scopedStoreCacheStats(store).builds, 1)
    const warmSamplesMs = Array.from({ length: 5 }, read)
    assert.equal(scopedStoreCacheStats(store).builds, 1)
    withScopedStore(store, 'public', scoped => {
      for (const id of seeded.ids) assert.deepEqual(scoped.provenanceOf(id), store.provenanceOf(id))
    })
    const id = seeded.ids[0]
    store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)')
      .run(id, 'source', 'file-c')
    const invalidatedMs = read()
    assert.equal(scopedStoreCacheStats(store).builds, 2)
    withScopedStore(store, 'public', scoped => assert.deepEqual(scoped.provenanceOf(id), store.provenanceOf(id)))
    measurements.push({ rows, provenanceEntriesPerClaim: 6, coldMs, warmSamplesMs,
      warmMedianMs: [...warmSamplesMs].sort((a, b) => a - b)[2], invalidatedMs,
      cache: scopedStoreCacheStats(store) })
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.view-projection-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: 'In-memory native SQLite. One cold complete entity view, five cached views and one view after a provenance-only edit. All returned view rows equal the restricted-source baseline. Provenance equality and cache build counts checked outside timing. Setup, assertions, HTTP and browser rendering excluded. Cold and invalidated times are single observations, warm time is the median of five samples. Run alone.',
  measurements }, null, 2))
