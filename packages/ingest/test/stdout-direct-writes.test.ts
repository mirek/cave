import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { run, selectBatches } from '@cavelang/ingest'

for (const policy of ['strict', 'lenient'] as const) for (const output of ['valid', 'partial', 'invalid'] as const) {
  test(`stdout batch counts direct agent writes: ${policy}/${output}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-stdout-direct-test-'))
    const db = join(dir, 'target.db'), store = open(db)
    writeFileSync(join(dir, 'source.md'), 'Source material')
    try {
      const options = { db, store, cwd: dir, patterns: ['source.md'], policy, mode: 'stdout' as const }
      const report = await run({ ...options, agent: async (_prompt, _files, context) => {
        const target = open(context.db)
        try { target.ingest('direct IS written') } finally { target.close() }
        return output === 'valid' ? 'printed IS written' : output === 'partial' ? 'printed IS written\ninvalid syntax' : 'invalid syntax'
      } })
      const rejected = output !== 'valid', discarded = rejected && policy === 'strict'
      const stdoutAdded = output !== 'invalid' && !discarded ? 1 : 0
      assert.equal(report.batches[0]!.added, 1 + stdoutAdded)
      assert.equal(report.added, discarded ? 0 : 1 + stdoutAdded)
      assert.equal(report.applied, !discarded)
      assert.equal(report.batches[0]!.partial === true, policy === 'lenient' && output === 'partial')
      assert.equal(report.sources[0]!.status, rejected ? 'rejected' : 'accepted')
      const text = store.exportText({ current: true })
      assert.equal(text.includes('direct IS written'), !discarded)
      assert.equal(text.includes('printed IS written'), stdoutAdded === 1)
      const next = await selectBatches(store, options)
      assert.equal(next.selection.files.length, rejected ? 1 : 0)
      assert.equal(next.selection.skipped.length, rejected ? 0 : 1)
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
