import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { open } from '@cavelang/store'
import { exportCommand, querySourcesCommand } from '@cavelang/cli'

for (const kind of ['record', 'message'] as const) for (const phase of ['sync work', 'async work', 'close'] as const) {
  test(`CLI retains output and closes its store after unprintable ${kind} during ${phase}`, async t => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'cave-unprintable-cleanup-'))
    const path = join(directory, 'store.db')
    const seed = open(path)
    seed.ingest('api IS service')
    seed.close()
    const target = fs.realpathSync(path)
    const failure = kind === 'record' ? Object.create(null) : new Error('hidden')
    if (kind === 'message') Object.defineProperty(failure, 'message', { get() { throw new Error('message unavailable') } })
    const prepare = DatabaseSync.prototype.prepare
    const close = DatabaseSync.prototype.close
    let owned: DatabaseSync | undefined
    let closed = false
    let closes = 0
    try {
      t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
        const location = this.location()
        if (location !== null && fs.realpathSync(location) === target) owned = this
        return prepare.call(this, sql)
      })
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
        const location = this.location()
        close.call(this)
        if (location !== null && fs.realpathSync(location) === target) {
          closed = true
          closes++
          throw phase === 'close' ? failure : new Error('cleanup also failed')
        }
      })
      if (phase === 'sync work') t.mock.method(fs, 'writeFileSync', () => { throw failure })
      const result = phase === 'async work'
        ? await querySourcesCommand(['--db', path, '--sources', '?entity IS service'], { get fetchImpl(): never { throw failure } })
        : exportCommand(['--db', path, ...(phase === 'sync work' ? ['--out', join(directory, 'output.cave')] : [])])
      assert.equal(result.code, 1)
      assert.equal(closes, 1)
      if (phase === 'close') {
        assert.match(result.out, /api IS service/)
        assert.equal(result.err, 'store close failed: [unprintable thrown value]\n')
      } else {
        assert.equal(result.out, '')
        assert.equal(result.err, '[unprintable thrown value]\nstore close failed: cleanup also failed\n')
      }
    } finally {
      t.mock.restoreAll()
      if (!closed && owned !== undefined) close.call(owned)
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}
