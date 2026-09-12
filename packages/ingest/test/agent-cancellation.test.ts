import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { open } from '@cavelang/store'
import { run } from '../src/run.ts'

for (const policy of ['strict', 'lenient'] as const) for (const mode of ['work', 'unprintable', 'cause-captured', 'cause-unreadable', 'aggregate', 'cause', 'cycle', 'reason', 'active', 'active-unprintable'] as const) {
  test(`function-agent cancellation retains diagnostics: ${policy}/${mode}`, async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'cave-ingest-agent-cancel-test-'))
    const db = join(dir, 'target.db'), store = open(db)
    fs.writeFileSync(join(dir, 'one.md'), 'First source')
    fs.writeFileSync(join(dir, 'two.md'), 'Second source')
    store.ingest('original IS retained')
    const controller = new AbortController(), reason = new Error('agent cancelled')
    const work = new Error('agent cleanup failed', { cause: mode === 'cause' ? reason : undefined })
    if (mode === 'unprintable' || mode === 'active-unprintable') {
      Object.defineProperty(reason, 'message', { value: Object.create(null) })
      Object.defineProperty(work, 'message', { get() { throw new Error('message unavailable') } })
    }
    let causeReads = 0
    if (mode === 'cause-captured' || mode === 'cause-unreadable') Object.defineProperty(work, 'cause', { get() {
      causeReads++
      if (mode === 'cause-unreadable') throw new Error('cause unavailable')
      return causeReads === 1 ? reason : undefined
    } })
    if (mode === 'cycle') work.cause = work
    const thrown = mode === 'aggregate' ? new AggregateError([reason, work], 'agent cancelled; agent cleanup failed', { cause: reason }) : mode === 'reason' ? reason : work
    const paths: string[] = []
    let calls = 0
    try {
      const pending = run({ db, store, cwd: dir, patterns: ['*.md'], policy, batchSize: 1,
        signal: controller.signal, agent: async (_prompt, _files, context) => {
          calls++
          assert.equal(context.signal, controller.signal)
          paths.push(context.db)
          if (context.mcpConfig) paths.push(context.mcpConfig)
          const target = open(context.db)
          try { target.ingest('agent IS written') } finally { target.close() }
          if (!mode.startsWith('active')) controller.abort(reason)
          throw thrown
        }
      })
      if (mode.startsWith('active')) {
        const report = await pending
        assert.equal(report.failed, policy === 'strict' ? 1 : 2)
        assert.ok(report.batches.every(batch => batch.note === (mode === 'active-unprintable' ? '[unprintable thrown value]' : work.message)))
      } else await assert.rejects(pending, error => {
        if (mode === 'aggregate' || mode === 'cause' || mode === 'cause-captured' || mode === 'reason') assert.equal(error, thrown)
        else {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [reason, work])
          assert.equal(error.cause, reason)
          if (mode === 'unprintable') assert.equal(error.message, '[unprintable thrown value]; ingestion also failed: [unprintable thrown value]')
          else {
            assert.ok(error.message.includes(reason.message))
            assert.ok(error.message.includes(work.message))
          }
        }
        return true
      })
      if (mode === 'cause-captured' || mode === 'cause-unreadable') assert.equal(causeReads, 1)
      assert.equal(calls, mode.startsWith('active') && policy === 'lenient' ? 2 : 1)
      for (const path of paths) if (path !== db) assert.equal(fs.existsSync(dirname(path)), false)
      assert.equal(store.exportText({ current: true }).includes('agent IS written'), policy === 'lenient')
      assert.ok(store.exportText({ current: true }).includes('original IS retained'))
      store.ingest('caller IS usable')
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })
}
