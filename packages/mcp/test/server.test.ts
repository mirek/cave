import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { Server as SdkServer } from '@modelcontextprotocol/server'
import { EventEmitter, getEventListeners, once } from 'node:events'
import { open } from '@cavelang/store'
import {
  agentSource, allowsActions, instructions, instructionsFor, scopedTools, serve, tools
} from '@cavelang/mcp'
import { createToolSurface } from '../src/server.ts'

test('programmatic source settings reject malformed provenance before writing and allow correction', () => {
  const store = open()
  const options: { source?: string | false } = {}
  try {
    const surface = createToolSurface(store, options)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const source of [null, true, 0, 42, [], {}, '', 'src:pipeline', '@pipeline', 'pipeline nightly',
      ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map(ending => `pipeline${ending}`)]) {
      options.source = source as string
      const reply = surface.call('cave_add', { text: 'a IS recorded' })
      assert.equal(reply.isError, true, JSON.stringify(source))
      assert.match(reply.content[0].text, /source must/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    options.source = 'pipeline/recovered'
    assert.equal(surface.call('cave_add', { text: 'a IS recorded' }).isError, undefined)
    assert.deepEqual(store.toClaim(store.currentBeliefs()[0]!).contexts, ['src:pipeline/recovered'])
  } finally { store.close() }
})

test('tool calls capture source configuration once and refresh it for the next call', () => {
  const store = open()
  let reads = 0
  try {
    const surface = createToolSurface(store, {
      get source(): string { return ++reads === 1 ? 'pipeline/first' : 'pipeline/next' }
    })
    assert.equal(reads, 0, 'configuration remains lazy until a call')
    assert.equal(surface.call('cave_add', { text: 'first IS recorded' }).isError, undefined)
    assert.deepEqual(store.toClaim(store.currentBeliefs()[0]!).contexts, ['src:pipeline/first'])
    assert.equal(reads, 1)
    assert.equal(surface.call('cave_add', { text: 'second IS recorded' }).isError, undefined)
    assert.equal(reads, 2)
    const second = store.currentBeliefs().find(row => row.subject === 'second')!
    assert.deepEqual(store.toClaim(second).contexts, ['src:pipeline/next'])
  } finally { store.close() }
})

test('tool calls capture the hooks option once while preserving lazy recovery', () => {
  const store = open()
  let reads = 0, fail = false
  try {
    const surface = createToolSurface(store, {
      get hooks(): Record<string, string> {
        reads++
        if (fail) throw new Error('hooks unavailable')
        return {}
      }
    })
    assert.equal(reads, 0)
    assert.equal(surface.call('cave_add', { text: 'first IS recorded' }).isError, undefined)
    assert.equal(reads, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    fail = true
    assert.equal(surface.call('cave_add', { text: 'second IS recorded' }).isError, true)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    fail = false
    assert.equal(surface.call('cave_add', { text: 'second IS recorded' }).isError, undefined)
    assert.equal(reads, 3)
  } finally { store.close() }
})

test('unprintable tool failures return a usable error reply and allow recovery', () => {
  const store = open()
  let fail = true
  try {
    const surface = createToolSurface(store, {
      get source(): false {
        if (fail) throw Object.create(null)
        return false
      }
    })
    assert.deepEqual(surface.call('cave_query', { pattern: '?s IS ?o' }), {
      content: [{ type: 'text', text: '[unprintable thrown value]' }], isError: true
    })
    fail = false
    store.ingest('local IS usable')
    const recovered = surface.call('cave_query', { pattern: '?s IS ?o' })
    assert.equal(recovered.isError, undefined)
    assert.match(recovered.content[0].text, /local/)
  } finally { store.close() }
})

type Response = {
  jsonrpc: '2.0'
  id: null | string | number
  result?: Record<string, unknown>
  error?: { code: number, message: string }
}

const request = (id: string | number, method: string, params?: unknown) =>
  ({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } })

/** Protocol-free adapter: unit tests exercise CAVE's surface; stdio tests exercise the SDK. */
const createServer = (
  store: Parameters<typeof createToolSurface>[0],
  options: Parameters<typeof createToolSurface>[1] = {}
) => {
  const surface = createToolSurface(store, options)
  let clientName: string | undefined
  return {
    handle: (message: unknown): Response => {
      const value = message as { id?: string | number, method?: string, params?: Record<string, unknown> }
      const id = value.id ?? null
      if (value.method === 'initialize') {
        const info = value.params?.['clientInfo'] as undefined | { name?: unknown }
        clientName = typeof info?.name === 'string' ? info.name : undefined
        return {
          jsonrpc: '2.0', id,
          result: { instructions: instructionsFor(scopedTools(options), { actions: allowsActions(options) }) }
        }
      }
      if (value.method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: surface.list() } }
      }
      if (value.method === 'tools/call') {
        const name = value.params?.['name']
        const args = value.params?.['arguments']
        try {
          return {
            jsonrpc: '2.0', id,
            result: surface.call(
              typeof name === 'string' ? name : String(name),
              typeof args === 'object' && args !== null ? args as Record<string, unknown> : {},
              clientName
            ) as unknown as Record<string, unknown>
          }
        } catch (error) {
          return {
            jsonrpc: '2.0', id,
            error: {
              code: (error as { code?: number }).code ?? -32603,
              message: error instanceof Error ? error.message : String(error)
            }
          }
        }
      }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
    }
  }
}

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

