/** Run alone; returned-row limits are not query-work budgets. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
const workloads = [
  ...[100, 1000, 10000].map(revisions => ({ revisions, unrelatedKeys: 0 })),
  { revisions: 10000, unrelatedKeys: 10000 }
]
for (const { revisions, unrelatedKeys } of workloads) {
  const store = open()
  try {
    store.transaction(() => {
      store.ingest('stable HAS note: searchmarker')
      for (let i = 0; i < revisions; i++) store.ingest(`changing HAS note: "searchmarker ${i}"`)
      if (unrelatedKeys > 0) {
        const seeded = store.ingest(Array.from({ length: unrelatedKeys }, (_, i) => `unrelated-${i} IS background`).join('\n'))
        assert.equal(seeded.problems.length, 0)
        assert.equal(seeded.ids.length, unrelatedKeys)
      }
    })
    for (const currentOnly of [false, true]) {
      const samples = []
      for (let i = 0; i < 13; i++) {
        const start = performance.now()
        const rows = store.search('searchmarker', { currentOnly, limit: 5 })
        const elapsed = performance.now() - start
        assert.equal(rows.length, currentOnly ? 2 : 5)
        if (currentOnly) assert.deepEqual(rows.map(row => row.subject), ['changing', 'stable'])
        if (i >= 2) samples.push(elapsed)
      }
      samples.sort((a,b) => a-b)
      console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,revisions,unrelatedKeys,currentOnly,limit:5,warmups:2,sampleCount:11,medianMs:samples[5],timingScope:'search and row decoding; fixture construction and assertions excluded'}))
    }
  } finally { store.close() }
}
