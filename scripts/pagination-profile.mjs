import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { open } from '../packages/store/src/index.ts'
import { page } from '../packages/query/src/index.ts'

// Diagnostic attribution, not a statistically sampled latency benchmark.
// Each fixture runs one plain traversal followed by one instrumented traversal.
const cases = []
for (const rows of [1000, 10000]) for (const kind of ['valid-time', 'exact-number', 'selective-valid-time']) {
  const store = open()
  try {
    const selective = kind === 'selective-valid-time'
    store.ingest(Array.from({ length: rows }, (_, i) =>
      `person/${i} HAS score: 42 @${selective && i % 100 !== 99 ? '2020..2021' : '2025..2027'}`).join('\n'))
    const expected = Array.from({ length: selective ? rows / 100 : rows }, (_, i) => `person/${selective ? i * 100 + 99 : i}`)
    const input = kind === 'exact-number' ? '?person HAS score: 42' : '?person HAS score: ?score'
    const options = { limit: selective ? 1 : 100, ...kind === 'exact-number' ? {} : { at: '2026' } }
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const traverse = reader => {
      const results = []
      let cursor
      const start = performance.now()
      for (let i = 0; i <= rows; i++) {
        const result = page(reader, input, { ...options, cursor })
        results.push(result)
        cursor = result.next
        if (cursor === undefined) break
      }
      const elapsedMs = performance.now() - start
      assert.equal(cursor, undefined)
      assert.deepEqual(results.flatMap(result => result.matches.map(match => match.bindings.person)), expected)
      assert.ok(results.every(result => result.snapshot === results[0].snapshot))
      assert.equal(results.length, rows / 100)
      return { elapsedMs, pages: results.length, results }
    }
    const plain = traverse(store)
    const timings = {}
    const measure = (category, body) => {
      const start = performance.now()
      try { return body() } finally {
        const entry = timings[category] ??= { calls: 0, elapsedMs: 0 }
        entry.calls++
        entry.elapsedMs += performance.now() - start
      }
    }
    // High-level original methods use the original DB, so their internal SQL
    // is charged only to the method category, never double-counted below.
    const reader = { ...store,
      registryAsOf: (...args) => measure('historical-vocabulary', () => store.registryAsOf(...args)),
      recordOf: (...args) => measure('record-projection', () => store.recordOf(...args)),
      db: { ...store.db,
        exec: sql => measure('sql-control', () => store.db.exec(sql)),
        prepare: sql => {
          const statement = measure('sql-prepare', () => store.db.prepare(sql))
          const category = sql.includes('AS claim_tail') ? 'snapshot-revision' : sql.includes('LIMIT ? OFFSET ?') ? 'sql-window' : 'sql-other'
          return Object.fromEntries(['all', 'get', 'run'].map(method => [method,
            (...args) => measure(category, () => statement[method](...args))]))
        }
      }
    }
    const profiled = traverse(reader)
    assert.deepEqual(profiled.results, plain.results)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    const measuredMs = Object.values(timings).reduce((sum, entry) => sum + entry.elapsedMs, 0)
    cases.push({ rows, kind, pages: plain.pages, matches: expected.length,
      plainMs: plain.elapsedMs, profiledMs: profiled.elapsedMs, timings,
      unassignedMs: profiled.elapsedMs - measuredMs })
  } finally { store.close() }
}
const sources = ['scripts/pagination-profile.mjs', 'packages/query/src/page.ts', 'packages/query/src/bounded.ts', 'packages/query/src/compile.ts']
console.log(JSON.stringify({ format: 'cave.pagination-profile/v1',
  runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch },
  sourceSha256: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')])),
  cases }))