for (const corruption of ['identity', 'provenance'] as const) {
  test(`stdio query projection rejects ${corruption} corruption and recovers in the same session`, async () => {
    const store = open(), input = new PassThrough(), output = new PassThrough()
    const controller = new AbortController()
    const fallback = setTimeout(() => controller.abort(), 5000)
    const serving = serve(store, input, output, { signal: controller.signal })
    const send = async (id: number): Promise<Response> => {
      const reply = once(output, 'data', { signal: controller.signal })
      input.write(JSON.stringify(request(id, 'tools/call', {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
          'io.modelcontextprotocol/clientCapabilities': {}
        },
        name: 'cave_query', arguments: { pattern: '?x IS service' }
      })) + '\n')
      const [bytes] = await reply
      return JSON.parse(String(bytes)) as Response
    }
    const history = () => JSON.stringify(Object.fromEntries(
      ['cave_claim', 'cave_context', 'cave_tag', 'cave_provenance', 'cave_edge']
        .map(table => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
    ))
    try {
      store.ingest('api IS service @src:inventory #phase:ready\nzeta IS service @src:inventory')
      const row = store.currentBeliefs().find(row => row.subject === 'zeta')!
      const original = history()
      const valid = await send(1)
      assert.equal(valid.result?.['isError'], undefined)
      if (corruption === 'identity') {
        store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?')
          .run('018f0000-0000-7000-8000-000000000002', row.id)
      } else {
        store.db.prepare("INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, 'source', '')").run(row.id)
      }
      const damaged = history()
      const rejected = await send(2)
      assert.equal(rejected.id, 2)
      assert.equal(rejected.error, undefined)
      assert.equal(rejected.result?.['isError'], true)
      assert.deepEqual(rejected.result?.['content'], [{ type: 'text', text:
        `CAVE record: malformed cave.claim/v1 ${corruption === 'identity' ? 'transaction identity' : 'provenance'}`
      }])
      assert.equal(history(), damaged)
      if (corruption === 'identity') {
        store.db.prepare('UPDATE cave_claim SET tx = ? WHERE id = ?').run(row.tx, row.id)
      } else {
        store.db.prepare("DELETE FROM cave_provenance WHERE claim_id = ? AND value = ''").run(row.id)
      }
      assert.equal(history(), original)
      const recovered = await send(3)
      assert.equal(recovered.id, 3)
      assert.equal(recovered.result?.['isError'], undefined)
      assert.deepEqual(recovered.result, valid.result)
      assert.equal(history(), original)
      input.end()
      await serving
      assert.equal(controller.signal.aborted, false)
    } finally {
      clearTimeout(fallback)
      controller.abort()
      await serving.catch(() => {})
      input.destroy(); output.destroy(); store.close()
    }
  })
}

for (const mode of ['input-error', 'eof']) test(`stdio retains SDK-reported shutdown failure: ${mode}`, async t => {
  const store = open(), input = new PassThrough({ autoDestroy: false }), output = new PassThrough()
  const controller = new AbortController()
  const operation = new Error('input stream failed'), shutdown = new Error('SDK transport close failed')
  let closes = 0
  try {
    const close = StdioServerTransport.prototype.close
    t.mock.method(StdioServerTransport.prototype, 'close', async function (this: StdioServerTransport) {
      await close.call(this)
      closes++
      throw shutdown
    })
    const serving = serve(store, input, output, { signal: controller.signal })
    const rejected = assert.rejects(serving, error => {
      if (mode === 'eof') assert.equal(error, shutdown)
      else {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [operation, shutdown])
        assert.equal(error.cause, operation)
        assert.ok(error.message.includes(operation.message))
        assert.ok(error.message.includes(shutdown.message))
      }
      return true
    })
    if (mode === 'input-error') input.emit('error', operation)
    else input.end()
    await rejected
    assert.equal(closes, 1)
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    for (const event of ['finish', 'close', 'error']) assert.equal(output.listenerCount(event), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    assert.equal(input.destroyed, false)
    assert.equal(input.isPaused(), true)
    assert.equal(output.destroyed, false)
    store.ingest('caller IS usable')
    assert.match(store.exportText(), /caller IS usable/)
  } finally {
    t.mock.restoreAll()
    controller.abort()
    input.destroy()
    output.destroy()
    store.close()
  }
})

for (const side of ['input', 'output']) test(`stdio ${side} errors close transport listeners before rejecting`, async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  const failure = new Error(`${side} transport failed`)
  const controller = new AbortController()
  let fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 500)
  try {
    const serving = serve(store, input, output, { signal: controller.signal })
    const rejected = assert.rejects(serving, error => error === failure)
    ;(side === 'input' ? input : output).emit('error', failure)
    await rejected
    assert.equal(fallbackUsed, false)
    assert.equal(input.listenerCount('data'), 0)
    assert.equal(input.listenerCount('error'), 0)
    assert.equal(input.listenerCount('end'), 0)
    assert.equal(input.listenerCount('close'), 0)
    assert.equal(output.listenerCount('error'), 0)
    assert.equal(input.isPaused(), true)
    assert.equal(input.destroyed, false)
    store.ingest('local IS usable')
    assert.match(store.exportText(), /local IS usable/)
  } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
})

test('closing stdio output ends serving without waiting for input cancellation', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController()
  let fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 500)
  try {
    const serving = serve(store, input, output, { signal: controller.signal })
    output.destroy()
    await serving
    assert.equal(fallbackUsed, false)
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    for (const event of ['close', 'error']) assert.equal(output.listenerCount(event), 0)
    assert.equal(input.destroyed, false)
    assert.equal(input.isPaused(), true)
    store.ingest('local IS usable')
    assert.match(store.exportText(), /local IS usable/)
  } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
})

test('finishing stdio output without a close event ends serving', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough({ emitClose: false })
  const controller = new AbortController()
  let fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 500)
  try {
    const serving = serve(store, input, output, { signal: controller.signal })
    output.end()
    await serving
    assert.equal(fallbackUsed, false)
    assert.equal(output.writableFinished, true)
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    for (const event of ['finish', 'close', 'error']) assert.equal(output.listenerCount(event), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    store.ingest('local IS usable')
    assert.match(store.exportText(), /local IS usable/)
  } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
})

test('stdio serving captures its signal for subscription and cleanup', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), other = new AbortController()
  let reads = 0
  try {
    const serving = serve(store, input, output, {
      get signal() { return ++reads === 1 ? controller.signal : other.signal }
    })
    input.end()
    await serving
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    assert.equal(getEventListeners(other.signal, 'abort').length, 0)
    assert.equal(reads, 1)
  } finally { controller.abort(); other.abort(); input.destroy(); output.destroy(); store.close() }
})

test('pre-cancelled stdio serving does not subscribe to protocol input', async t => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  const subscribed = t.mock.method(input, 'on')
  try {
    await serve(store, input, output, { signal: AbortSignal.abort() })
    assert.equal(subscribed.mock.calls.filter(call => call.arguments[0] === 'data').length, 0)
    assert.equal(output.listenerCount('error'), 0)
  } finally { t.mock.restoreAll(); input.destroy(); output.destroy(); store.close() }
})

test('stdio serving finishes immediately for already-ended or closed streams', async () => {
  for (const mode of ['input-end', 'input-close', 'output-finish', 'output-close']) {
    const store = open()
    const input = new PassThrough(), output = new PassThrough()
    const controller = new AbortController()
    let fallback: ReturnType<typeof setTimeout> | undefined
    let fallbackUsed = false
    try {
      const stream = mode.startsWith('input') ? input : output
      const event = mode.endsWith('close') ? 'close' : mode === 'input-end' ? 'end' : 'finish'
      const ended = once(stream, event)
      if (event === 'close') stream.destroy()
      else { stream.resume(); stream.end() }
      await ended
      fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 500)
      await serve(store, input, output, { signal: controller.signal })
      assert.equal(fallbackUsed, false, mode)
      assert.equal(input.listenerCount('data'), 0)
      assert.equal(input.listenerCount('error'), 0)
      assert.equal(output.listenerCount('error'), 0)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
  }
})

