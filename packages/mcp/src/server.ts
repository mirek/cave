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
import { Version } from '@cavelang/core'
import type { Store } from '@cavelang/store'
import { actToolPrefix, scopedActionTools, scopedTools, tools, type Scope, type Tool } from './tools.ts'

export type ServerOptions = Scope & {
  /**
   * Actor provenance stamp for appends (spec §9.5), without the `src:`
   * prefix. Default: `agent/<client-name>` from the initialize handshake,
   * plain `agent` before or without one. `false` disables stamping.
   */
  readonly source?: string | false
  /** Out-of-band hook command templates for action tools (spec §25.4). */
  readonly hooks?: Readonly<Record<string, string>>
}

/**
 * @returns `agent/<name>` source context from an MCP client name —
 * lowercased, whitespace to `-`, restricted to context-safe characters;
 * plain `agent` when no usable name is known (spec §9.5).
 */
export const agentSource = (clientName: undefined | string): string => {
  const name = (clientName ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._/-]/g, '')
  return name === '' ? 'agent' : `agent/${name}`
}

/** Protocol revision answered when the client's is not a string. */
export const protocolVersion = '2025-06-18'

export const serverInfo = {
  name: 'cave',
  version: Version.current()
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
 * Server instructions for a served tool surface — the card plus tool
 * guidance mentioning only tools actually served, so a connected model is
 * never pointed at a tool the scope hides. A surface with no writing tool
 * says so outright. `actions` marks a scope that (also) serves generated
 * action tools (spec §25.5) — a write surface even when no static tool
 * writes.
 */
export const instructionsFor = (served: readonly Tool[], options: { actions?: boolean } = {}): string => {
  const has = (name: string): boolean => served.some(tool => tool.name === name)
  const explore = ['cave_about', 'cave_neighbors'].filter(has)
  const clauses = [
    ...has('cave_add') ?
      [`extract knowledge with one claim per line via cave_add${has('cave_lint') ? ' (validate with cave_lint first)' : ''}`] :
      has('cave_lint') ? ['validate CAVE text with cave_lint'] : [],
    ...has('cave_query') ? ['ask questions with cave_query patterns (?x USES jwt)'] : [],
    ...has('cave_fuse') ? ['delegate combining numeric estimates to cave_fuse (Bayesian fusion) instead of averaging in tokens'] : [],
    ...explore.length > 0 ? [`explore with ${explore.join(' / ')}`] : [],
    ...has('cave_reconstruct') ? ['use cave_reconstruct to pull everything related to a symptom or task before reasoning about it'] : [],
    ...has('cave_derive') ? ['fire the stored rules with cave_derive so derived knowledge materializes with lineage'] : []
  ]
  const last = clauses.length - 1
  const guidance = [
    ...clauses.length === 0 ? [] : [clauses
      .map((clause, index) => index === 0 ? `${clause[0]!.toUpperCase()}${clause.slice(1)}` : index === last ? `and ${clause}` : clause)
      .join(',\n') + '.'],
    ...has('cave_add') ? [
      'Claims you add without a @src: context are stamped with your agent source\n' +
      'context; to update or retract a claim that carries a different @src:,\n' +
      'restate it with that exact context.'
    ] : [],
    ...options.actions === true ? [
      'Actions declared in the knowledge database are served as act_<name>\n' +
      'tools (spec §25) — a governed write vocabulary: parameters validated,\n' +
      'preconditions checked against current belief, effects appended\n' +
      `atomically with provenance. Prefer them over ${has('cave_add') ? 'cave_add' : 'freeform appends'} when one fits.`
    ] : [],
    ...served.some(tool => tool.writes) || options.actions === true ? [] :
      ['This server is read-only: no tool writes to the knowledge database.']
  ].join('\n')
  return guidance === '' ? specCard : `${specCard}\n\n${guidance}`
}

/**
 * Server instructions for the full default surface — every static tool
 * plus generated action tools (spec §25.5) — so a connected model knows
 * how to write CAVE without reading the full specification.
 */
export const instructions = instructionsFor(tools, { actions: true })

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
 * out (`undefined` for notifications). The client name captured from
 * `initialize` becomes the default `agent/<name>` provenance stamp on
 * appends (spec §9.5). Serves the scoped tool surface — tools outside the
 * scope are absent from `tools/list` and unknown to `tools/call`; throws
 * when the scope names an unknown tool or serves none.
 */
export const createServer = (store: Store, options: ServerOptions = {}) => {
  const served = scopedTools(options)
  const servedByName = new Map(served.map(tool => [tool.name, tool]))
  // Action tools are generated from the store's current declarations per
  // request (spec §25.5) — an action declared mid-session appears in the
  // next tools/list without reconnecting.
  const actionsPossible = options.readOnly !== true &&
    (options.tools === undefined || options.tools.some(name => name.startsWith(actToolPrefix)))
  const actServed = (): Tool[] =>
    actionsPossible ? scopedActionTools(store, options) : []
  const servedInstructions = instructionsFor(served, { actions: actionsPossible })
  let clientName: undefined | string
  const source = (): undefined | string =>
    options.source === false ? undefined : options.source ?? agentSource(clientName)
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
        const name = (params as undefined | { clientInfo?: { name?: unknown } })?.clientInfo?.name
        if (typeof name === 'string') {
          clientName = name
        }
        return result(id, {
          protocolVersion: typeof requested === 'string' ? requested : protocolVersion,
          capabilities: { tools: {} },
          serverInfo,
          instructions: servedInstructions
        })
      }
      case 'ping':
        return result(id, {})
      case 'tools/list':
        return result(id, {
          tools: [...served, ...actServed()].map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...tool.writes ? {} : { annotations: { readOnlyHint: true } }
          }))
        })
      case 'tools/call': {
        const call = (params ?? {}) as { name?: unknown, arguments?: unknown }
        const tool = typeof call.name === 'string' ?
          servedByName.get(call.name) ??
            (call.name.startsWith(actToolPrefix) ? actServed().find(candidate => candidate.name === call.name) : undefined) :
          undefined
        if (tool === undefined) {
          return failure(id, -32602, `Unknown tool: ${String(call.name)}`)
        }
        const args = typeof call.arguments === 'object' && call.arguments !== null ?
          call.arguments as Record<string, unknown> :
          {}
        try {
          const stamp = source()
          const text = tool.run(store, args, {
            ...stamp === undefined ? {} : { source: stamp },
            ...options.hooks === undefined ? {} : { hooks: options.hooks }
          })
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
  output: NodeJS.WritableStream,
  options: ServerOptions = {}
): Promise<void> => {
  const server = createServer(store, options)
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
