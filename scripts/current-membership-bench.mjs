import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { QuerySql } from '../packages/store/src/adapter-entry.ts'

const measurements = []
for (const keys of [10000, 100]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: 10000 }, (_, i) => `person/${i % keys} HAS score: ${i} @2025..2027`).join('\n'))
    const snapshot = store.db.prepare('SELECT MAX(tx) AS tx FROM cave_claim').get().tx
    const source = QuerySql.claims(QuerySql.asOfBoundary(snapshot))
    const base = QuerySql.current(source)
    const membership = `SELECT c.* FROM cave_claim c WHERE (c.claim_key, c.tx) IN (
      SELECT claim_key, MAX(tx) FROM ${source} GROUP BY claim_key)`
    const select = `FROM (${base}) c WHERE c.verb = 'HAS' AND c.attribute = 'score' AND c.conf > 0 ORDER BY c.tx LIMIT ? OFFSET ?`
    const variants = {
      full: `SELECT c.* ${select}`,
      membership: `SELECT c.* ${select.replace(base, membership)}`
    }
    const statements = Object.fromEntries(Object.entries(variants).map(([name, sql]) => [name, store.db.prepare(sql)]))
    const samples = { full: [], membership: [] }
    let expected
    for (let iteration = 0; iteration < 3; iteration++) {
      // Alternate order; assertions and full-row comparisons are untimed.
      for (const mode of iteration % 2 === 0 ? ['full', 'membership'] : ['membership', 'full']) {
        const results = []
        const start = performance.now()
        for (let request = 0; request < 100; request++) results.push(statements[mode].all(100, request % (keys / 100) * 100))
        samples[mode].push(performance.now() - start)
        assert.ok(results.every(rows => rows.length === 100))
        if (expected === undefined) expected = results
        else assert.deepEqual(results, expected)
      }
    }
    for (const [mode, sql] of Object.entries(variants)) measurements.push({ mode, historyRows: 10000, currentKeys: keys,
      requests: 100, samplesMs: samples[mode], medianMs: [...samples[mode]].sort((a,b) => a-b)[1],
      sql, plan: store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(100, 0) })
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.current-membership-benchmark/v1',
  runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch }, measurements }))
