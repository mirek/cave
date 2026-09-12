import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { run } from '@cavelang/eval'

const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error]
for (const mode of ['judge-write-remove', 'judge-write', 'judge-remove', 'judge-cancel-remove', 'ingest-cancel-remove', 'judge-cancel-error', 'judge-cancel-aggregate'] as const) {
  test(`evaluation preserves nested diagnostics: ${mode}`, async t => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-nested-test-'))
    fs.writeFileSync(join(dir, 'source.md'), 'Local source')
    fs.writeFileSync(join(dir, 'source.golden.cave'), 'wanted IS result')
    const reason = new Error('evaluation cancelled'), writing = new Error('judge work failed'), removing = new Error('prompt removal failed')
    const compound = new AggregateError([reason, writing], `${reason.message}; ${writing.message}`, { cause: reason })
    const controller = new AbortController()
    const owned = new Map<string, string>(), removed: string[] = []
    let agents = 0, judges = 0
    try {
      const mkdir = fs.mkdtempSync, remove = fs.rmSync, write = fs.writeFileSync
      t.mock.method(fs, 'mkdtempSync', ((prefix, ...args) => {
        const path = Reflect.apply(mkdir, fs, [prefix, ...args])
        for (const kind of ['eval', 'judge', 'prompt']) if (String(prefix).endsWith(`cave-${kind}-`)) owned.set(kind, String(path))
        return path
      }) as typeof fs.mkdtempSync)
      t.mock.method(fs, 'rmSync', ((path, options) => {
        remove(path, options)
        for (const [kind, directory] of owned) if (String(path) === directory) {
          removed.push(kind)
          if ((kind === 'judge' && mode.includes('remove')) || (kind === 'prompt' && mode === 'ingest-cancel-remove')) throw removing
        }
      }) as typeof fs.rmSync)
      t.mock.method(fs, 'writeFileSync', ((path, ...args) => {
        if (basename(String(path)) === 'judge.md') {
          if (mode === 'judge-cancel-remove') { controller.abort(reason); throw reason }
          if (mode === 'judge-write' || mode === 'judge-write-remove') throw writing
        }
        return Reflect.apply(write, fs, [path, ...args])
      }) as typeof fs.writeFileSync)
      syncBuiltinESMExports()
      const functionJudge = mode === 'judge-cancel-error' || mode === 'judge-cancel-aggregate'
      const pending = run({ suites: [dir], mode: 'stdout', runs: 1, signal: controller.signal,
        agent: async () => { agents++; if (mode === 'ingest-cancel-remove') controller.abort(reason); return 'actual IS result' },
        judge: functionJudge ? async () => {
          judges++; controller.abort(reason)
          throw mode === 'judge-cancel-aggregate' ? compound : writing
        } : "printf '[]'"
      })
      if (mode.includes('cancel')) {
        await assert.rejects(pending, error => {
          if (mode === 'judge-cancel-aggregate') assert.equal(error, compound)
          assert.deepEqual(leaves(error), [reason, functionJudge ? writing : removing])
          return true
        })
      } else {
        const report = await pending
        assert.equal(report.failedRuns, 1)
        const note = report.cases[0]!.runs[0]!.note!
        if (mode !== 'judge-remove') assert.ok(note.includes(writing.message))
        if (mode !== 'judge-write') assert.ok(note.includes(removing.message))
      }
      assert.equal(agents, 1)
      assert.equal(judges, functionJudge ? 1 : 0)
      assert.equal(removed.filter(kind => kind === 'eval').length, 1)
      assert.equal(removed.filter(kind => kind === 'prompt').length, 1)
      if (!functionJudge && mode !== 'ingest-cancel-remove') assert.equal(removed.filter(kind => kind === 'judge').length, 1)
      for (const directory of owned.values()) assert.equal(fs.existsSync(directory), false)
    } finally {
      t.mock.restoreAll(); syncBuiltinESMExports()
      for (const directory of owned.values()) fs.rmSync(directory, { recursive: true, force: true })
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

for (const wrapped of [false, true]) {
  for (const unreadable of [false, true]) test(`reconstruction retains concurrent cancellation diagnostics: wrapped=${wrapped}, unreadable=${unreadable}`, async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-nested-loop-test-'))
    const claims = 'auth HAS bug: token-expiry\ntoken-expiry CAUSE reject-valid-tokens'
    fs.writeFileSync(join(dir, 'source.cave'), claims)
    fs.writeFileSync(join(dir, 'source.golden.cave'), claims)
    fs.writeFileSync(join(dir, 'source.loop.cave'), 'loop SEEDS reject-valid-tokens\nloop HAS query: `why are valid tokens rejected?`')
    const controller = new AbortController(), reason = new Error('reconstruction cancelled')
    const work = new Error('reconstruction work failed', { cause: wrapped ? reason : undefined })
    // A caller's cyclic cause must not trap the cancellation check.
    if (!wrapped) work.cause = work
    if (unreadable) Object.defineProperty(work, 'cause', { get() { throw new Error('cause unavailable') } })
    let calls = 0, db = ''
    try {
      await assert.rejects(run({ suites: [dir], runs: 3, signal: controller.signal,
        agent: async (_prompt, _files, context) => {
          calls++; db = context.db; controller.abort(reason); throw work
        }
      }), error => {
        if (wrapped && !unreadable) assert.equal(error, work)
        else {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [reason, work])
          assert.equal(error.cause, reason)
        }
        return true
      })
      assert.equal(calls, 1)
      assert.notEqual(db, '')
      assert.equal(fs.existsSync(db), false)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}
