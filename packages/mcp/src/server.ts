/**
 * CAVE's tool surface on the official MCP TypeScript SDK v2.
 *
 * `createToolSurface` keeps domain behavior transport-free and testable;
 * `createServer` binds it to the SDK's low-level Server; `serve` delegates
 * stdio framing, lifecycle, protocol-era detection, and legacy fallback to
 * `serveStdio`.
 */

import { Transform, type Readable, type Writable } from 'node:stream'
import { errorMessage } from './error-message.ts'
import { sourceValue } from './source.ts'
import {
  CLIENT_INFO_META_KEY, LATEST_PROTOCOL_VERSION, ProtocolError,
  ProtocolErrorCode, Server, SUPPORTED_PROTOCOL_VERSIONS, type ServerContext
} from '@modelcontextprotocol/server'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { Version } from '@cavelang/core'
import type { Store } from '@cavelang/store'
import { actToolPrefix, allowsActions, scopedActionTools, scopedTools, tools, type Scope, type Tool } from './tools.ts'

export type ServerOptions = Scope & {
  /**
   * Actor provenance stamp for appends (spec §9.5), without the `src:`
   * prefix. Default: `agent/<client-name>` from the initialize handshake or
   * modern request envelope, plain `agent` without one. `false` disables
   * stamping.
   */
  readonly source?: string | false
  /** Out-of-band hook command templates for action tools (spec §25.4). */
  readonly hooks?: Readonly<Record<string, string>>
  /** Stop accepting protocol input and resolve after the current message. */
  readonly signal?: AbortSignal
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

/** Legacy initialize-era revisions supported by the official MCP SDK. */
export const protocolVersions = [...SUPPORTED_PROTOCOL_VERSIONS]

/** The preferred MCP protocol revision offered during version negotiation. */
export const protocolVersion = LATEST_PROTOCOL_VERSION

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
CONTAINS, PRECEDES, EXTENDS, ALIAS, LIKE, EXISTS, VS, BECOMES, EXCEEDS,
IS-BELOW, IS-AT-LEAST, IS-AT-MOST, EQUALS, DIFFERS-FROM).
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
    ...has('cave_help') ? ['consult cave_help for version-matched usage guidance when needed'] : [],
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
    ...(served.some(tool => tool.permission === 'record' || tool.permission === 'action') || options.actions === true ?
      [] : ['This server is read-only: no tool writes to the knowledge database.'])
  ].join('\n')
  return guidance === '' ? specCard : `${specCard}\n\n${guidance}`
}

/**
 * Server instructions for the full default surface — every static tool
 * plus generated action tools (spec §25.5) — so a connected model knows
 * how to write CAVE without reading the full specification.
 */
export const instructions = instructionsFor(tools, { actions: true })

export type ListedTool = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Tool['inputSchema']
  readonly annotations?: { readonly readOnlyHint: true }
}

export type ToolCallResult = {
  content: [{ type: 'text', text: string }]
  readonly isError?: true
}

/** Capture only connection scope; source and hook configuration retain their own lifecycle. */
const captureScope = (options: Scope): Scope => {
  const readOnly = options.readOnly, permissions = options.permissions, tools = options.tools
  return {
    ...readOnly === undefined ? {} : { readOnly },
    ...permissions === undefined ? {} : { permissions: Array.isArray(permissions) ? Array.from(permissions) : permissions },
    ...tools === undefined ? {} : { tools: Array.isArray(tools) ? Array.from(tools) : tools }
  }
}

/**
 * Pure CAVE tool surface beneath the MCP SDK. Action declarations are read on
 * every list/call, so actions added mid-session appear without reconnecting.
 */
export const createToolSurface = (store: Store, options: ServerOptions = {}) =>
  toolSurface(store, options, captureScope(options))

