import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { createToolSurface } from '../src/server.ts'

const cases: [string, string, Record<string, unknown>][] = [
  ...['all', 'aliases', 'resolve'].map(field => ['cave_query', field, { pattern: '?x IS service' }] as [string, string, Record<string, unknown>]),
  ['cave_fuse', 'aliases', { about: 'a' }],
  ['cave_search', 'raw', { query: 'service' }],
  ...['aliases', 'resolve'].map(field => ['cave_about', field, { entity: 'a' }] as [string, string, Record<string, unknown>]),
  ...['aliases', 'resolve'].map(field => ['cave_neighbors', field, { entity: 'a' }] as [string, string, Record<string, unknown>]),
  ['cave_export', 'current', {}]
]
for (const [tool, field, args] of cases) {
  test(`${tool} rejects malformed ${field} while preserving boolean defaults`, () => {
    const store = open(), surface = createToolSurface(store)
    try {
      store.ingest('a IS service\na USES b\na HAS score: 10 ms +/- 2 ms')
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const value of ['true', 'false', null, 0, [], {}]) {
        const result = surface.call(tool, { ...args, [field]: value })
        assert.equal(result.isError, true, JSON.stringify(value))
        assert.deepEqual(result.content, [{ type: 'text', text: `${field} must be a boolean` }])
      }
      const omitted = surface.call(tool, args)
      assert.equal(omitted.isError, undefined)
      assert.deepEqual(surface.call(tool, { ...args, [field]: false }), omitted)
      assert.equal(surface.call(tool, { ...args, [field]: true }).isError, undefined)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    } finally { store.close() }
  })
}

test('fusion validates aliases even with no matching estimates', () => {
  const store = open()
  try {
    assert.equal(createToolSurface(store).call('cave_fuse', { about: 'missing', aliases: 'true' }).isError, true)
  } finally { store.close() }
})
