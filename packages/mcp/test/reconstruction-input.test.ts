import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { open } from '@cavelang/store'
import { createToolSurface, serve } from '../src/server.ts'

for (const kind of ['seeds', 'budget'] as const) {
  test(`MCP reconstruction rejects malformed ${kind} before graph traversal`, t => {
    const store = open(), surface = createToolSurface(store)
    let reads = 0
    const forward = store.forward.bind(store)
    t.mock.method(store, 'forward', (...args: Parameters<typeof forward>) => { reads++; return forward(...args) })
    try {
      store.ingest('a USES b\ncafé😀 USES library')
      const malformed = kind === 'seeds'
        ? [['a', 42], ['a', null], ['a', ''], ['a', , 'b'], [], 'a', null, ['a', 'bad\ud800name'], ['a', 'bad\udc00name']]
            .flatMap(seeds => [0, 2].map(maxSteps => ({ seeds, maxSteps })))
        : ['maxSteps', 'maxClaims'].flatMap(field =>
            ['1', null, false, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
              .map(value => ({ seeds: ['a'], [field]: value })))
      for (const args of malformed) {
        const result = surface.call('cave_reconstruct', args)
        assert.equal(result.isError, true, JSON.stringify(args))
      }
      assert.equal(reads, 0)
      const zero = surface.call('cave_reconstruct', { seeds: ['a'], maxSteps: 0, maxClaims: 0 })
      assert.equal(zero.isError, undefined)
      assert.match(zero.content[0].text, /expanded 0 cue/)
      assert.equal(reads, 0)
      const valid = surface.call('cave_reconstruct', { seeds: ['a'], maxSteps: 2, maxClaims: 2 })
      assert.equal(valid.isError, undefined)
      assert.match(valid.content[0].text, /a USES b/)
      assert.ok(reads > 0)
    } finally { store.close() }
  })
}


test('stdio reconstruction advertises strict inputs and recovers after malformed requests', async t => {
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), fallback = setTimeout(() => controller.abort(), 5000)
  const serving = serve(store, input, output, { signal: controller.signal })
  let id = 0, reads = 0
  const forward = store.forward.bind(store)
  t.mock.method(store, 'forward', (...args: Parameters<typeof forward>) => { reads++; return forward(...args) })
  const send = async (method: string, params: Record<string, unknown>) => {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    } }) + '\n')
    const [bytes] = await reply
    const response = JSON.parse(String(bytes))
    assert.equal(response.id, id)
    assert.equal(response.error, undefined)
    return response.result
  }
  try {
    store.ingest('a USES b\ncafé😀 USES library')
    const before = store.exportText({ tx: true })
    const listed = await send('tools/list', {})
    const schema = listed.tools.find((tool: { name: string }) => tool.name === 'cave_reconstruct').inputSchema
    assert.deepEqual(schema.required, ['seeds'])
    assert.equal(schema.properties.seeds.minItems, 1)
    assert.equal(schema.properties.seeds.items.minLength, 1)
    for (const field of ['maxSteps', 'maxClaims']) {
      assert.equal(schema.properties[field].type, 'integer')
      assert.equal(schema.properties[field].minimum, 0)
      assert.equal(schema.properties[field].maximum, Number.MAX_SAFE_INTEGER)
    }
    for (const args of [
      { seeds: ['a', null] }, { seeds: ['a', 42] }, { seeds: ['a', ''] }, { seeds: [] },
      ...['\ud800', '\udc00'].flatMap(bad => [0, 2].map(maxSteps => ({ seeds: ['a', `bad${bad}name`], maxSteps }))),
      ...['maxSteps', 'maxClaims'].flatMap(field => ['1', null, -1, 0.5]
        .map(value => ({ seeds: ['a'], [field]: value })))
    ]) {
      const result = await send('tools/call', { name: 'cave_reconstruct', arguments: args })
      assert.equal(result.isError, true)
      assert.equal(result.content.length, 1)
      assert.match(result.content[0].text, /must be/)
      assert.equal(reads, 0)
    }
    const zero = await send('tools/call', {
      name: 'cave_reconstruct', arguments: { seeds: ['a'], maxSteps: 0, maxClaims: 0 }
    })
    assert.equal(zero.isError, undefined)
    assert.match(zero.content[0].text, /expanded 0 cue/)
    assert.equal(reads, 0)
    const corrected = await send('tools/call', {
      name: 'cave_reconstruct', arguments: { seeds: ['a', 'café😀'], maxSteps: 2 }
    })
    assert.equal(corrected.isError, undefined)
    assert.match(corrected.content[0].text, /a USES b/)
    assert.match(corrected.content[0].text, /café😀 USES library/)
    assert.ok(reads > 0)
    assert.equal(store.exportText({ tx: true }), before)
    input.end()
    await serving
    assert.equal(controller.signal.aborted, false)
  } finally {
    clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
})
