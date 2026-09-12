import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { open } from '@cavelang/store'
import { allowsActions, scopedTools, scopedActionTools, type Scope } from '../src/tools.ts'
import { createServer, createToolSurface, serve } from '../src/server.ts'

test('MCP scope rejects malformed readOnly rather than exposing write tools', () => {
  const store = open()
  try {
    store.ingest('action/record HAS action: `?value => target HAS value: ?value`')
    const before = store.exportText({ tx: true })
    for (const readOnly of ['true', 'false', null, 0, 1, [], {}]) {
      const scope = { readOnly } as unknown as Scope
      for (const inspect of [
        () => scopedTools(scope), () => allowsActions(scope),
        () => scopedActionTools(store, scope), () => createToolSurface(store, scope),
        () => createServer(store, scope)
      ]) assert.throws(inspect, /readOnly must be a boolean/)
    }
    const readOnly = createToolSurface(store, { readOnly: true })
    assert.ok(readOnly.list().every(tool => tool.name !== 'cave_add' && !tool.name.startsWith('act_')))
    assert.throws(() => readOnly.call('cave_add', { text: 'unexpected IS write' }), /Unknown tool/)
    assert.throws(() => readOnly.call('act_record', { value: 'unexpected' }), /Unknown tool/)
    assert.equal(store.exportText({ tx: true }), before)
    assert.deepEqual(createToolSurface(store, { readOnly: false }).list(), createToolSurface(store).list())
    assert.ok(createToolSurface(store).list().some(tool => tool.name === 'act_record'))
  } finally { store.close() }
})

for (const field of ['permissions', 'tools'] as const) {
  test(`MCP scope rejects malformed ${field} lists consistently`, () => {
    const store = open()
    try {
      for (const value of [null, 'read', {}, new Set(['read']), new Array(1), [null], ['read', 42]]) {
        const scope = { [field]: value } as unknown as Scope
        for (const inspect of [
          () => scopedTools(scope), () => allowsActions(scope),
          () => scopedActionTools(store, scope), () => createToolSurface(store, scope),
          () => createServer(store, scope)
        ]) assert.throws(inspect, new RegExp(`${field} must be an array of strings`))
      }
      assert.throws(() => createToolSurface(store, { [field]: [] }), /serves no tools/)
      const scope: Scope = field === 'permissions' ? { permissions: ['read'] } : { tools: ['cave_query'] }
      const surface = createToolSurface(store, scope)
      assert.ok(surface.list().some(tool => tool.name === 'cave_query'))
      assert.ok(!surface.list().some(tool => tool.name === 'cave_add'))
      assert.equal(allowsActions(scope), false)
      assert.deepEqual(scopedActionTools(store, scope), [])
    } finally { store.close() }
  })
}


for (const field of ['readOnly', 'permissions', 'tools'] as const) {
  test(`stdio rejects malformed ${field} scope before buffered writes`, async () => {
    const store = open(), input = new PassThrough(), output = new PassThrough()
    let text = ''
    output.setEncoding('utf8').on('data', chunk => { text += chunk })
    try {
      store.ingest('original IS service')
      const before = store.exportText({ tx: true })
      input.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'cave_add', arguments: { text: 'unexpected IS write' }, _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
          'io.modelcontextprotocol/clientCapabilities': {}
        }
      } }) + '\n')
      const scope = { [field]: field === 'readOnly' ? 'true' : null } as unknown as Scope
      await assert.rejects(async () => serve(store, input, output, scope), new RegExp(`${field} must be`))
      assert.deepEqual(JSON.parse(text), { jsonrpc: '2.0', id: 1,
        error: { code: -32603, message: 'Internal server error' } })
      assert.equal(store.exportText({ tx: true }), before)
      assert.equal(input.listenerCount('data'), 0)
      assert.equal(input.listenerCount('error'), 0)
      assert.equal(output.listenerCount('error'), 0)
      const recovered = createToolSurface(store, { readOnly: true })
      assert.equal(recovered.call('cave_query', { pattern: '?x IS service' }).isError, undefined)
    } finally { input.destroy(); output.destroy(); store.close() }
  })
}

