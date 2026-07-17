import * as assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openWith } from '../src/runtime.ts'
import type { Adapter } from '../src/adapter.ts'

type Expectations = {
  readonly backup: boolean
  readonly fullText: 'fts4' | 'fts5'
  readonly loadExtension: boolean
}

/** Register the same behavioral contract for every supported SQLite adapter. */
export const sqliteAdapterContract = (
  adapter: Adapter,
  expectations: Expectations
): void => {
  test(`${adapter.name}: declares the capabilities CAVE composes`, () => {
    assert.deepEqual(adapter.capabilities.transactions, { immediate: true, savepoints: true })
    assert.equal(adapter.capabilities.fullText, expectations.fullText)
    assert.equal(adapter.capabilities.backup !== undefined, expectations.backup)
    assert.equal(adapter.capabilities.loadExtension !== undefined, expectations.loadExtension)
  })

  test(`${adapter.name}: supports SQL, nested transactions, and full-text search`, () => {
    const store = openWith(adapter)
    try {
      store.ingest('api HAS owner: platform\napi HAS note: "adapter contract"', { strict: true })
      assert.equal(store.currentBeliefs().length, 2)
      assert.equal(store.search('adapter contract').length, 1)

      assert.throws(() => store.transaction(() => {
        store.ingest('api HAS state: outer')
        store.transaction(() => store.ingest('api HAS state: inner'))
        throw new Error('rollback contract')
      }), /rollback contract/)
      assert.equal(store.currentBeliefs().length, 2)
    } finally {
      store.close()
    }
  })

  if (expectations.backup) {
    test(`${adapter.name}: snapshot capability writes a readable database`, () => {
      const directory = mkdtempSync(join(tmpdir(), "cave-adapter-contract-'-"))
      const source = join(directory, 'source.db')
      const snapshot = join(directory, 'snapshot.db')
      const capability = adapter.capabilities.backup!
      const db = adapter.open(source)
      try {
        db.exec('CREATE TABLE contract (value TEXT); INSERT INTO contract VALUES (\'ok\')')
        assert.equal(capability.inTransaction(db), false)
        assert.equal(capability.location(db), realpathSync(source))
        capability.write(db, snapshot)
      } finally {
        db.close()
      }
      try {
        const copy = adapter.open(snapshot, { readOnly: true })
        try {
          const rows = copy.prepare('SELECT value FROM contract').all()
          assert.equal(rows.length, 1)
          assert.equal(rows[0]?.['value'], 'ok')
        } finally {
          copy.close()
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}
