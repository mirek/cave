import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Value } from '@cavelang/core'
import { createToolSurface } from '../src/server.ts'

for (const kind of ['selector', 'asOf'] as const) {
  test(`MCP fusion rejects malformed ${kind} without silently choosing another request`, () => {
    const store = open(), surface = createToolSurface(store)
    try {
      store.ingest('a HAS score: 10 ms +/- 2 ms')
      const history = store.exportText({ tx: true })
      const malformed = kind === 'selector'
        ? [
            { about: 'a', text: 42 },
            { pattern: 'a HAS score: ?v', about: false },
            { text: 'a IS 10 ms +/- 2 ms', pattern: null },
            { about: null }, { pattern: false }, { text: 42 }
          ]
        : [null, false, 42, []].flatMap(asOf => [
            { pattern: 'a HAS score: ?v', asOf },
            { about: 'a', asOf },
            { text: 'a IS 10 ms +/- 2 ms', asOf }
          ])
      for (const args of malformed) {
        const result = surface.call('cave_fuse', args)
        assert.equal(result.isError, true, JSON.stringify(args))
        assert.match(result.content[0].text, /exactly one|must be|composes with/)
      }
      assert.equal(store.exportText({ tx: true }), history)
      const valid = surface.call('cave_fuse', { pattern: 'a HAS score: ?v' })
      assert.equal(valid.isError, undefined)
      assert.match(valid.content[0].text, /fused 1 estimate/)
    } finally { store.close() }
  })
}

test('MCP fusion validates about Unicode even without matching estimates', () => {
  for (const populated of [false, true]) {
    const store = open(), surface = createToolSurface(store)
    try {
      if (populated) store.ingest('bad�name HAS score: 10 ms +/- 2 ms')
      const before = store.exportText({ tx: true })
      for (const aliases of [false, true]) {
        for (const surrogate of ['\ud800', '\udc00']) {
          const result = surface.call('cave_fuse', { about: `bad${surrogate}name`, aliases })
          assert.equal(result.isError, true)
          assert.match(result.content[0].text, /about.*unpaired UTF-16 surrogate/)
        }
        const valid = surface.call('cave_fuse', { about: 'bad�name', aliases })
        assert.equal(valid.isError, undefined)
        assert.match(valid.content[0].text, populated ? /fused 1 estimate/ : /no matching claims/)
      }
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  }
})

test('MCP fusion keeps finite boundary means writable after compact formatting', () => {
  for (const mean of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const store = open(), surface = createToolSurface(store)
    try {
      const result = surface.call('cave_fuse', { text: `sample HAS value: ${Value.formatNumber(mean)} +/- 1` })
      assert.equal(result.isError, undefined)
      const posterior = result.content[0].text.split('\n').find(line => line.startsWith('posterior: '))!
      assert.ok(posterior)
      const written = store.ingest(`result HAS value: ${posterior.slice('posterior: '.length)}`, { strict: true })
      assert.equal(written.ids.length, 1)
      const row = store.currentBeliefs().find(row => row.subject === 'result')!
      assert.equal(row.value_num, mean)
      assert.equal(row.delta_num, 1)
    } finally { store.close() }
  }
})