test('SDK stdio serving drains buffered modern discovery requests before EOF shutdown', async () => {
  const store = open()
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''
  output.setEncoding('utf8').on('data', chunk => { text += chunk })
  input.end([1, 2].map(id => JSON.stringify({
    jsonrpc: '2.0', id, method: 'server/discover',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    }
  })).join('\n') + '\n')
  await serve(store, input, output)
  const responses = text.trim().split('\n').map(line => JSON.parse(line) as Response)
  assert.deepEqual(responses.map(response => response.id), [1, 2])
  for (const response of responses) {
    assert.deepEqual(response.result?.['supportedVersions'], ['2026-07-28'])
    const meta = response.result?.['_meta'] as Record<string, unknown>
    assert.equal((meta['io.modelcontextprotocol/serverInfo'] as { name: string }).name, 'cave')
  }
  store.close()
})

test('stdio rejects SDK buffer exhaustion without waiting for input EOF', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  output.resume()
  const controller = new AbortController()
  let fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 1000)
  try {
    store.ingest('retained IS record')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    input.write(Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))
    await assert.rejects(serve(store, input, output, { signal: controller.signal }), /maximum size/)
    assert.equal(fallbackUsed, false)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    assert.equal(output.listenerCount('error'), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    const retryInput = new PassThrough(), retryOutput = new PassThrough()
    let text = ''
    retryOutput.setEncoding('utf8').on('data', chunk => { text += chunk })
    try {
      retryInput.end(JSON.stringify(request(2, 'server/discover', { _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      } })) + '\n')
      await serve(store, retryInput, retryOutput)
      const response = JSON.parse(text) as Response
      assert.equal(response.id, 2)
      assert.deepEqual(response.result?.['supportedVersions'], ['2026-07-28'])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { retryInput.destroy(); retryOutput.destroy() }
  } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
})

test('buffer exhaustion after a completed write waits for server cleanup and retains its failure', async t => {
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController()
  const events = new EventEmitter()
  const shutdown = new Error('server cleanup failed')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let closes = 0, settled = false, fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 1000)
  const close = SdkServer.prototype.close
  t.mock.method(SdkServer.prototype, 'close', async function (this: SdkServer) {
    await close.call(this)
    closes++
    events.emit('cleanup')
    await gate
    throw shutdown
  })
  const serving = serve(store, input, output, { signal: controller.signal })
  void serving.then(() => { settled = true }, () => { settled = true })
  try {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify(request(1, 'tools/call', {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }, name: 'cave_add', arguments: { text: 'committed IS record' }
    })) + '\n')
    const [bytes] = await reply
    assert.equal((JSON.parse(String(bytes)) as Response).result?.['isError'], undefined)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'committed'))
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const started = once(events, 'cleanup', { signal: controller.signal })
    const rejected = assert.rejects(serving, error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors.length, 2)
      assert.match(error.errors[0].message, /maximum size/)
      assert.equal(error.errors[1], shutdown)
      assert.equal(error.cause, error.errors[0])
      assert.match(error.message, /maximum size/)
      assert.match(error.message, /server cleanup failed/)
      return true
    })
    input.write(Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))
    await started
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(settled, false)
    release()
    await rejected
    assert.equal(fallbackUsed, false)
    assert.equal(closes, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    assert.equal(output.listenerCount('error'), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  } finally {
    release(); clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    t.mock.restoreAll(); input.destroy(); output.destroy(); store.close()
  }
})

test('stdio rejects invalid UTF-8 before replacement characters can become claims', async () => {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
    'io.modelcontextprotocol/clientCapabilities': {}
  }
  const message = JSON.stringify(request(1, 'tools/call', {
    _meta: meta, name: 'cave_add', arguments: { text: 'bad IS record' }
  })) + '\n'
  const at = message.indexOf('bad') + 3
  for (const bytes of [[0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f]]) {
    const store = open()
    const input = new PassThrough(), output = new PassThrough()
    output.resume()
    try {
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      input.end(Buffer.concat([Buffer.from(message.slice(0, at)), Buffer.from(bytes), Buffer.from(message.slice(at))]))
      await assert.rejects(serve(store, input, output), /valid UTF-8/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
      store.ingest('local IS usable')
      assert.match(store.exportText(), /local IS usable/)
    } finally { input.destroy(); output.destroy(); store.close() }
  }
})

test('invalid UTF-8 after a completed request preserves its committed history', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController()
  let fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 1000)
  const serving = serve(store, input, output, { signal: controller.signal })
  try {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify(request(1, 'tools/call', {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      },
      name: 'cave_add', arguments: { text: 'committed IS record' }
    })) + '\n')
    const [bytes] = await reply
    const response = JSON.parse(String(bytes)) as Response
    assert.equal(response.id, 1)
    assert.equal(response.result?.['isError'], undefined)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'committed'))
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const rejected = assert.rejects(serving, /valid UTF-8/)
    input.end(Buffer.from([0x80]))
    await rejected
    assert.equal(fallbackUsed, false)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    assert.equal(output.listenerCount('error'), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  } finally {
    clearTimeout(fallback)
    controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
})

test('stdio validates incomplete UTF-8 at EOF and accepts split valid Unicode in a fresh session', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  output.resume()
  try {
    input.end(Buffer.from([0xf0, 0x9f]))
    await assert.rejects(serve(store, input, output), /valid UTF-8/)
    const validInput = new PassThrough(), validOutput = new PassThrough()
    let text = ''
    validOutput.setEncoding('utf8').on('data', chunk => { text += chunk })
    try {
      const message = Buffer.from(JSON.stringify(request(2, 'tools/call', {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
          'io.modelcontextprotocol/clientCapabilities': {}
        },
        name: 'cave_add', arguments: { text: 'café😀� IS record' }
      })) + '\n')
      for (const byte of message) validInput.write(Buffer.from([byte]))
      validInput.end()
      await serve(store, validInput, validOutput)
      const response = JSON.parse(text) as Response
      assert.equal(response.id, 2)
      assert.equal(response.result?.['isError'], undefined)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'café😀�'))
    } finally { validInput.destroy(); validOutput.destroy() }
  } finally { input.destroy(); output.destroy(); store.close() }
})

