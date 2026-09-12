import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { readSnapshot } from '../src/read-snapshot.ts'

for (const failedRead of [false, true]) {
  test(`MCP read snapshot retains release failure (failed read=${failedRead})`, t => {
    const store = open(), operation = new Error('read failed'), cleanup = new Error('release failed')
    const exec = store.db.exec.bind(store.db)
    try {
      t.mock.method(store.db, 'exec', (sql: string) => {
        if (sql === 'RELEASE cave_mcp_read') throw cleanup
        exec(sql)
      })
      assert.throws(() => readSnapshot(store, () => {
        if (failedRead) throw operation
        return 'unpublished result'
      }), error => {
        if (failedRead) {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [operation, cleanup])
          assert.equal(error.cause, operation)
        } else assert.equal(error, cleanup)
        return true
      })
      t.mock.restoreAll()
      exec('RELEASE cave_mcp_read')
      assert.equal(readSnapshot(store, () => 'recovered'), 'recovered')
    } finally { t.mock.restoreAll(); store.close() }
  })
}
