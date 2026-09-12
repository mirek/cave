import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { createToolSurface } from '../src/server.ts'
import { tools } from '../src/tools.ts'

const requests: [string, Record<string, unknown>][] = [
  ['cave_fuse', { pattern: 'a HAS score: ?v', asOf: '2099', aliases: false }],
  ['cave_fuse', { about: 'a', aliases: false }],
  ['cave_fuse', { text: 'a HAS score: 20 ms +/- 2 ms', aliases: false }],
  ['cave_search', { query: 'evidence', limit: 1, raw: false }],
  ['cave_reconstruct', { seeds: ['a'], maxSteps: 2, maxClaims: 2 }],
  ['cave_export', { current: true, maxSensitivity: 'public' }]
]

for (const [name, values] of requests) {
  test(`${name} captures supplied ${Object.keys(values).join('/')} once`, () => {
    const store = open(), surface = createToolSurface(store)
    try {
      store.ingest('a IS evidence #sensitivity:public\nb IS evidence\na USES b\na HAS score: 10 ms +/- 2 ms')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const expected = surface.call(name, values)
      assert.equal(expected.isError, undefined)
      for (const direct of [false, true]) {
        const reads: Record<string, number> = {}
        const args: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(values)) {
          Object.defineProperty(args, key, { get() {
            reads[key] = (reads[key] ?? 0) + 1
            return reads[key] === 1 ? value : undefined
          } })
        }
        Object.defineProperty(args, 'unused', { get() { throw new Error('unused argument evaluated') } })
        if (direct) assert.equal(tools.find(tool => tool.name === name)!.run(store, args, {}), expected.content[0].text)
        else assert.deepEqual(surface.call(name, args), expected)
        assert.deepEqual(reads, Object.fromEntries(Object.keys(values).map(key => [key, 1])))
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })
}

test('MCP tools reject captured invalid values even when a later getter would correct them', () => {
  const store = open(), surface = createToolSurface(store)
  try {
    store.ingest('a HAS score: 10 ms +/- 2 ms')
    for (const [name, values] of requests) {
      for (const field of Object.keys(values).filter(key => key !== 'aliases' && key !== 'raw' && key !== 'current')) {
        let reads = 0
        const args = { ...values }
        Object.defineProperty(args, field, { get() { return ++reads === 1 ? null : values[field] } })
        assert.equal(surface.call(name, args).isError, true, `${name}.${field}`)
        assert.equal(reads, 1, `${name}.${field}`)
      }
      assert.equal(surface.call(name, values).isError, undefined)
    }
  } finally { store.close() }
})
