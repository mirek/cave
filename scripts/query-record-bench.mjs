import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { queryRecords, Record } from '../packages/query/src/index.ts'

// Run alone. Setup, transaction entry/exit, and full record checks are untimed.
const sourceSha256 = Object.fromEntries([
  'scripts/query-record-bench.mjs',
  'packages/store/src/record.ts',
  'packages/query/src/record.ts',
  'packages/query/src/bounded.ts',
  'packages/query/src/capture.ts',
  'packages/query/src/read-snapshot.ts',
  'benchmarks/query-record-baseline.mjs',
  'benchmarks/query-record-capture-baseline.mjs',
  'benchmarks/query-match-baseline.mjs',
].map(path => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]))
const cases = []
for (const claims of [100, 1_000]) for (const metadata of [false, true]) {
  for (const mode of ['memory', 'wal-read-only']) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-query-record-bench-'))
    const writer = open(mode === 'memory' ? ':memory:' : join(dir, 'knowledge.db'))
    let reader
    try {
      if (mode !== 'memory') writer.db.exec('PRAGMA journal_mode = WAL')
      const suffix = metadata ? ' @src:inventory @hyp:baseline @2026 #team:core #phase:ready #reviewed' : ''
      writer.ingest(Array.from({ length: claims }, (_, i) => `item/${i} IS service${suffix}`).join('\n'))
      reader = mode === 'memory' ? writer : open(join(dir, 'knowledge.db'), { access: 'read-only' })
      for (const nested of [false, true]) {
        if (nested) reader.db.exec('BEGIN')
        try {
          const read = () => queryRecords(reader, '?item IS service', { limit: claims })
          const expected = read()
          assert.equal(expected.length, claims)
          assert.equal(new Set(expected.map(record => record.bindings.item)).size, claims)
          for (const record of expected) {
            assert.deepEqual(Record.decode(Record.encode(record)), record)
            assert.equal(record.claim.claim.contexts.length, metadata ? 3 : 0)
            assert.equal(record.claim.claim.tags.length, metadata ? 3 : 0)
            assert.deepEqual(record.claim.provenance.sources, metadata ? ['inventory'] : [])
          }
          const iterations = 3, samplesMs = []
          for (let sample = 0; sample < 5; sample++) {
            let actual
            const start = performance.now()
            for (let iteration = 0; iteration < iterations; iteration++) actual = read()
            samplesMs.push((performance.now() - start) / iterations)
            assert.deepEqual(actual, expected)
          }
          cases.push({ claims, metadata, mode, nested, iterations, samplesMs,
            medianMs: [...samplesMs].sort((a, b) => a - b)[2] })
        } finally { if (nested) reader.db.exec('ROLLBACK') }
      }
    } finally {
      if (reader !== undefined && reader !== writer) reader.close()
      writer.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
console.log(JSON.stringify({ format: 'cave.query-record-benchmark/v1', node: process.version,
  platform: process.platform, arch: process.arch, nodeArguments: process.execArgv,
  sourceSha256, cases }, null, 2))
