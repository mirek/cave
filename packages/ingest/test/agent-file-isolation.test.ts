import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { run, selectBatches } from '@cavelang/ingest'

for (const policy of ['strict', 'lenient'] as const) for (const fails of [false, true]) {
  test(`agent file-list mutation cannot change source membership: ${policy}/fails=${fails}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-agent-files-test-'))
    const store = open()
    for (const name of ['a.md', 'b.md', 'c.md', 'd.md']) writeFileSync(join(dir, name), name)
    const received: string[][] = [], retained: string[][] = []
    try {
      const options = { db: ':memory:', store, cwd: dir, patterns: ['*.md'], batchSize: 2, mode: 'stdout' as const, policy }
      const report = await run({ ...options, agent: async (_prompt, paths) => {
        received.push([...paths])
        // JavaScript adapters can mutate an array despite the readonly TS view.
        const mutable = paths as string[]
        retained.push(mutable)
        mutable.splice(0, mutable.length, 'forged.md')
        if (fails && received.length === 1) throw new Error('first batch failed')
        return `batch-${received.length} IS accepted`
      } })
      const stopped = fails && policy === 'strict'
      const expectedFiles = stopped ? [['a.md', 'b.md']] : [['a.md', 'b.md'], ['c.md', 'd.md']]
      assert.deepEqual(received, expectedFiles)
      assert.deepEqual(report.batches.map(batch => batch.files), expectedFiles)
      assert.deepEqual(report.sources.map(source => [source.path, source.status, source.batch]), [
        ['a.md', fails ? 'rejected' : 'accepted', 1], ['b.md', fails ? 'rejected' : 'accepted', 1],
        ['c.md', stopped ? 'not-run' : 'accepted', stopped ? undefined : 2],
        ['d.md', stopped ? 'not-run' : 'accepted', stopped ? undefined : 2]
      ])
      assert.equal(report.applied, !stopped)
      assert.equal(report.added, fails ? policy === 'strict' ? 0 : 1 : 2)
      const next = await selectBatches(store, options)
      assert.deepEqual(next.selection.skipped, stopped ? [] : fails ? ['c.md', 'd.md'] : ['a.md', 'b.md', 'c.md', 'd.md'])
      const before = JSON.stringify(report)
      for (const paths of retained) paths.push('late.md')
      assert.equal(JSON.stringify(report), before)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
