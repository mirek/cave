#!/usr/bin/env node
/** Compare shape-fact SQL strategies without changing gate semantics. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { QuerySql } from '../packages/store/src/adapter-entry.ts'

const measurements = []
for (const [entities, versions] of [[1000, 1], [1000, 10], [100, 100]]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: entities }, (_, i) => `service/${i} IS service`).join('\n'))
    for (let version = 0; version < versions; version++) {
      store.ingest(Array.from({ length: entities }, (_, i) =>
        `service/${i} HAS owner: team-${version}${version === versions - 1 && i % 7 === 0 ? ' @ 0%' : ''}`).join('\n'))
    }
    store.ingest(Array.from({ length: 3000 }, (_, i) => `unrelated/${i} USES library`).join('\n'))
    const predicate = `(verb IN (SELECT value FROM json_each(?))
      OR (verb = 'HAS' AND attribute IN (SELECT value FROM json_each(?))))`
    const params = [JSON.stringify(['IS', 'EXTENDS']), JSON.stringify(['owner'])]
    const candidates = {
      correlated: `SELECT c.subject, c.verb, c.object, c.attribute, c.value_unit
        FROM cave_claim c WHERE ${predicate} AND c.conf > 0 AND c.negated = 0
        AND c.tx = (SELECT MAX(latest.tx) FROM cave_claim latest WHERE latest.claim_key = c.claim_key)
        ORDER BY c.tx`,
      grouped: `SELECT c.subject, c.verb, c.object, c.attribute, c.value_unit
        FROM (${QuerySql.current(`(SELECT * FROM cave_claim WHERE ${predicate})`)}) c
        WHERE c.conf > 0 AND c.negated = 0 ORDER BY c.tx`,
    }
    let expected
    for (const [kind, sql] of Object.entries(candidates)) {
      const statement = store.db.prepare(sql)
      const rows = statement.all(...params)
      assert.equal(rows.length, entities * 2 - Math.ceil(entities / 7))
      if (expected === undefined) expected = rows
      else assert.deepEqual(rows, expected, 'strategies must preserve row order, latest values and retractions')
      const samplesMs = []
      for (let sample = 0; sample < 3; sample++) {
        const started = performance.now()
        for (let request = 0; request < 20; request++) statement.all(...params)
        samplesMs.push(performance.now() - started)
      }
      measurements.push({ entities, versions, kind, requests: 20,
        medianMs: [...samplesMs].sort((a, b) => a - b)[1], samplesMs,
        plan: store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) })
    }
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.shape-query-benchmark', version: 1,
  runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch },
  measurements }))