test('stdio drains valid requests between malformed frames before EOF', async () => {
  const store = open()
  const input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController()
  let text = ''
  let fallbackUsed = false
  const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 1000)
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
    'io.modelcontextprotocol/clientCapabilities': {}
  }
  const invalid = ['{', 'null', '[]', '{"jsonrpc":"2.0","id":true,"method":"server/discover"}']
  try {
    output.setEncoding('utf8').on('data', chunk => { text += chunk })
    input.end(invalid.flatMap((line, id) => [line,
      JSON.stringify(request(id, 'server/discover', { _meta: meta }))
    ]).join('\n') + '\n')
    await serve(store, input, output, { signal: controller.signal })
    assert.equal(fallbackUsed, false)
    const responses = text.trim().split('\n').map(line => JSON.parse(line) as Response)
    assert.deepEqual(responses.map(response => response.id), [0, 1, 2, 3])
    for (const response of responses) {
      assert.deepEqual(response.result?.['supportedVersions'], ['2026-07-28'])
    }
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
    assert.equal(output.listenerCount('error'), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    store.ingest('local IS usable')
    assert.match(store.exportText(), /local IS usable/)
  } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
})

for (const mode of ['unsupported-revision', 'invalid-envelope', 'unknown-method']) {
  test(`stdio EOF drains ${mode} errors and subsequent valid requests`, async () => {
    const store = open()
    const input = new PassThrough(), output = new PassThrough()
    const controller = new AbortController()
    let text = ''
    let fallbackUsed = false
    const fallback = setTimeout(() => { fallbackUsed = true; controller.abort() }, 1000)
    const meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
      'io.modelcontextprotocol/clientCapabilities': {}
    }
    const invalidMeta = mode === 'unsupported-revision'
      ? { ...meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' }
      : mode === 'invalid-envelope'
        ? { ...meta, 'io.modelcontextprotocol/clientInfo': false }
        : meta
    try {
      output.setEncoding('utf8').on('data', chunk => { text += chunk })
      input.end([
        request('invalid', mode === 'unknown-method' ? 'cave/missing-method' : 'server/discover', { _meta: invalidMeta }),
        request('valid', 'server/discover', { _meta: meta })
      ].map(message => JSON.stringify(message)).join('\n') + '\n')
      await serve(store, input, output, { signal: controller.signal })
      assert.equal(fallbackUsed, false)
      const responses = text.trim().split('\n').map(line => JSON.parse(line) as Response)
      assert.equal(responses.length, 2)
      assert.equal(typeof responses.find(response => response.id === 'invalid')?.error?.code, 'number')
      assert.deepEqual(responses.find(response => response.id === 'valid')?.result?.['supportedVersions'], ['2026-07-28'])
      for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0)
      assert.equal(output.listenerCount('error'), 0)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
      store.ingest('local IS usable')
      assert.match(store.exportText(), /local IS usable/)
    } finally { clearTimeout(fallback); input.destroy(); output.destroy(); store.close() }
  })
}

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
    ['cave_help', 'cave_add', 'cave_query', 'cave_fuse', 'cave_search', 'cave_about', 'cave_neighbors',
      'cave_reconstruct', 'cave_derive', 'cave_export', 'cave_lint']
  )
  for (const tool of listed) {
    assert.equal(tool.inputSchema.type, 'object', tool.name)
    assert.ok(tool.description.length > 20, tool.name)
    // Read tools advertise it (MCP tool annotations); the writing tools
    // stay at the protocol defaults.
    const writes = tool.name === 'cave_add' || tool.name === 'cave_derive'
    assert.deepEqual(tool.annotations, writes ? undefined : { readOnlyHint: true }, tool.name)
  }
  assert.equal(listed.length, tools.length)
  store.close()
})

