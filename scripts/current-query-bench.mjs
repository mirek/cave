#!/usr/bin/env node
/** Compare read-only SQL plans; the alternative is not production behavior. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { QuerySql } from '../packages/store/src/adapter-entry.ts'

const measurements = []
for (const keys of [10_000, 100]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: 10_000 }, (_, i) => `person/${i % keys} HAS score: ${i}`).join('\n'))
    const snapshot = store.db.prepare('SELECT MAX(tx) AS tx FROM cave_claim').get().tx
    const source = QuerySql.claims(QuerySql.asOfBoundary(snapshot))
    const candidates = {
      grouped: QuerySql.current(source),
      correlated: `SELECT c.* FROM cave_claim c WHERE c.tx = (
        SELECT MAX(latest.tx) FROM (${source}) latest WHERE latest.claim_key = c.claim_key)`
    }
    let expected
    for (const [kind, base] of Object.entries(candidates)) {
      const sql = `SELECT c.id FROM (${base}) c
        WHERE c.verb = 'HAS' AND c.attribute = 'score' AND c.conf > 0
        ORDER BY c.tx LIMIT ? OFFSET ?`
      const statement = store.db.prepare(sql)
      const samplesMs = []
      for (let iteration = 0; iteration < 3; iteration++) {
        const results = []
        const start = performance.now()
        for (let request = 0; request < 100; request++) {
          results.push(statement.all(100, (request % (keys / 100)) * 100))
        }
        samplesMs.push(performance.now() - start)
        const ids = results.map(rows => rows.map(row => row.id))
        if (expected === undefined) expected = ids
        else assert.deepEqual(ids, expected, `${keys}/${kind}: SQL alternatives disagree`)
        assert.ok(ids.every(rows => rows.length === 100))
      }
      measurements.push({ kind, historyRows: 10_000, currentKeys: keys, requests: 100,
        medianMs: [...samplesMs].sort((a, b) => a - b)[1], samplesMs,
        plan: store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(100, 0) })
    }
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.current-query-benchmark', version: 1,
  runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch },
  measurements }))