const toolSurface = (store: Store, options: ServerOptions, scope: Scope) => {
  const served = scopedTools(scope)
  const servedByName = new Map(served.map(tool => [tool.name, tool]))
  const actionsPossible = allowsActions(scope)
  const actServed = (): Tool[] =>
    actionsPossible ? scopedActionTools(store, scope) : []
  const list = (): ListedTool[] => [...served, ...actServed()].map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.permission === 'record' || tool.permission === 'action' ?
      {} : { annotations: { readOnlyHint: true as const } })
  }))
  const call = (
    name: string,
    args: Record<string, unknown>,
    clientName?: string
  ): ToolCallResult => {
    const tool = servedByName.get(name) ??
      (name.startsWith(actToolPrefix) ? actServed().find(candidate => candidate.name === name) : undefined)
    if (tool === undefined) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`)
    }
    try {
      const source = options.source
      const stamp = source === false ? undefined : sourceValue(source, 'source') ?? agentSource(clientName)
      const hooks = options.hooks
      const text = tool.run(store, args, {
        ...stamp === undefined ? {} : { source: stamp },
        ...hooks === undefined ? {} : { hooks }
      })
      return { content: [{ type: 'text', text }] }
    } catch (error) {
      const text = errorMessage(error)
      return { content: [{ type: 'text', text }], isError: true }
    }
  }
  return { list, call }
}

/**
 * Builds an official SDK server over CAVE's scoped, dynamic tool surface.
 * Protocol negotiation, validation, lifecycle, ping, and error envelopes are
 * owned by `@modelcontextprotocol/server`.
 */
export const createServer = (store: Store, options: ServerOptions = {}): Server => {
  const scope = captureScope(options)
  const served = scopedTools(scope)
  const actionsPossible = allowsActions(scope)
  const surface = toolSurface(store, options, scope)
  const server = new Server(serverInfo, {
    capabilities: { tools: {} },
    instructions: instructionsFor(served, { actions: actionsPossible })
  })
  const clientName = (context: ServerContext): string | undefined => {
    const envelope = context.mcpReq.envelope as undefined | Record<string, unknown>
    const modern = envelope?.[CLIENT_INFO_META_KEY] as undefined | { name?: unknown }
    return typeof modern?.name === 'string' ? modern.name : server.getClientVersion()?.name
  }
  server.setRequestHandler('tools/list', async () => ({ tools: surface.list() }))
  server.setRequestHandler('tools/call', async (request, context) =>
    server.projectCallToolResult(surface.call(
      request.params.name,
      request.params.arguments ?? {},
      clientName(context)
    ), undefined))
  return server
}

/** Serves both the 2026 MCP era and legacy initialize-era clients on stdio. */
export const serve = (
  store: Store,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  options: ServerOptions = {}
): Promise<void> => {
  const signal = options.signal
  if (signal?.aborted === true) return Promise.resolve()
  const readable = input as Readable
  const writable = output as Writable
  if (readable.readableEnded || readable.closed || writable.writableFinished || writable.closed) return Promise.resolve()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const validated = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        decoder.decode(chunk, { stream: true })
        callback(null, chunk)
      } catch (cause) { callback(new TypeError('MCP input must contain valid UTF-8', { cause })) }
    },
    flush(callback) {
      try { decoder.decode(); callback() }
      catch (cause) { callback(new TypeError('MCP input must contain valid UTF-8', { cause })) }
    }
  })
  const transport = new StdioServerTransport(validated, writable)
  let shuttingDown = false
  const shutdownErrors: unknown[] = []
  const handle = serveStdio(() => createServer(store, options), {
    transport,
    // The SDK reports cleanup errors here while its close promise resolves.
    // Ordinary protocol diagnostics retain the SDK's existing wire behavior.
    onerror: error => { if (shuttingDown) shutdownErrors.push(error) }
  })
  return new Promise((resolve, reject) => {
    let finished = false
    let inputEnded = false
    let pendingReplies = 0
    const requests = new Map<unknown, number>()
    let closing: Promise<void> | undefined
    const closeHandle = (): Promise<void> => closing ??= (async () => {
      shuttingDown = true
      try { await handle.close() } catch (error) {
        if (!shutdownErrors.includes(error)) shutdownErrors.push(error)
      }
      if (shutdownErrors.length === 1) throw shutdownErrors[0]
      if (shutdownErrors.length > 1) {
        throw new AggregateError(shutdownErrors,
          `MCP shutdown failed: ${shutdownErrors.map(errorMessage).join('; ')}`,
          { cause: shutdownErrors[0] })
      }
    })()
    const cleanup = (): void => {
      validated.removeListener('end', endInput)
      validated.removeListener('error', fail)
      input.removeListener('close', closeInput)
      input.removeListener('error', fail)
      output.removeListener('error', fail)
      output.removeListener('close', close)
      output.removeListener('finish', close)
      signal?.removeEventListener('abort', close)
      readable.unpipe(validated)
      // A transform error may already be queued when another event closes us.
      validated.on('error', () => {})
      validated.destroy()
      if (input.listenerCount('data') === 0) readable.pause()
    }
    const done = (): void => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }
    const fail = (error: Error): void => {
      if (finished) return
      finished = true
      cleanup()
      void closeHandle().then(() => reject(error), closeError => {
        if (closeError === error) { reject(error); return }
        // The SDK may also report the triggering stream error during close.
        const errors = [error, ...shutdownErrors.filter(value => value !== error)]
        if (errors.length === 1) reject(error)
        else reject(new AggregateError(errors,
          `MCP stream/shutdown failed: ${errors.map(errorMessage).join('; ')}`,
          { cause: error }))
      })
    }
    const close = (): void => {
      void closeHandle().then(done, fail)
    }
    const endInput = (): void => {
      inputEnded = true
      if (pendingReplies === 0) close()
    }
    const closeInput = (): void => {
      // Normal EOF must pass through the decoder's final validation first.
      if (!readable.readableEnded) close()
    }
    // SDK close tears down immediately. Normal EOF must first finish replies
    // to requests already accepted, including a pre-buffered opening exchange.
    let transportFailure: Error | undefined
    const reportTransportError = transport.onerror
    transport.onerror = error => {
      transportFailure = error
      reportTransportError?.(error)
    }
    const transportClosed = transport.onclose
    transport.onclose = () => {
      const unexpected = !shuttingDown
      const failure = transportFailure
      if (unexpected) {
        // handle.close() yields before closing the server. The passive SDK
        // callback would mark it closed first and detach cleanup from our wait.
        if (failure !== undefined) fail(failure)
        else close()
        return
      }
      transportClosed?.()
    }
    const receive = transport.onmessage!
    transport.onmessage = message => {
      transportFailure = undefined
      if ('method' in message && 'id' in message) {
        pendingReplies++
        requests.set(message.id, (requests.get(message.id) ?? 0) + 1)
      }
      receive(message)
    }
    const send = transport.send.bind(transport)
    transport.send = async message => {
      try { await send(message) }
      finally {
        if (!('method' in message) && 'id' in message) {
          const count = requests.get(message.id) ?? 0
          if (count > 0) {
            pendingReplies--
            if (count === 1) requests.delete(message.id)
            else requests.set(message.id, count - 1)
          }
        }
        if (inputEnded && pendingReplies === 0) close()
      }
    }
    validated.once('end', endInput)
    validated.once('error', fail)
    input.once('close', closeInput)
    input.once('error', fail)
    output.once('error', fail)
    output.once('close', close)
    output.once('finish', close)
    signal?.addEventListener('abort', close, { once: true })
    if (signal?.aborted === true) close()
    else readable.pipe(validated)
  })
}