test('read-only scope drops cave_add and cave_derive from list, call and instructions', () => {
  const store = open()
  store.ingest('auth USES jwt')
  const server = createServer(store, { readOnly: true })
  const listed = (server.handle(request(40, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.equal(listed.length, tools.length - 2)
  assert.ok(!listed.some(tool => tool.name === 'cave_add' || tool.name === 'cave_derive'))
  assert.ok(listed.some(tool => tool.name === 'cave_fuse'), 'fusion never writes — it survives read-only')
  const denied = server.handle(request(41, 'tools/call', { name: 'cave_add', arguments: { text: 'a USES b' } })) as Response
  assert.equal(denied.error?.code, -32602, 'hidden tools are indistinguishable from nonexistent')
  const deniedDerive = server.handle(request(44, 'tools/call', { name: 'cave_derive', arguments: {} })) as Response
  assert.equal(deniedDerive.error?.code, -32602)
  assert.equal(store.currentBeliefs().length, 1, 'nothing was appended')
  const queried = call(server, 42, 'cave_query', { pattern: '?x USES jwt' })
  assert.match(contentText(queried), /\?x = auth/, 'read tools still work')
  const initialized = server.handle(request(43, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })) as Response
  const served = initialized.result?.['instructions'] as string
  assert.doesNotMatch(served, /cave_add/)
  assert.match(served, /read-only/)
  store.close()
})

test('permission scopes separate reads, ephemeral evaluation and durable recording', () => {
  assert.deepEqual(scopedTools({ permissions: ['read'] }).map(tool => tool.name), [
    'cave_help', 'cave_query', 'cave_search', 'cave_about', 'cave_neighbors', 'cave_export'
  ])
  assert.deepEqual(scopedTools({ permissions: ['evaluate'] }).map(tool => tool.name), [
    'cave_fuse', 'cave_reconstruct', 'cave_lint'
  ])
  assert.deepEqual(scopedTools({ permissions: ['record'] }).map(tool => tool.name), [
    'cave_add', 'cave_derive'
  ])
  assert.throws(
    () => scopedTools({ permissions: ['unknown' as 'read'] }),
    /unknown permission\(s\): unknown/
  )
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
  assert.equal(instructionsFor(tools, { actions: true }), instructions)
  assert.match(instructions, /cave_reconstruct/)
  assert.match(instructions, /cave_fuse/, 'the full surface advertises named computation')
  assert.match(instructions, /cave_derive/)
  assert.match(instructions, /cave_help/)
  assert.match(instructions, /act_<name>/, 'the default surface serves action tools (spec §25.5)')
  const queryOnly = instructionsFor(scopedTools({ tools: ['cave_query'] }))
  assert.match(queryOnly, /cave_query patterns/)
  assert.doesNotMatch(queryOnly, /cave_add|cave_about|cave_reconstruct|cave_fuse|cave_derive/)
  assert.match(queryOnly, /read-only/)
  const fuseOnly = instructionsFor(scopedTools({ tools: ['cave_fuse'] }))
  assert.match(fuseOnly, /cave_fuse \(Bayesian fusion\)/)
  assert.match(fuseOnly, /read-only/, 'fusion alone is a read surface')
  const lintOnly = instructionsFor(scopedTools({ tools: ['cave_lint', 'cave_export'] }))
  assert.match(lintOnly, /Validate CAVE text with cave_lint\./)
  assert.doesNotMatch(lintOnly, /cave_add/)
  const searchOnly = instructionsFor(scopedTools({ tools: ['cave_search'] }))
  assert.match(searchOnly, /read-only/, 'no guidance clause still gets the read-only note')
  // The full surface keeps the add guidance and stays silent on read-only.
  assert.match(instructions, /stamped with your agent source/)
  assert.doesNotMatch(instructions, /read-only/)
})

test('cave_help supplies version-matched guidance without reading or writing the store', () => {
  const store = open()
  store.ingest('private/thing HAS token: "do-not-return"')
  const server = createServer(store, { tools: ['cave_help'] })
  const overview = contentText(call(server, 54, 'cave_help', {}))
  assert.match(overview, /durable, local agent memory/)
  assert.match(overview, /write, find, revise, safety/)
  assert.doesNotMatch(overview, /do-not-return/)
  const revise = contentText(call(server, 55, 'cave_help', { topic: 'revise' }))
  assert.match(revise, /append-only/)
  assert.match(revise, /@ 0%/)
  assert.equal(store.currentBeliefs().length, 1)
  const invalid = call(server, 56, 'cave_help', { topic: 'unknown' })
  assert.equal(invalid.result?.['isError'], true)
  assert.match(contentText(invalid), /topic must be one of/)
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

test('cave_query renders prototype-named variable bindings in tool results', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    const result = call(createServer(store), 1, 'cave_query', { pattern: '?__proto__ IS service' })
    assert.equal(result.error, undefined)
    assert.equal(contentText(result), '?__proto__ = api  ; api IS service')
  } finally { store.close() }
})

test('cave_query returns bounded continuations over a frozen snapshot', () => {
  const store = open()
  store.ingest('service/0 USES jwt\nservice/1 USES jwt\nservice/2 USES jwt')
  const server = createServer(store)
  const first = contentText(call(server, 8, 'cave_query', { pattern: '?x USES jwt', limit: 2 }))
  assert.match(first, /\?x = service\/0/)
  assert.match(first, /\?x = service\/1/)
  const cursor = /next cursor: (.+)$/.exec(first)?.[1]
  assert.ok(cursor)

  store.ingest('service/later USES jwt')
  const second = contentText(call(server, 9, 'cave_query', {
    pattern: '?x USES jwt', limit: 2, cursor
  }))
  assert.match(second, /\?x = service\/2/)
  assert.doesNotMatch(second, /service\/later|next cursor:/)
  store.close()
})

test('cave_query reports stale snapshot cursors as tool errors', () => {
  const store = open()
  try {
    const rows = store.ingest('service/0 USES jwt\nservice/1 USES jwt')
    const server = createServer(store)
    const first = contentText(call(server, 8, 'cave_query', { pattern: '?x USES jwt', limit: 1 }))
    const cursor = /next cursor: (.+)$/.exec(first)?.[1]
    assert.ok(cursor)
    store.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)')
      .run(rows.ids[0]!, 'BECAUSE', rows.ids[1]!)
    const stale = call(server, 9, 'cave_query', { pattern: '?x USES jwt', limit: 1, cursor })
    assert.equal(stale.result?.['isError'], true)
    assert.match(contentText(stale), /snapshot changed.*restart/i)
  } finally { store.close() }
})

test('cave_query asOf resolves beliefs at a past tx (spec §12.3)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60%')
  const boundary = store.claimsAbout('server')[0]!.tx
  store.ingest('server IS compromised @ 0% ; clean scan')
  const server = createServer(store)
  assert.equal(contentText(call(server, 50, 'cave_query', { pattern: 'server IS compromised' })), 'no matches')
  const then = contentText(call(server, 51, 'cave_query', { pattern: 'server IS compromised', asOf: boundary }))
  assert.match(then, /server IS compromised @ 60%/)
  store.close()
})

test('cave_fuse fuses the spec §10.1 worked example — pattern, about and text agree', () => {
  const store = open()
  store.ingest('openai HAS revenue: 18B USD/yr +/- 3B USD/yr @ 60% @src:analyst\n' +
    'openai HAS revenue: 20B USD/yr +/- 0.5B USD/yr @ 95% @src:filing\n' +
    'openai HAS ceo: sam-altman')
  const server = createServer(store)
  const fused = contentText(call(server, 70, 'cave_fuse', { pattern: 'openai HAS revenue: ?v' }))
  assert.match(fused, /fused 2 estimate\(s\)/)
  assert.match(fused, /18B USD\/yr \+\/- 3B USD\/yr/, 'contributing estimates are listed')
  assert.match(fused, /posterior: 19\.97B USD\/yr \+\/- 508\.5M USD\/yr \(2σ\)/, 'the filing dominates (spec §10.1)')
  assert.match(fused, /mean 19965517241\.\d+, sigma 254273813\.\d+/, 'exact numbers ride along')

  // The metric form of the same example — `revenue IS 20B USD/yr …` — is
  // invisible to CAVE-Q variables (metric values never bind), so the
  // about selector reaches it by subject.
  const metrics = open()
  metrics.ingest('revenue IS 18B USD/yr +/- 3B USD/yr @ 60% @src:analyst\n' +
    'revenue IS 20B USD/yr +/- 0.5B USD/yr @ 95% @src:filing')
  const aboutFused = contentText(call(createServer(metrics), 71, 'cave_fuse', { about: 'revenue' }))
  assert.match(aboutFused, /posterior: 19\.97B USD\/yr/)

  // Literal text supplies its own estimates: same math, no matching rows needed.
  const empty = open()
  const textFused = contentText(call(createServer(empty), 72, 'cave_fuse', {
    text: 'revenue IS 18B USD/yr +/- 3B USD/yr @ 60%\nrevenue IS 20B USD/yr +/- 0.5B USD/yr @ 95%'
  }))
  assert.match(textFused, /posterior: 19\.97B USD\/yr/)
  assert.equal(empty.currentBeliefs().length, 0)
  metrics.close()
  empty.close()
  store.close()
})

