import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { query } from '../packages/query/src/index.ts'

// Run alone. Setup, transaction boundaries and result assertions are untimed.
const iterations = 20
for (const claims of [100, 1_000]) for (const mode of ['memory', 'wal-read-only']) {
  const dir = mkdtempSync(join(tmpdir(), 'cave-query-snapshot-bench-'))
  const writer = open(mode === 'memory' ? ':memory:' : join(dir, 'knowledge.db'))
  let reader
  try {
    if (mode !== 'memory') writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest(Array.from({ length: claims }, (_, index) => `item/${index} IS service`).join('\n'))
    reader = mode === 'memory' ? writer : open(join(dir, 'knowledge.db'), { access: 'read-only' })
    for (const nested of [false, true]) for (const resolve of [false, true]) {
      if (nested) reader.db.exec('BEGIN')
      try {
        const read = () => query(reader, '?item IS service', { limit: 1, resolve })
        const expected = read()
        assert.equal(expected.length, 1)
        assert.equal(expected[0].bindings.item, 'item/0')
        const timings = []
        for (let sample = 0; sample < 5; sample++) {
          let result
          const start = performance.now()
          for (let iteration = 0; iteration < iterations; iteration++) result = read()
          timings.push((performance.now() - start) / iterations)
          assert.deepEqual(result, expected)
        }
        timings.sort((a, b) => a - b)
        console.log(JSON.stringify({ node: process.version, claims, mode, nested, resolve, iterations, medianMs: timings[2] }))
      } finally { if (nested) reader.db.exec('ROLLBACK') }
    }
  } finally {
    if (reader !== undefined && reader !== writer) reader.close()
    writer.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
