import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import initSqlJs from 'sql.js'
import { query } from '@cavelang/query'
import { openWith } from '@cavelang/store/adapter'
import { createSqlJsAdapter } from '../src/playground/sqlite-adapter.ts'
import { sqliteAdapterContract } from '../../packages/store/test/adapter-contract.ts'

const require = createRequire(import.meta.url)
const sqlite = await initSqlJs({
  locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
})
const adapter = createSqlJsAdapter(sqlite)

sqliteAdapterContract(adapter, {
  backup: false,
  fullText: 'fts4',
  loadExtension: false,
})

test('runtime selection uses adapter injection, not module replacement', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { scripts: { test: string } }
  assert.doesNotMatch(vite, /node:sqlite/)
  assert.equal(manifest.scripts.test, 'node --test test/runtime.test.ts')
})

const family = `
PARENT-OF IS verb
PARENT-OF REVERSE CHILD-OF
helena PARENT-OF jan
jan PARENT-OF maria @src:archive @ 95%
maria PARENT-OF anna
anna PARENT-OF me
`

test('SQLite WASM runs the real CAVE ingest and query path', () => {
  const store = openWith(adapter, ':memory:')
  try {
    const ingested = store.ingest(family, { strict: true, source: 'playground/test' })
    assert.equal(ingested.ids.length, 6)

    const ancestors = query(store, '?ancestor PARENT-OF+ me')
      .map(match => match.bindings['ancestor'])
      .sort()
    assert.deepEqual(ancestors, ['anna', 'helena', 'jan', 'maria'])

    const descendants = query(store, '?descendant CHILD-OF+ helena')
      .map(match => match.bindings['descendant'])
      .sort()
    assert.deepEqual(descendants, ['anna', 'jan', 'maria', 'me'])
  } finally {
    store.close()
  }
})