test('MCP static and action scope helpers reject unknown names consistently', () => {
  const store = open()
  try {
    store.ingest('action/record HAS action: `?value => target HAS value: ?value`')
    const cases: [Scope, RegExp][] = [
      [{ permissions: ['action', 'unknown' as 'read'] }, /unknown permission\(s\): unknown/],
      [{ tools: ['act_record', 'cave_typo'] }, /unknown tool\(s\): cave_typo/],
      [{ readOnly: true, permissions: ['unknown' as 'read'] }, /unknown permission\(s\): unknown/],
      [{ permissions: ['read'], tools: ['cave_typo'] }, /unknown tool\(s\): cave_typo/]
    ]
    for (const [scope, expected] of cases) {
      for (const inspect of [() => scopedTools(scope), () => allowsActions(scope),
        () => scopedActionTools(store, scope)]) assert.throws(inspect, expected)
    }
    const future = { tools: ['act_future'], permissions: ['action'] } as const
    assert.equal(allowsActions(future), true)
    assert.deepEqual(scopedTools(future), [])
    assert.deepEqual(scopedActionTools(store, future), [])
    store.ingest('action/future HAS action: `?value => target HAS future: ?value`')
    assert.deepEqual(scopedActionTools(store, future).map(tool => tool.name), ['act_future'])
  } finally { store.close() }
})

test('MCP connections own their scope while action declarations remain dynamic', () => {
  const store = open()
  try {
    store.ingest('action/allowed HAS action: `?value => target HAS allowed: ?value`\naction/other HAS action: `?value => target HAS other: ?value`')
    const options = { tools: ['act_allowed', 'act_future'], permissions: ['action'] as ('action' | 'read')[], readOnly: false }
    const surface = createToolSurface(store, options)
    assert.deepEqual(surface.list().map(tool => tool.name), ['act_allowed'])
    options.tools.splice(0, options.tools.length, 'act_other')
    assert.deepEqual(surface.list().map(tool => tool.name), ['act_allowed'])
    assert.throws(() => surface.call('act_other', { value: 'unexpected' }), /Unknown tool/)
    options.permissions.splice(0, 1, 'read')
    options.readOnly = true
    store.ingest('action/future HAS action: `?value => target HAS future: ?value`')
    assert.deepEqual(surface.list().map(tool => tool.name), ['act_allowed', 'act_future'])
    assert.equal(surface.call('act_future', { value: 'permitted' }).isError, undefined)
    assert.ok(store.currentBeliefs().some(row => row.attribute === 'future'))
    assert.ok(!store.currentBeliefs().some(row => row.attribute === 'other'))
  } finally { store.close() }
})

test('MCP surface and SDK server capture declared scope getters once', () => {
  const store = open()
  try {
    for (const create of [createToolSurface, createServer]) {
      const reads = { readOnly: 0, permissions: 0, tools: 0 }
      create(store, {
        get readOnly() { reads.readOnly++; return true },
        get permissions() { reads.permissions++; return ['read'] as const },
        get tools() { reads.tools++; return ['cave_query'] }
      })
      assert.deepEqual(reads, { readOnly: 1, permissions: 1, tools: 1 })
    }
  } finally { store.close() }
})

test('stdio keeps connection scope across requests while permitted declarations change', async () => {
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), fallback = setTimeout(() => controller.abort(), 5000)
  const options = { tools: ['act_allowed', 'act_future'], permissions: ['action'] as ('action' | 'read')[], readOnly: false, signal: controller.signal }
  const serving = serve(store, input, output, options)
  let id = 0
  const send = async (method: string, params: Record<string, unknown> = {}) => {
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
    return response
  }
  try {
    store.ingest('action/allowed HAS action: `?value => target HAS allowed: ?value`\naction/other HAS action: `?value => target HAS other: ?value`')
    const first = await send('tools/list')
    assert.deepEqual(first.result.tools.map((tool: { name: string }) => tool.name), ['act_allowed'])
    options.tools.splice(0, options.tools.length, 'act_other')
    options.permissions.splice(0, 1, 'read')
    options.readOnly = true
    store.ingest('action/future HAS action: `?value => target HAS future: ?value`')
    const next = await send('tools/list')
    assert.equal(next.error, undefined)
    assert.deepEqual(next.result.tools.map((tool: { name: string }) => tool.name), ['act_allowed', 'act_future'])
    const denied = await send('tools/call', { name: 'act_other', arguments: { value: 'unexpected' } })
    assert.equal(denied.error?.code, -32602)
    const permitted = await send('tools/call', { name: 'act_future', arguments: { value: 'expected' } })
    assert.equal(permitted.error, undefined)
    assert.equal(permitted.result.isError, undefined)
    assert.ok(store.currentBeliefs().some(row => row.attribute === 'future'))
    assert.ok(!store.currentBeliefs().some(row => row.attribute === 'other'))
    input.end()
    await serving
    assert.equal(controller.signal.aborted, false)
  } finally {
    clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
})
