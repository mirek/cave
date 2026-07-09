import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { agentSource, createServer, instructions, instructionsFor, scopedTools, tools } from '@cavelang/mcp'

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
  const listed = response.result?.['tools'] as {
    name: string, description: string, inputSchema: { type: string },
    annotations?: { readOnlyHint?: boolean }
  }[]
  assert.deepEqual(
    listed.map(tool => tool.name),
    ['cave_add', 'cave_query', 'cave_search', 'cave_about', 'cave_neighbors',
      'cave_reconstruct', 'cave_export', 'cave_lint']
  )
  for (const tool of listed) {
    assert.equal(tool.inputSchema.type, 'object', tool.name)
    assert.ok(tool.description.length > 20, tool.name)
    // Read tools advertise it (MCP tool annotations); cave_add stays at
    // the protocol defaults.
    assert.deepEqual(tool.annotations, tool.name === 'cave_add' ? undefined : { readOnlyHint: true }, tool.name)
  }
  assert.equal(listed.length, tools.length)
  store.close()
})

test('read-only scope drops cave_add from list, call and instructions', () => {
  const store = open()
  store.ingest('auth USES jwt')
  const server = createServer(store, { readOnly: true })
  const listed = (server.handle(request(40, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.equal(listed.length, tools.length - 1)
  assert.ok(!listed.some(tool => tool.name === 'cave_add'))
  const denied = server.handle(request(41, 'tools/call', { name: 'cave_add', arguments: { text: 'a USES b' } })) as Response
  assert.equal(denied.error?.code, -32602, 'hidden tools are indistinguishable from nonexistent')
  assert.equal(store.currentBeliefs().length, 1, 'nothing was appended')
  const queried = call(server, 42, 'cave_query', { pattern: '?x USES jwt' })
  assert.match(contentText(queried), /\?x = auth/, 'read tools still work')
  const initialized = server.handle(request(43, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })) as Response
  const served = initialized.result?.['instructions'] as string
  assert.doesNotMatch(served, /cave_add/)
  assert.match(served, /read-only/)
  store.close()
})

test('a tools list serves exactly the named tools; --read-only narrows it', () => {
  const store = open()
  store.ingest('auth USES jwt')
  const server = createServer(store, { tools: ['cave_query', 'cave_about'] })
  const listed = (server.handle(request(50, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.deepEqual(listed.map(tool => tool.name), ['cave_query', 'cave_about'])
  const denied = server.handle(request(51, 'tools/call', { name: 'cave_export', arguments: {} })) as Response
  assert.equal(denied.error?.code, -32602)
  assert.match(contentText(call(server, 52, 'cave_about', { entity: 'auth' })), /auth USES jwt/)

  const narrowed = createServer(store, { readOnly: true, tools: ['cave_add', 'cave_query'] })
  const remaining = (narrowed.handle(request(53, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.deepEqual(remaining.map(tool => tool.name), ['cave_query'])
  store.close()
})

test('a scope that names unknown tools or serves nothing fails loudly', () => {
  assert.throws(() => scopedTools({ tools: ['cave_query', 'cave_nope'] }), /unknown tool\(s\): cave_nope/)
  assert.throws(() => scopedTools({ readOnly: true, tools: ['cave_add'] }), /serves no tools/)
  const store = open()
  assert.throws(() => createServer(store, { tools: [] }), /serves no tools/)
  store.close()
})

test('instructionsFor mentions only served tools and covers the full surface', () => {
  assert.equal(instructionsFor(tools), instructions)
  assert.match(instructions, /cave_reconstruct/)
  const queryOnly = instructionsFor(scopedTools({ tools: ['cave_query'] }))
  assert.match(queryOnly, /cave_query patterns/)
  assert.doesNotMatch(queryOnly, /cave_add|cave_about|cave_reconstruct/)
  assert.match(queryOnly, /read-only/)
  const lintOnly = instructionsFor(scopedTools({ tools: ['cave_lint', 'cave_export'] }))
  assert.match(lintOnly, /Validate CAVE text with cave_lint\./)
  assert.doesNotMatch(lintOnly, /cave_add/)
  const searchOnly = instructionsFor(scopedTools({ tools: ['cave_search'] }))
  assert.match(searchOnly, /read-only/, 'no guidance clause still gets the read-only note')
  // The full surface keeps the add guidance and stays silent on read-only.
  assert.match(instructions, /stamped with your agent source/)
  assert.doesNotMatch(instructions, /read-only/)
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

test('cave_query, cave_about and cave_neighbors resolve aliases on request (spec §13.6)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql\nbilling USES postgres\nanalytics USES postgresql')
  const server = createServer(store)
  const exact = contentText(call(server, 30, 'cave_query', { pattern: '?x USES postgres' }))
  assert.equal(exact, '?x = billing  ; billing USES postgres')
  const widened = contentText(call(server, 31, 'cave_query', { pattern: '?x USES postgres', aliases: true }))
  assert.match(widened, /\?x = billing/)
  assert.match(widened, /\?x = analytics/)
  const about = contentText(call(server, 32, 'cave_about', { entity: 'postgres', aliases: true }))
  assert.match(about, /analytics USES postgresql/, 'stored names come back untouched')
  const neighbors = contentText(call(server, 33, 'cave_neighbors', { entity: 'postgres', aliases: true }))
  assert.match(neighbors, /postgresql USED-BY analytics/)
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

test('cave_add stamps agent provenance from the initialize client name (spec §9.5)', () => {
  const store = open()
  const server = createServer(store)
  server.handle(request(20, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'Claude Code', version: '2.0' }
  }))
  call(server, 21, 'cave_add', { text: 'auth USES jwt' })
  const [stamped] = store.currentBeliefs()
  assert.deepEqual(store.toClaim(stamped!).contexts, ['src:agent/claude-code'])
  call(server, 22, 'cave_add', { text: 'api USES jwt @src:design-doc' })
  const written = store.currentBeliefs().find(row => row.subject === 'api')
  assert.deepEqual(store.toClaim(written!).contexts, ['src:design-doc'], 'a written @src: wins')
  store.close()
})

test('cave_add stamps plain agent before initialize; options override (spec §9.5)', () => {
  const unnamed = open()
  call(createServer(unnamed), 23, 'cave_add', { text: 'a USES b' })
  assert.deepEqual(unnamed.toClaim(unnamed.currentBeliefs()[0]!).contexts, ['src:agent'])
  unnamed.close()

  const explicit = open()
  call(createServer(explicit, { source: 'pipeline/nightly' }), 24, 'cave_add', { text: 'a USES b' })
  assert.deepEqual(explicit.toClaim(explicit.currentBeliefs()[0]!).contexts, ['src:pipeline/nightly'])
  explicit.close()

  const disabled = open()
  call(createServer(disabled, { source: false }), 25, 'cave_add', { text: 'a USES b' })
  assert.deepEqual(disabled.toClaim(disabled.currentBeliefs()[0]!).contexts, [])
  disabled.close()
})

test('agentSource normalizes client names into context-safe stamps (spec §9.5)', () => {
  assert.equal(agentSource('Claude Code'), 'agent/claude-code')
  assert.equal(agentSource('copilot-cli'), 'agent/copilot-cli')
  assert.equal(agentSource(undefined), 'agent')
  assert.equal(agentSource('   '), 'agent')
  assert.equal(agentSource('Weird!!Name (beta)'), 'agent/weirdname-beta')
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