test('cave_fuse guards: one selector, one quantity, one unit', () => {
  const store = open()
  store.ingest('openai HAS revenue: 20B USD/yr +/- 0.5B USD/yr @ 95%\n' +
    'openai HAS employees: 3000 +/- 500 @ 80%')
  const server = createServer(store)
  const both = call(server, 75, 'cave_fuse', { pattern: '?x HAS revenue: ?v', text: 'a IS 1 +/- 1' })
  assert.equal(both.result?.['isError'], true)
  assert.match(contentText(both), /exactly one of pattern/)
  const neither = call(server, 76, 'cave_fuse', {})
  assert.equal(neither.result?.['isError'], true)
  const spans = call(server, 77, 'cave_fuse', { about: 'openai' })
  assert.equal(spans.result?.['isError'], true)
  assert.match(contentText(spans), /cannot fuse across 2 quantities/)
  assert.match(contentText(spans), /HAS employees: 3000/, 'each quantity shows one example claim')
  const converted = call(server, 78, 'cave_fuse', { text: 'x IS 1000 ms +/- 200 ms\nx IS 1 s +/- 0.2 s' })
  assert.match(contentText(converted), /posterior: 1K ms/)
  const mixed = call(server, 80, 'cave_fuse', { text: 'x IS 10 ms +/- 2 ms\nx IS 1 USD\/yr +/- 0.1 USD\/yr' })
  assert.equal(mixed.result?.['isError'], true)
  assert.match(contentText(mixed), /cannot fuse mixed units: ms, USD\/yr/)
  const enormousSpread = call(server, 801, 'cave_fuse', { text: `x IS 1 +/- ${'1' + '0'.repeat(200)}` })
  assert.equal(enormousSpread.result?.['isError'], true)
  assert.match(contentText(enormousSpread), /posterior precision is outside the finite numeric range/)
  const anchored = call(server, 79, 'cave_fuse', { about: 'openai', asOf: '2026-01-01' })
  assert.equal(anchored.result?.['isError'], true)
  assert.match(contentText(anchored), /asOf composes with pattern only/)
  store.close()
})

test('cave_fuse skips denials, retractions and non-estimates; aliases widen the quantity (spec §13.6)', () => {
  const store = open()
  store.ingest('m IS 10 ms +/- 2 ms @src:a\nm IS 20 ms +/- 2 ms @src:b\nm IS NOT 99 ms +/- 1 ms @src:c')
  store.ingest('m IS 10 ms +/- 2 ms @src:a @ 0% ; retracted')
  const server = createServer(store)
  const fused = contentText(call(server, 80, 'cave_fuse', { about: 'm' }))
  assert.match(fused, /fused 1 estimate\(s\)/, 'the denial and the retracted series contribute nothing')
  assert.match(fused, /posterior: 20 ms \+\/- 2 ms \(2σ\)/, 'full-confidence single estimate round-trips')

  const none = contentText(call(server, 81, 'cave_fuse', { pattern: '?x IS ?y' }))
  assert.equal(none, 'nothing to fuse: no matching claims')
  const bare = call(server, 82, 'cave_fuse', { text: 'service HAS owner: alice' })
  assert.match(contentText(bare), /nothing to fuse: none of the 1 claim\(s\)/)

  const aliased = open()
  aliased.ingest('rev ALIAS revenue\nrev IS 18B USD/yr +/- 3B USD/yr @ 60%\nrevenue IS 20B USD/yr +/- 0.5B USD/yr @ 95%')
  const aliasServer = createServer(aliased)
  const split = call(aliasServer, 83, 'cave_fuse', { about: 'revenue', aliases: true })
  assert.notEqual(split.result?.['isError'], true, 'the closure joins the two series into one quantity')
  assert.match(contentText(split), /fused 2 estimate\(s\)/)
  assert.match(contentText(split), /posterior: 19\.97B USD\/yr/)
  const strict = call(aliasServer, 84, 'cave_fuse', { about: 'revenue' })
  assert.match(contentText(strict), /fused 1 estimate\(s\)/, 'without aliases only the named series contributes')
  aliased.close()
  store.close()
})

test('cave_fuse posteriors stay CAVE-parseable decimals, never exponent notation (exponent-notation bug)', () => {
  const store = open()
  const server = createServer(store)
  // Tiny magnitudes: String(2e-7) is '2e-7', which the CAVE number
  // grammar (spec §16) does not accept — the write-back value must be
  // plain decimal.
  const tiny = contentText(call(server, 85, 'cave_fuse', {
    text: 'sensor HAS drift: 0.0000001 +/- 0.00000004\nsensor HAS drift: 0.0000003 +/- 0.00000004'
  }))
  assert.match(tiny, /posterior: 0\.0000002 \+\/- 0\.00000002828 \(2σ\)/)
  assert.doesNotMatch(tiny, /\de[+-]\d/, 'no exponent notation anywhere in the output')
  // Huge magnitudes: beyond T-compression the residual still has to be
  // plain digits (2e+22T is not a CAVE value; 20000000000000000000000T is).
  const huge = contentText(call(server, 86, 'cave_fuse', {
    text: 'star HAS mass: 20000000000000000000000000000000000 kg +/- 4000000000000000000000000000000000 kg'
  }))
  assert.match(huge, /posterior: 20000000000000000000000T kg \+\/- 4000000000000000000000T kg \(2σ\)/)
  assert.doesNotMatch(huge, /\de[+-]\d/, 'no exponent notation anywhere in the output')
  store.close()
})

test('cave_about, cave_neighbors and cave_search read the graph', () => {
  const store = open()
  store.ingest('monorepo CONTAINS packages/api\nauth USES jwt ; json web tokens')
  const server = createServer(store)
  assert.match(contentText(call(server, 8, 'cave_about', { entity: 'packages/api' })), /monorepo CONTAINS packages\/api/)
  const neighbors = contentText(call(server, 9, 'cave_neighbors', { entity: 'packages/api' }))
  assert.equal(neighbors, 'packages/api PART-OF monorepo')
  const search = contentText(call(server, 10, 'cave_search', { query: 'json web tokens' }))
  assert.equal(search, 'auth USES jwt ; json web tokens', 'search lines carry their comments')
  assert.equal(contentText(call(server, 11, 'cave_search', { query: 'packages' })), 'monorepo CONTAINS packages/api', 'entity segments are searchable')
  store.ingest('search-a USES sharedterm\nsearch-b USES sharedterm')
  assert.equal(
    contentText(call(server, 12, 'cave_search', { query: 'sharedterm', limit: 1 })),
    'search-b USES sharedterm\nmore matches beyond 1; raise limit',
    'limit caps newest-first and announces the remainder')
  for (const limit of [0, 1001, 2.5]) {
    const outOfRange = call(server, 13, 'cave_search', { query: 'sharedterm', limit })
    assert.equal(outOfRange.result?.['isError'], true, `limit ${limit} is rejected without schema validation`)
    assert.match(contentText(outOfRange), /limit must be an integer/)
  }
  store.close()
})

