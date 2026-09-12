import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { sqliteStore } from '@cavelang/loop'

for (const method of ['forward', 'reverse', 'claimsAbout'] as const) {
  test(`SQLite loop ${method} projects metadata within its row-selection snapshot`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-loop-read-'))
    const path = join(dir, 'knowledge.db'), writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('a USES b #phase:before\na IS service #phase:before')
    const reader = open(path, { access: 'read-only' })
    try {
      const adapter = sqliteStore(reader), entity = method === 'reverse' ? 'b' : 'a'
      const before = adapter[method](entity)
      assert.ok(before.length > 0)
      const toClaim = reader.toClaim.bind(reader)
      let changed = false
      t.mock.method(reader, 'toClaim', (row: Parameters<typeof toClaim>[0]) => {
        if (!changed) {
          changed = true
          writer.db.prepare("UPDATE cave_tag SET value = 'after' WHERE key = 'phase'").run()
        }
        return toClaim(row)
      })
      assert.deepEqual(adapter[method](entity), before)
      assert.equal(changed, true)
      const after = adapter[method](entity)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, sqliteStore(writer)[method](entity))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const method of ['forward', 'reverse', 'claimsAbout'] as const) {
  test(`SQLite loop ${method} preserves caller transaction ownership`, () => {
    const store = open(), adapter = sqliteStore(store), rollback = new Error('outer rollback')
    const entity = method === 'reverse' ? 'b' : 'a'
    try {
      assert.throws(() => store.transaction(() => {
        store.ingest('a USES b')
        assert.ok(adapter[method](entity).length > 0)
        assert.throws(() => adapter[method]('\ud800'), /surrogate/)
        assert.ok(adapter[method](entity).length > 0)
        throw rollback
      }), error => error === rollback)
      assert.equal(adapter[method](entity).length, 0)
      store.ingest('a USES b')
      assert.ok(adapter[method](entity).length > 0)
    } finally { store.close() }
  })
}

for (const method of ['forward', 'reverse', 'claimsAbout'] as const) {
  test(`SQLite loop ${method} retains projection and post-release errors and retries inside caller transaction`, t => {
    const store = open(), adapter = sqliteStore(store)
    const entity = method === 'reverse' ? 'b' : 'a'
    const operation = { toString() { throw new Error('cannot print operation') } }
    const cleanup = new Error('release reported failure after completion')
    const rollback = new Error('caller rollback')
    try {
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.throws(() => store.transaction(() => {
        store.ingest('a USES b #phase:caller')
        const expected = adapter[method](entity)
        assert.ok(expected.length > 0)
        const exec = store.db.exec.bind(store.db)
        const release = t.mock.method(store.db, 'exec', (sql: string) => {
          exec(sql)
          if (sql === 'RELEASE cave_loop_read') throw cleanup
        })
        const projection = t.mock.method(store, 'toClaim', () => { throw operation })
        assert.throws(() => adapter[method](entity), error => {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [operation, cleanup])
          assert.equal(error.cause, operation)
          assert.match(error.message, /\[unprintable thrown value\]/)
          assert.match(error.message, /release reported failure after completion/)
          return true
        })
        projection.mock.restore()
        release.mock.restore()
        assert.deepEqual(adapter[method](entity), expected)
        store.ingest('after IS usable')
        throw rollback
      }), error => error === rollback)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(adapter[method](entity), [])
      store.ingest('a USES b')
      assert.ok(adapter[method](entity).length > 0)
    } finally { t.mock.restoreAll(); store.close() }
  })
}
