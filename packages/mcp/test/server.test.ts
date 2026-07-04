import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { createServer, instructions, tools } from '@cavelang/mcp'

type Response = {
  jsonrpc: '2.0'
  id: null | string | number
  result?: Record<string, unknown>
  error?: { code: number, message: string }
}

const request = (id: string | number, method: string, params?: unknown) =>
  ({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } })

const call = (server: ReturnType<typeof createServer>, id: number, name: string, args: unknown): Response => {
  const response = server.handle(request(id, 'tools/call', { name, arguments: args })) as Response
  assert.ok(response, `expected a response for ${name}`)
  return response
}

const contentText = (response: Response): string => {
  const content = response.result?.['content'] as { type: string, text: string }[]
  assert.equal(content[0]!.type, 'text')
  return content[0]!.text
}

test('initialize echoes the client protocol version and advertises tools', () => {
  const store = open()
  const server = createServer(store)
  const response = server.handle(request(1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' }
  })) as Response
  assert.equal(response.result?.['protocolVersion'], '2025-03-26')
  assert.deepEqual(response.result?.['capabilities'], { tools: {} })
  assert.equal((response.result?.['serverInfo'] as { name: string }).name, 'cave')
  assert.equal(response.result?.['instructions'], instructions)
  assert.match(instructions, /subject VERB/)
  store.close()
})

test('notifications get no response; ping pongs; unknown methods error', () => {
  const store = open()
  const server = createServer(store)
  assert.equal(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
  const pong = server.handle(request(2, 'ping')) as Response
  assert.deepEqual(pong.result, {})
  const unknown = server.handle(request(3, 'resources/list')) as Response
  assert.equal(unknown.error?.code, -32601)
  const invalid = server.handle('nonsense') as Response
  assert.equal(invalid.error?.code, -32600)
  store.close()
})

test('tools/list exposes the full engine surface with schemas', () => {
  const store = open()
  const server = createServer(store)
  const response = server.handle(request(4, 'tools/list')) as Response
  const listed = response.result?.['tools'] as { name: string, description: string, inputSchema: { type: string } }[]
  assert.deepEqual(
    listed.map(tool => tool.name),
    ['cave_add', 'cave_query', 'cave_search', 'cave_about', 'cave_neighbors',
      'cave_reconstruct', 'cave_export', 'cave_lint']
  )
  for (const tool of listed) {
    assert.equal(tool.inputSchema.type, 'object', tool.name)
    assert.ok(tool.description.length > 20, tool.name)
  }
  assert.equal(listed.length, tools.length)
  store.close()
})

test('cave_add → cave_query round trip through the protocol', () => {
  const store = open()
  const server = createServer(store)
  const added = call(server, 5, 'cave_add', { text: 'auth/middleware USES jwt @ 90%\npackages/api PART-OF monorepo' })
  assert.match(contentText(added), /added 2 claim\(s\)/)
  const queried = call(server, 6, 'cave_query', { pattern: '?x USES jwt' })
  assert.equal(contentText(queried), '?x = auth/middleware  ; auth/middleware USES jwt @ 90%')
  const inverse = call(server, 7, 'cave_query', { pattern: 'monorepo CONTAINS ?x' })
  assert.match(contentText(inverse), /\?x = packages\/api/)
  store.close()
})

test('cave_about, cave_neighbors and cave_search read the graph', () => {
  const store = open()
  store.ingest('monorepo CONTAINS packages/api\nauth USES jwt ; json web tokens')
  const server = createServer(store)
  assert.match(contentText(call(server, 8, 'cave_about', { entity: 'packages/api' })), /monorepo CONTAINS packages\/api/)
  const neighbors = contentText(call(server, 9, 'cave_neighbors', { entity: 'packages/api' }))
  assert.equal(neighbors, 'packages/api PART-OF monorepo')
  assert.match(contentText(call(server, 10, 'cave_search', { query: 'json web tokens' })), /auth USES jwt/)
  store.close()
})

test('cave_reconstruct performs multi-hop recovery over the sqlite store (spec §18)', () => {
  const store = open()
  store.ingest([
    'auth/middleware HAS bug: token-expiry #security',
    'token-expiry CAUSE reject-valid-tokens',
    '`<=` FIX token-expiry @auth.ts:42',
    'topic/auth-hardening CONTAINS token-expiry',
    'topic/auth-hardening CONTAINS auth/middleware',
    'unrelated/service USES postgres'
  ].join('\n'))
  const server = createServer(store)
  const text = contentText(call(server, 11, 'cave_reconstruct', { seeds: ['reject-valid-tokens'] }))
  assert.match(text, /FIX token-expiry/)
  assert.match(text, /HAS bug: token-expiry/)
  assert.doesNotMatch(text, /unrelated\/service/)
  store.close()
})

test('cave_lint and cave_export', () => {
  const store = open()
  store.ingest('x HAS state: a @ 40%')
  store.ingest('x HAS state: b @ 90%')
  const server = createServer(store)
  assert.match(contentText(call(server, 12, 'cave_lint', { text: 'a USES b' })), /^ok: 1/)
  assert.match(contentText(call(server, 13, 'cave_lint', { text: 'a uses b' })), /line 1/)
  const current = contentText(call(server, 14, 'cave_export', { current: true }))
  assert.match(current, /state: b/)
  assert.doesNotMatch(current, /state: a/)
  store.close()
})

test('tool errors surface as isError results, not protocol failures', () => {
  const store = open()
  const server = createServer(store)
  const missing = call(server, 15, 'cave_query', {})
  assert.equal(missing.result?.['isError'], true)
  const unknownTool = server.handle(request(16, 'tools/call', { name: 'cave_nope', arguments: {} })) as Response
  assert.equal(unknownTool.error?.code, -32602)
  const strict = call(server, 17, 'cave_add', { text: 'a uses b', strict: true })
  assert.equal(strict.result?.['isError'], true)
  store.close()
})
