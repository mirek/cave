import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { open } from '@cavelang/store'
import { run } from '@cavelang/eval'

for (const loop of [false, true]) for (const fault of ['none', 'cancel', 'score'] as const) for (const keep of [false, true]) {
  test(`evaluation run-store cleanup: loop=${loop}, fault=${fault}, keep=${keep}`, async t => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-run-close-test-'))
    const claims = 'auth HAS bug: token-expiry\ntoken-expiry CAUSE reject-valid-tokens'
    fs.writeFileSync(join(dir, loop ? 'source.cave' : 'source.md'), claims)
    fs.writeFileSync(join(dir, 'source.golden.cave'), claims)
    if (loop) fs.writeFileSync(join(dir, 'source.loop.cave'), 'loop SEEDS reject-valid-tokens\nloop HAS query: `why are valid tokens rejected?`')
    const cancel = fault === 'cancel'
    const controller = new AbortController()
    const reason = new Error(fault === 'score' ? 'evaluation scoring failed' : 'evaluation cancelled'), closing = new Error('evaluation run store close failed')
    let calls = 0, closes = 0, db = ''
    const databases = new Set<string>()
    let scorePatched = false
    try {
      const close = DatabaseSync.prototype.close
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
        const location = this.location()
        close.call(this)
        if (location !== null && basename(location) === 'case-1-run-1.db') { closes++; throw closing }
      })
      await assert.rejects(run({ suites: [dir], mode: 'stdout', runs: 3, keep, signal: controller.signal,
        agent: async (_prompt, _files, context) => {
          calls++
          db = context.db
          databases.add(db)
          if (cancel) controller.abort(reason)
          if (fault === 'score' && !scorePatched) {
            scorePatched = true
            t.mock.method(context.store, 'currentBeliefs', () => { throw reason })
          }
          return loop ? 'reject-valid-tokens' : claims
        }
      }), error => {
        if (fault === 'none') assert.equal(error, closing)
        else {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [reason, closing])
          assert.equal(error.cause, reason)
          assert.ok(error.message.includes(reason.message))
          assert.ok(error.message.includes(closing.message))
        }
        return true
      })
      if (cancel) assert.equal(calls, 1)
      else assert.ok(calls > 0)
      assert.deepEqual([...databases], [db])
      assert.equal(closes, 1)
      assert.notEqual(db, '')
      assert.equal(fs.existsSync(dirname(db)), keep)
      t.mock.restoreAll()
      if (keep) {
        const reopened = open(db)
        try { reopened.ingest('caller IS usable') } finally { reopened.close() }
      }
    } finally {
      t.mock.restoreAll()
      if (db) fs.rmSync(dirname(db), { recursive: true, force: true })
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

for (const loop of [false, true]) for (const unprintable of [false, true]) test(`scoring exceptions remain failed-run reports when close succeeds: loop=${loop}, unprintable=${unprintable}`, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-score-report-'))
  const claims = 'auth HAS bug: token-expiry\ntoken-expiry CAUSE reject-valid-tokens'
  fs.writeFileSync(join(dir, loop ? 'source.cave' : 'source.md'), claims)
  fs.writeFileSync(join(dir, 'source.golden.cave'), claims)
  if (loop) fs.writeFileSync(join(dir, 'source.loop.cave'), 'loop SEEDS reject-valid-tokens\nloop HAS query: `why are valid tokens rejected?`')
  const failure = unprintable ? Object.create(null) : new Error('scoring failed without cleanup failure')
  let db = '', patched = false
  try {
    const report = await run({ suites: [dir], mode: 'stdout', agent: async (_prompt, _files, context) => {
      db = context.db
      if (!patched) {
        patched = true
        t.mock.method(context.store, 'currentBeliefs', () => { throw failure })
      }
      return loop ? 'reject-valid-tokens' : claims
    } })
    assert.equal(report.failedRuns, 1)
    assert.equal(report.okRuns, 0)
    assert.equal(report.cases[0]!.runs[0]!.note, unprintable ? '[unprintable thrown value]' : 'scoring failed without cleanup failure')
    assert.doesNotThrow(() => JSON.stringify(report))
    assert.notEqual(db, '')
    assert.equal(fs.existsSync(dirname(db)), false)
  } finally {
    t.mock.restoreAll()
    if (db) fs.rmSync(dirname(db), { recursive: true, force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
