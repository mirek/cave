import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { createToolSurface } from '../src/server.ts'
import { tools } from '../src/tools.ts'

test('MCP query captures each declared argument once for validation and pagination', () => {
  const store = open(), surface = createToolSurface(store)
  try {
    const inserted = store.ingest('a IS service\nb IS service')
    const base = { pattern: '?x IS service', all: false, aliases: false, resolve: false,
      limit: 1, asOf: inserted.ids.at(-1)!, at: '2026' }
    const first = surface.call('cave_query', base)
    assert.equal(first.isError, undefined)
    const cursor = /next cursor: (.+)/.exec(first.content[0].text)?.[1]
    assert.ok(cursor)
    const query = tools.find(tool => tool.name === 'cave_query')!
    const history = store.exportText({ tx: true })
    for (const values of [base, { ...base, cursor }]) {
      const expected = surface.call('cave_query', values)
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
        if (direct) assert.equal(query.run(store, args, {}), expected.content[0].text)
        else assert.deepEqual(surface.call('cave_query', args), expected)
        assert.deepEqual(reads, Object.fromEntries(Object.keys(values).map(key => [key, 1])))
      }
    }
    assert.equal(store.exportText({ tx: true }), history)
  } finally { store.close() }
})

test('MCP query uses its captured anchor in interpolated output', () => {
  const store = open()
  try {
    store.ingest('db/query-time IS 5ms -> 800ms @2026-04-10..04-11')
    let reads = 0
    const result = createToolSurface(store).call('cave_query', {
      pattern: 'db/query-time IS',
      get at() { reads++; return reads <= 2 ? '2026-04-10T12:00:00Z' : 'changed-anchor' }
    })
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /; at 2026-04-10T12:00:00Z: 402\.5ms$/)
    assert.equal(reads, 1)
  } finally { store.close() }
})

test('MCP query validates the first captured value instead of a later replacement', () => {
  const store = open(), surface = createToolSurface(store)
  try {
    store.ingest('a IS service')
    for (const [field, replacement] of [['limit', 1], ['asOf', '2026'], ['at', '2026']] as const) {
      let reads = 0
      const result = surface.call('cave_query', { pattern: '?x IS service',
        get [field]() { return ++reads === 1 ? null : replacement }
      })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, new RegExp(`${field} must be`))
      assert.equal(reads, 1)
    }
    assert.equal(surface.call('cave_query', { pattern: '?x IS service', limit: 1 }).isError, undefined)
  } finally { store.close() }
})

for (const field of ['asOf', 'at', 'cursor'] as const) {
  test(`MCP query rejects malformed ${field} rather than dropping its scope`, () => {
    const store = open(), surface = createToolSurface(store)
    try {
      store.ingest('a IS service\nb IS service')
      const history = store.exportText({ tx: true })
      for (const value of [null, false, 42, [], {}]) {
        const result = surface.call('cave_query', { pattern: '?x IS service', [field]: value })
        assert.equal(result.isError, true, JSON.stringify(value))
        assert.deepEqual(result.content, [{ type: 'text', text: `${field} must be a non-empty string` }])
      }
      assert.equal(store.exportText({ tx: true }), history)
      const first = surface.call('cave_query', { pattern: '?x IS service', limit: 1 })
      assert.equal(first.isError, undefined)
      const cursor = /next cursor: (.+)/.exec(first.content[0].text)?.[1]
      assert.ok(cursor)
      const next = surface.call('cave_query', { pattern: '?x IS service', limit: 1, cursor })
      assert.equal(next.isError, undefined)
      assert.match(next.content[0].text, /\?x = b/)
      assert.doesNotMatch(next.content[0].text, /next cursor:/)
    } finally { store.close() }
  })
}

test('MCP about rejects malformed Unicode under every alias and resolution mode', () => {
  const store = open(), surface = createToolSurface(store)
  try {
    store.ingest('bad�name USES library')
    const before = store.exportText({ tx: true })
    for (const aliases of [false, true]) for (const resolve of [false, true]) {
      for (const surrogate of ['\ud800', '\udc00']) {
        const result = surface.call('cave_about', { entity: `bad${surrogate}name`, aliases, resolve })
        assert.equal(result.isError, true)
        assert.match(result.content[0].text, /unpaired UTF-16 surrogate/)
      }
      const valid = surface.call('cave_about', { entity: 'bad�name', aliases, resolve })
      assert.equal(valid.isError, undefined)
      assert.match(valid.content[0].text, /bad�name USES library/)
    }
    assert.equal(store.exportText({ tx: true }), before)
  } finally { store.close() }
})
