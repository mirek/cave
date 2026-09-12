import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { open } from '@cavelang/store'
import { createToolSurface, serve } from '../src/server.ts'

test('generated action schemas advertise supported scalar arguments and reject extra names', () => {
  const store = open(), surface = createToolSurface(store)
  try {
    store.ingest('action/record HAS action: `?value => target HAS value: ?value`')
    const tool = surface.list().find(tool => tool.name === 'act_record')!
    assert.ok(tool)
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.deepEqual(tool.inputSchema.required, ['value'])
    assert.deepEqual(tool.inputSchema.properties?.['value'], {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }]
    })
    const before = store.exportText({ tx: true })
    for (const args of [{}, { value: null }, { value: [] }, { value: {} }, { value: 'ok', extra: 'unexpected' }]) {
      assert.equal(surface.call('act_record', args).isError, true)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const value of ['ready', 0, 0.0000001, true, false]) {
      const result = surface.call('act_record', { value })
      assert.equal(result.isError, undefined, JSON.stringify(value))
      const row = store.currentBeliefs().find(row => row.subject === 'target' && row.attribute === 'value')!
      assert.ok(row)
      const claim = store.toClaim(row)
      assert.equal(claim.payload.kind, 'attribute')
      if (claim.payload.kind === 'attribute') {
        assert.equal(claim.payload.value.raw, value === 0.0000001 ? '0.0000001' : String(value))
      }
    }
  } finally { store.close() }
})


test('stdio advertises scalar action schemas and executes numeric and boolean arguments', async () => {
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), fallback = setTimeout(() => controller.abort(), 5000)
  const serving = serve(store, input, output, { signal: controller.signal })
  let id = 0
  const send = async (method: string, params: Record<string, unknown>) => {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: {
      ...params, _meta: {
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
    store.ingest('action/record HAS action: `?value => target HAS value: ?value`')
    const listed = await send('tools/list', {})
    const schema = listed.tools.find((tool: { name: string }) => tool.name === 'act_record').inputSchema
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual(schema.required, ['value'])
    assert.deepEqual(schema.properties.value.anyOf, [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }])
    const before = store.exportText({ tx: true })
    for (const args of [{ value: null }, { value: {} }, { value: 1, extra: true }]) {
      assert.equal((await send('tools/call', { name: 'act_record', arguments: args })).isError, true)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const value of [0.0000001, true, false]) {
      const result = await send('tools/call', { name: 'act_record', arguments: { value } })
      assert.equal(result.isError, undefined)
      const row = store.currentBeliefs().find(row => row.subject === 'target' && row.attribute === 'value')!
      const claim = store.toClaim(row)
      assert.equal(claim.payload.kind, 'attribute')
      if (claim.payload.kind === 'attribute') {
        assert.equal(claim.payload.value.raw, value === 0.0000001 ? '0.0000001' : String(value))
      }
    }
    input.end()
    await serving
    assert.equal(controller.signal.aborted, false)
  } finally {
    clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
})
