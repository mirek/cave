import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { run } from '@cavelang/eval'

const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error]
for (const mode of ['append-close', 'append-only', 'close-only', 'append-close-root'] as const) test(`fixture scratch cleanup retains errors: ${mode}`, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-scratch-test-'))
  fs.writeFileSync(join(dir, 'source.md'), 'Local source material')
  fs.writeFileSync(join(dir, 'source.golden.cave'), 'item IS retained')
  fs.writeFileSync(join(dir, 'source.queries.cave'), 'item IS retained')
  const operation = new Error('scratch append failed'), closing = new Error('scratch close failed'), removal = new Error('root removal failed')
  const ready = new WeakSet<DatabaseSync>()
  let root = '', closes = 0, removals = 0, calls = 0
  try {
    const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close
    const mkdir = fs.mkdtempSync, remove = fs.rmSync
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      const statement = prepare.call(this, sql)
      if (sql === 'SELECT MAX(tx) AS tx FROM cave_claim') ready.add(this)
      return statement
    })
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (ready.has(this) && sql === 'BEGIN IMMEDIATE' && mode !== 'close-only') throw operation
      return exec.call(this, sql)
    })
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      close.call(this)
      if (ready.has(this)) { closes++; if (mode !== 'append-only') throw closing }
    })
    t.mock.method(fs, 'mkdtempSync', ((prefix, ...args) => {
      const created = Reflect.apply(mkdir, fs, [prefix, ...args])
      if (String(prefix).endsWith('cave-eval-')) root = String(created)
      return created
    }) as typeof fs.mkdtempSync)
    t.mock.method(fs, 'rmSync', ((path, options) => {
      remove(path, options)
      if (String(path) === root) { removals++; if (mode === 'append-close-root') throw removal }
    }) as typeof fs.rmSync)
    syncBuiltinESMExports()
    const expected = [mode !== 'close-only' && operation, mode !== 'append-only' && closing, mode === 'append-close-root' && removal].filter(Boolean)
    await assert.rejects(run({ suites: [dir], mode: 'stdout', agent: async () => { calls++; return 'item IS retained' } }), error => {
      assert.deepEqual(leaves(error), expected)
      if (expected.length === 1) assert.equal(error, expected[0])
      else {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.cause, error.errors[0])
        for (const expectedError of expected) assert.ok(error.message.includes((expectedError as Error).message))
      }
      return true
    })
    assert.equal(closes, 1)
    assert.equal(removals, 1)
    assert.equal(calls, 0)
    assert.equal(fs.existsSync(root), false)
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports()
    if (root) fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
