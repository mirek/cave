import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const mode of ['read-close', 'close-only'] as const) test(`native text probe retries after ${mode} failure before creating caller data`, async t => {
  const url = new URL('../src/node-adapter.ts', import.meta.url)
  url.searchParams.set('probe-test', mode)
  const { nodeSqliteAdapter } = await import(url.href) as typeof import('../src/node-adapter.ts')
  const dir = mkdtempSync(join(tmpdir(), 'cave-native-probe-'))
  const path = join(dir, 'caller.db')
  const readFailure = new Error('probe read failed'), closeFailure = new Error('probe close failed')
  const prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close
  const probes = new WeakSet<DatabaseSync>()
  let attempts = 0, closes = 0
  try {
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      if (sql === 'SELECT ? AS value') {
        probes.add(this)
        attempts++
        if (attempts === 1 && mode === 'read-close') throw readFailure
      }
      return prepare.call(this, sql)
    })
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      close.call(this)
      if (probes.has(this)) {
        closes++
        if (closes === 1) throw closeFailure
      }
    })
    assert.throws(() => nodeSqliteAdapter.open(path), error => {
      if (mode === 'close-only') return error === closeFailure
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, readFailure)
      assert.deepEqual(error.errors, [readFailure, closeFailure])
      assert.ok(error.message.includes(readFailure.message))
      assert.ok(error.message.includes(closeFailure.message))
      return true
    })
    assert.equal(existsSync(path), false)
    assert.equal(attempts, 1)
    assert.equal(closes, 1)
    const retry = nodeSqliteAdapter.open(path)
    try {
      assert.equal(attempts, 2)
      assert.equal(closes, 2)
      assert.equal(existsSync(path), true)
    } finally { retry.close() }
    const cached = nodeSqliteAdapter.open(path)
    try { assert.equal(attempts, 2) } finally { cached.close() }
  } finally {
    t.mock.restoreAll()
    rmSync(dir, { recursive: true, force: true })
  }
})
