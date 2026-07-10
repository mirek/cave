import assert from 'node:assert/strict'
import test from 'node:test'
import { query } from '@cavelang/query'
import { open } from '@cavelang/store'

const family = `
PARENT-OF IS verb
PARENT-OF REVERSE CHILD-OF
helena PARENT-OF jan
jan PARENT-OF maria @src:archive @ 95%
maria PARENT-OF anna
anna PARENT-OF me
`

test('SQLite WASM runs the real CAVE ingest and query path', () => {
  const store = open(':memory:')
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
