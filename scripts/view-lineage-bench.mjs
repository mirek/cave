/** Run alone: complete lineage reads with wide branches and shared evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { lineage } from '../packages/view/src/api.ts'

const measurements = []
for (const branches of [100, 1000]) {
  const store = open()
  try {
    const names = ['root', ...Array.from({ length: branches }, (_, i) => `branch-${i}`), 'shared']
    const seeded = store.ingest(names.map(name => `${name} IS evidence @origin-${name} #label:${name}`).join('\n'))
    assert.equal(seeded.problems.length, 0)
    const root = seeded.ids[0], shared = seeded.ids.at(-1)
    store.appendEdges(seeded.ids.slice(1, -1).flatMap(id => [
      { parentId: root, role: 'BECAUSE', childId: id },
      { parentId: id, role: 'BECAUSE', childId: shared }
    ]))
    const subjects = new Map(seeded.ids.map((id, i) => [id, names[i]]))
    const samplesMs = []
    let digest
    for (let iteration = 0; iteration < 6; iteration++) {
      const start = performance.now()
      const result = lineage(store, root, { maxSensitivity: 'restricted' })
      const elapsed = performance.now() - start
      assert.equal(result.cites.length, branches)
      assert.deepEqual(result.citedBy, [])
      assert.equal(result.row.cites, branches)
      const rows = [result.row]
      for (const [index, branch] of result.cites.entries()) {
        assert.equal(branch.row.subject, `branch-${index}`)
        assert.equal(branch.row.cites, 1)
        assert.equal(branch.row.citedBy, 1)
        assert.equal(branch.children.length, 1)
        const evidence = branch.children[0]
        assert.equal(evidence.row.subject, 'shared')
        assert.equal(evidence.row.citedBy, branches)
        assert.equal(evidence.repeat, index === 0 ? undefined : true)
        assert.deepEqual(evidence.children, [])
        rows.push(branch.row, evidence.row)
      }
      for (const row of rows) {
        assert.deepEqual(row.contexts, [`origin-${row.subject}`])
        assert.deepEqual(row.tags, [{ key: 'label', value: row.subject }])
      }
      // Generated transaction IDs/timestamps differ between independent runs.
      const normalized = JSON.stringify(result, (key, value) =>
        key === 'at' ? undefined : (key === 'id' || key === 'tx') ? subjects.get(value) : value)
      const currentDigest = createHash('sha256').update(normalized).digest('hex')
      if (digest !== undefined) assert.equal(currentDigest, digest)
      digest = currentDigest
      if (iteration > 0) samplesMs.push(elapsed)
    }
    measurements.push({ branches, uniqueRows: branches + 2, edges: branches * 2,
      samplesMs, medianMs: [...samplesMs].sort((a, b) => a - b)[2], normalizedSha256: digest })
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.view-lineage-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: 'One warmup and five complete lineage reads per case, restricted ceiling on in-memory SQLite. Wide root branches each cite one shared premise; every row has a distinct context and tag. Seeding, assertions and hashes excluded from timing. Hashes replace generated IDs with subjects and omit transaction timestamps. Excludes HTTP and browser rendering.',
  measurements }, null, 2))