test('cave_about hides retracted series — an @ 0% current row is not believed (spec §9.3)', () => {
  const store = open()
  store.ingest('auth USES jwt @ 90%\nauth USES oauth\nauth USES NOT ldap @ 80%\nlegacy CONTAINS auth')
  store.ingest('auth USES jwt @ 0% ; key rotation retired jwt\nlegacy CONTAINS auth @ 0%')
  const server = createServer(store)
  const about = contentText(call(server, 34, 'cave_about', { entity: 'auth' }))
  assert.match(about, /auth USES oauth/)
  assert.match(about, /auth USES NOT ldap @ 80%/, 'a supported denial is a current belief')
  assert.doesNotMatch(about, /jwt/, 'the retracted subject-side series is gone')
  assert.doesNotMatch(about, /legacy/, 'the retracted object-side series is gone')

  // An entity whose only series is retracted has nothing believed about it.
  store.ingest('ghost IS haunted\nghost IS haunted @ 0%')
  assert.equal(contentText(call(server, 35, 'cave_about', { entity: 'ghost' })), 'no claims')

  // The alias closure widens names, never the belief filter (spec §13.6).
  store.ingest('auth ALIAS authn\nauthn USES saml\nauthn USES saml @ 0%')
  const aliased = contentText(call(server, 36, 'cave_about', { entity: 'auth', aliases: true }))
  assert.doesNotMatch(aliased, /saml/, 'a retracted aliased series is gone too')
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

test('cave_query, cave_about and cave_neighbors resolve contested facts on request (spec §26.4)', () => {
  const store = open()
  store.ingest('service HAS owner: alice\nauth USES jwt @ 60%', { source: 'ingest/93a0' })
  store.ingest('service HAS owner: bob\nauth USES NOT jwt @ 90%', { source: 'cli' })
  const server = createServer(store)
  const plain = contentText(call(server, 60, 'cave_query', { pattern: 'service HAS owner: ?who' }))
  assert.match(plain, /\?who = alice/)
  assert.match(plain, /\?who = bob/)
  const resolved = contentText(call(server, 61, 'cave_query', { pattern: 'service HAS owner: ?who', resolve: true }))
  assert.equal(resolved, '?who = bob  ; service HAS owner: bob', 'the human-tier series wins')
  const conflict = call(server, 62, 'cave_query', { pattern: '?x IS ?y', resolve: true, all: true })
  assert.equal(conflict.result?.['isError'], true)
  const about = contentText(call(server, 63, 'cave_about', { entity: 'service', resolve: true }))
  assert.match(about, /owner: bob/)
  assert.doesNotMatch(about, /alice/, 'the overridden series is invisible')
  const neighbors = contentText(call(server, 64, 'cave_neighbors', { entity: 'auth', resolve: true }))
  assert.equal(neighbors, 'no edges', 'the denial wins its group — the positive edge is gone')
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

test('cave_derive fires rules declared through cave_add, incrementally (spec §24)', () => {
  const store = open()
  const server = createServer(store)
  assert.match(contentText(call(server, 90, 'cave_derive', {})), /^no rules declared/)

  call(server, 91, 'cave_add', {
    text: 'a NEEDS b\nb NEEDS c\nrule/needs HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z` ; transitive needs'
  })
  const preview = contentText(call(server, 92, 'cave_derive', { dryRun: true }))
  assert.match(preview, /rule\/needs: 1 solution\(s\), \+1 appended/)
  assert.match(preview, /transitive needs/, 'the rule label rides along')
  assert.match(preview, /derived \(dry run\): \+1 appended/)
  assert.equal(contentText(call(server, 93, 'cave_query', { pattern: 'a NEEDS c' })), 'no matches',
    'a dry run persists nothing')

  const fired = contentText(call(server, 94, 'cave_derive', {}))
  assert.match(fired, /derived: \+1 appended, 0 updated, 0 retracted, 1 unchanged/)
  assert.match(contentText(call(server, 95, 'cave_query', { pattern: 'a NEEDS c' })), /a NEEDS c/)
  const derived = store.currentBeliefs().find(row => row.subject === 'a' && row.object === 'c')
  assert.ok(derived !== undefined)
  assert.match(store.toClaim(derived).contexts[0] ?? '', /^src:rule\/[0-9a-f]+$/,
    'derived rows carry rule provenance (spec §24.3)')

  const again = contentText(call(server, 96, 'cave_derive', {}))
  assert.match(again, /rule\/needs: unchanged premises, skipped/, 'watermark incrementality (spec §24.4)')
  const refire = contentText(call(server, 97, 'cave_derive', { full: true }))
  assert.match(refire, /1 unchanged/, 'a full re-fire is idempotent')

  const badConf = call(server, 98, 'cave_derive', { minConf: 2 })
  assert.equal(badConf.result?.['isError'], true)
  assert.match(contentText(badConf), /minConf must be a number in 0\.\.1/)
  const badPasses = call(server, 99, 'cave_derive', { maxPasses: 0 })
  assert.equal(badPasses.result?.['isError'], true)
  const beforeInvalid = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  for (const maxPasses of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = call(server, 100, 'cave_derive', { maxPasses })
    assert.equal(invalid.result?.['isError'], true)
    assert.match(contentText(invalid), /positive safe integer/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeInvalid)
  }
  store.close()
})

test('cave_derive reports incomplete reconciliation and recovers on the same session', () => {
  const store = open()
  try {
    const server = createServer(store)
    call(server, 1, 'cave_add', { text: 'a IS ready\nrule/enable HAS rule: `?x IS ready => ?x IS enabled`' })
    assert.match(contentText(call(server, 2, 'cave_derive', {})), /derived: \+1 appended/)
    call(server, 3, 'cave_add', { text: 'a IS ready @ 0%' })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const dryRun of [false, true]) {
      const response = call(server, 4, 'cave_derive', { maxPasses: 1, dryRun })
      assert.notEqual(response.result?.['isError'], true, 'exhaustion returns the retained-work report')
      const text = contentText(response)
      assert.match(text, /note: stopped at 1 passes.*re-run to continue/)
      const summary = text.split('\n').at(-1)!
      assert.match(summary, /^derived \(incomplete\)/)
      assert.equal(summary.includes('(dry run)'), dryRun)
      assert.match(summary, /0 retracted/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.match(contentText(call(server, 5, 'cave_query', { pattern: 'a IS enabled' })), /a IS enabled/)
    }
    const retry = contentText(call(server, 6, 'cave_derive', { maxPasses: 3 }))
    assert.match(retry, /derived: .*1 retracted/)
    assert.doesNotMatch(retry, /incomplete/)
    assert.equal(contentText(call(server, 7, 'cave_query', { pattern: 'a IS enabled' })), 'no matches')
    const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.match(contentText(call(server, 8, 'cave_derive', {})), /unchanged premises, skipped/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
  } finally { store.close() }
})

test('cave_lint and cave_export', () => {
  const store = open()
  store.ingest('x HAS state: a @ 40%')
  store.ingest('x HAS state: b @ 90%')
  store.ingest('secret IS retained #sensitivity:confidential')
  const server = createServer(store)
  assert.match(contentText(call(server, 12, 'cave_lint', { text: 'a USES b' })), /^ok: 1/)
  assert.match(contentText(call(server, 13, 'cave_lint', { text: 'a uses b' })), /line 1/)
  const current = contentText(call(server, 14, 'cave_export', { current: true }))
  assert.match(current, /state: b/)
  assert.doesNotMatch(current, /state: a/)
  assert.doesNotMatch(current, /secret/)
  assert.match(contentText(call(server, 15, 'cave_export', { maxSensitivity: 'confidential' })), /secret/)
  const invalid = call(server, 16, 'cave_export', { maxSensitivity: 'secret' })
  assert.equal(invalid.result?.['isError'], true)
  assert.match(contentText(invalid), /public, internal, confidential, restricted/)
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

const deployAction =
  'action/mark-deployed HAS action: `?service, ?version, ?service IS service => ' +
  '?service HAS deployed-version: ?version` ; record a deployment\n' +
  'action/mark-deployed/service IS param ; the service that was deployed\n' +
  'action/mark-deployed/version IS param ; the version now running\n'

test('actions are served as generated act_<name> tools (spec §25.5)', () => {
  const store = open()
  store.ingest(`api IS service\n${deployAction}`)
  const server = createServer(store)
  const listed = (server.handle(request(60, 'tools/list')) as Response).result?.['tools'] as {
    name: string, description: string,
    inputSchema: { required: string[], properties: Record<string, { type: string, description?: string }> }
  }[]
  const tool = listed.find(candidate => candidate.name === 'act_mark-deployed')
  assert.ok(tool, 'the declared action is served')
  assert.match(tool.description, /record a deployment/)
  assert.match(tool.description, /Governed write/)
  assert.deepEqual(tool.inputSchema.required, ['service', 'version'])
  assert.equal(tool.inputSchema.properties['service']!.description, 'the service that was deployed')

  const executed = call(server, 61, 'act_mark-deployed', { service: 'api', version: '1.2.3' })
  assert.notEqual(executed.result?.['isError'], true)
  assert.match(contentText(executed), /\+1 appended/)
  assert.match(contentText(call(server, 62, 'cave_about', { entity: 'api' })), /deployed-version: 1\.2\.3/)

  // A failed precondition is a tool error, not a write.
  const failed = call(server, 63, 'act_mark-deployed', { service: 'ghost', version: '1' })
  assert.equal(failed.result?.['isError'], true)
  assert.match(contentText(failed), /precondition failed/)
  store.close()
})

test('generated action tools retain hook setup errors after committed effects', () => {
  const store = open()
  try {
    store.ingest(`api IS service\n${deployAction}\naction/mark-deployed HAS hook: notify`)
    let mode: 'throw' | 'invalid' | 'ok' = 'throw', lookups = 0
    const surface = createToolSurface(store, { hooks: { get notify(): string {
      lookups++
      if (mode === 'throw') throw new Error('private configuration detail')
      return mode === 'invalid' ? 42 as unknown as string : 'echo recovered'
    } } })
    for (const [version, failureMode, expected] of [
      ['1', 'throw', 'hook configuration lookup failed'],
      ['2', 'invalid', 'hook command must be a string']
    ] as const) {
      mode = failureMode
      const reply = surface.call('act_mark-deployed', { service: 'api', version })
      assert.equal(reply.isError, true)
      const text = reply.content.map(item => item.text).join('\n')
      assert.match(text, version === '1' ? /\+1 appended/ : /1 updated/)
      assert.ok(text.includes(`hook notify: ${expected}`), text)
      assert.doesNotMatch(text, /undefined|private configuration detail/)
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const beforeLookups = lookups
      const repeated = surface.call('act_mark-deployed', { service: 'api', version })
      assert.notEqual(repeated.isError, true)
      assert.match(repeated.content.map(item => item.text).join('\n'), /nothing changed/)
      assert.equal(lookups, beforeLookups)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    }
    mode = 'ok'
    const recovered = surface.call('act_mark-deployed', { service: 'api', version: '3' })
    assert.notEqual(recovered.isError, true)
    assert.match(recovered.content.map(item => item.text).join('\n'), /hook notify: ok/)
  } finally { store.close() }
})

test('an action declared mid-session appears without reconnecting (spec §25.5)', () => {
  const store = open()
  const server = createServer(store)
  const before = (server.handle(request(65, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.ok(!before.some(tool => tool.name.startsWith('act_')))
  call(server, 66, 'cave_add', { text: 'action/open-window HAS action: `=> maintenance-window EXISTS`' })
  const after = (server.handle(request(67, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.ok(after.some(tool => tool.name === 'act_open-window'))
  assert.match(contentText(call(server, 68, 'act_open-window', {})), /\+1 appended/)
  store.close()
})

test('scope composition covers action tools (spec §25.5)', () => {
  const store = open()
  store.ingest(`api IS service\n${deployAction}`)

  // --read-only drops every action tool: they write.
  const readOnly = createServer(store, { readOnly: true })
  const roTools = (readOnly.handle(request(70, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.ok(!roTools.some(tool => tool.name.startsWith('act_')))
  const denied = readOnly.handle(request(71, 'tools/call', { name: 'act_mark-deployed', arguments: {} })) as Response
  assert.equal(denied.error?.code, -32602)

  // --tools may name action tools; unnamed ones are hidden.
  const scoped = createServer(store, { tools: ['cave_query', 'act_mark-deployed'] })
  const scopedList = (scoped.handle(request(72, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.deepEqual(scopedList.map(tool => tool.name), ['cave_query', 'act_mark-deployed'])

  // An act_-only scope is valid — validated at call time, not startup.
  const actOnly = createServer(store, { tools: ['act_mark-deployed'] })
  const actOnlyList = (actOnly.handle(request(73, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.deepEqual(actOnlyList.map(tool => tool.name), ['act_mark-deployed'])
  assert.match(contentText(call(actOnly, 74, 'act_mark-deployed', { service: 'api', version: '2' })), /\+1 appended/)

  // Permission classes do not grant recording when only action execution is allowed.
  const permittedAction = createServer(store, { permissions: ['action'] })
  const permittedList = (permittedAction.handle(request(75, 'tools/list')) as Response).result?.['tools'] as { name: string }[]
  assert.deepEqual(permittedList.map(tool => tool.name), ['act_mark-deployed'])
  const addDenied = permittedAction.handle(request(76, 'tools/call', {
    name: 'cave_add', arguments: { text: 'unexpected EXISTS' }
  })) as Response
  assert.equal(addDenied.error?.code, -32602)
  store.close()
})
