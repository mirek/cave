/**
 * MCP server over stdio — newline-delimited JSON-RPC 2.0.
 *
 * Implements the slice of the Model Context Protocol a tools-only server
 * needs: `initialize` / `notifications/initialized`, `ping`, `tools/list`
 * and `tools/call`. The dispatcher is a pure function from message to
 * optional response, so it is testable without a process or a socket;
 * `serve` wires it to stdin/stdout.
 *
 * Hand-rolled rather than pulling in an SDK: the protocol surface here is
 * ~150 lines, the repo is otherwise dependency-free beyond
 * `@prelude/parser`, and `@prelude/jsonrpc` targets WebSocket-style
 * transports with numeric-only ids (MCP ids may be strings).
 */

import { createInterface } from 'node:readline'
import type { Store } from '@cavelang/store'
import { byName, tools } from './tools.ts'

/** Protocol revision answered when the client's is not a string. */
export const protocolVersion = '2025-06-18'

export const serverInfo = {
  name: 'cave',
  version: '0.1.0'
} as const

/**
 * The spec §22 compact card — tool-agnostic CAVE writing knowledge,
 * shared with `@cavelang/ingest` prompts.
 */
export const specCard = `CAVE (Compressed Atomic Verb Expressions) persists knowledge as atomic claims:

  subject VERB [NOT] object                [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
  subject HAS attribute: value [+/- delta] [@context...] [#tag[:value]...] [@ N%] [!] [; comment]

Examples:
  auth/middleware USES jwt @ 90%
  OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @2026-Q1
  server IS NOT compromised @ 90%
  memory-leak CAUSE app/crash @ 70% #topic:stability

Verbs are UPPERCASE (IS, HAS, CAUSE, FIX, NEEDS, USES, YIELDS, ENABLES, BLOCKS,
CONTAINS, PRECEDES, EXTENDS, ALIAS, LIKE, EXISTS, VS, BECOMES, EXCEEDS).
Entities are kebab-case with / for scope (auth/middleware). @ctx = context
(no space), @ 90% = confidence (space). Storage is append-only: update belief
by adding the same claim with new confidence; retract with @ 0%.`

/**
 * Server instructions — the card plus tool guidance, so a connected model
 * knows how to write CAVE without reading the full specification.
 */
export const instructions = `${specCard}

Extract knowledge with one claim per line via cave_add (validate with
cave_lint first), ask questions with cave_query patterns (?x USES jwt),
explore with cave_about / cave_neighbors, and use cave_reconstruct to pull
everything related to a symptom or task before reasoning about it.`

type Id = string | number

type Message = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

type Response = {
  jsonrpc: '2.0'
  id: null | Id
  result?: unknown
  error?: { code: number, message: string }
}

const result = (id: Id, value: unknown): Response =>
  ({ jsonrpc: '2.0', id, result: value })

const failure = (id: null | Id, code: number, message: string): Response =>
  ({ jsonrpc: '2.0', id, error: { code, message } })

const isId = (value: unknown): value is Id =>
  typeof value === 'string' || typeof value === 'number'

/**
 * @returns pure MCP dispatcher over an open store: message in, response
 * out (`undefined` for notifications).
 */
export const createServer = (store: Store) => {
  const handle = (message: unknown): undefined | Response => {
    if (typeof message !== 'object' || message === null) {
      return failure(null, -32600, 'Invalid request')
    }
    const { id, method, params } = message as Message
    if (typeof method !== 'string') {
      return isId(id) ? failure(id, -32600, 'Invalid request: missing method') : undefined
    }
    if (!isId(id)) {
      // Notifications (notifications/initialized, notifications/cancelled, …)
      // require no response.
      return undefined
    }
    switch (method) {
      case 'initialize': {
        const requested = (params as undefined | { protocolVersion?: unknown })?.protocolVersion
        return result(id, {
          protocolVersion: typeof requested === 'string' ? requested : protocolVersion,
          capabilities: { tools: {} },
          serverInfo,
          instructions
        })
      }
      case 'ping':
        return result(id, {})
      case 'tools/list':
        return result(id, {
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        })
      case 'tools/call': {
        const call = (params ?? {}) as { name?: unknown, arguments?: unknown }
        const tool = typeof call.name === 'string' ? byName.get(call.name) : undefined
        if (tool === undefined) {
          return failure(id, -32602, `Unknown tool: ${String(call.name)}`)
        }
        const args = typeof call.arguments === 'object' && call.arguments !== null ?
          call.arguments as Record<string, unknown> :
          {}
        try {
          const text = tool.run(store, args)
          return result(id, { content: [{ type: 'text', text }] })
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          return result(id, { content: [{ type: 'text', text }], isError: true })
        }
      }
      default:
        return failure(id, -32601, `Method not found: ${method}`)
    }
  }
  return { handle }
}

/**
 * Serves MCP over newline-delimited JSON-RPC on the given streams until
 * the input closes. Protocol traffic only on `output` — logs belong on
 * stderr.
 */
export const serve = (
  store: Store,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream
): Promise<void> => {
  const server = createServer(store)
  return new Promise(resolve => {
    const lines = createInterface({ input })
    lines.on('line', line => {
      if (line.trim() === '') {
        return
      }
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        output.write(`${JSON.stringify(failure(null, -32700, 'Parse error'))}\n`)
        return
      }
      const response = server.handle(message)
      if (response !== undefined) {
        output.write(`${JSON.stringify(response)}\n`)
      }
    })
    lines.on('close', resolve)
  })
}
