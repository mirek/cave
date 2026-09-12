import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
import { sqliteAdapterContract } from './adapter-contract.ts'

sqliteAdapterContract(nodeSqliteAdapter, {
  backup: true,
  fullText: 'fts5',
  loadExtension: true,
})


test('native adapter preserves complete TEXT in get and all results', () => {
  const db = nodeSqliteAdapter.open(':memory:')
  try {
    for (const text of ['before\0after', 'é\0東京', '\0start', 'end\0']) {
      const stmt = db.prepare('SELECT ? AS value')
      assert.equal(stmt.get(text)?.value, text)
      assert.equal(stmt.all(text)[0]?.value, text)
    }
  } finally { db.close() }
})
