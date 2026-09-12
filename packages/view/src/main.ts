/**
 * `cave serve` entry (spec §30.3) — argument parsing, then the server
 * until the shared CLI abort signal requests an awaited shutdown.
 */

import { parseArgs } from 'node:util'
import type { Server } from 'node:http'
import { Registry } from '@cavelang/canonical'
import { Sensitivity, defaultDbPath, openAt } from '@cavelang/store'
import { assemble } from '@cavelang/connect'
import { defaultHost, defaultPort, serve } from './server.ts'
import { errorMessage } from './error-message.ts'

const usage = `cave serve — browse a CAVE store in the browser (spec §30)

Usage:
  cave serve [--db <path>] [--port <n>] [--host <address>]
             [--max-sensitivity <level>]

Options:
  --db <path>    store: a SQLite file, or CAVE text served from memory (default: $CAVE_DB, or cave.db)
  --port <n>     port to bind (default ${defaultPort} — "cave" on a phone
                 keypad; 0 picks a free port)
  --host <a>     interface to bind (default ${defaultHost} — localhost
                 only)
  --max-sensitivity <level>
                 public, internal, confidential, or restricted (default
                 internal; malformed/unknown claim labels fail closed)
  --no-prelude   open the store without the standard verb registry

One static, self-contained page over the store — no build step, no
external resources, works offline: entity 360 pages, topic browse, the
belief-history timeline of any claim key, BECAUSE/VIA lineage trees,
and the spec §20 coverage/frontier dashboard, with full-text search
within the selected sensitivity ceiling. Every request reads the live store, so a running
loop's appends show on the next refresh.

The surface is strictly read-only: only GET/HEAD are answered and no
endpoint writes — recording knowledge stays with cave add, the MCP
tools and the kinetic layer (spec §24, §25, §29).

Examples:
  cave serve --db k.db
  cave serve --db k.db --port 8080
  CAVE_DB=k.db cave serve`

export type RunContext = {
  readonly stdout?: NodeJS.WritableStream
  readonly stderr?: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

const waitForStop = (server: Server, signal: AbortSignal | undefined, errors: unknown[]) => {
  let wake!: () => void
  const wait = new Promise<void>(resolve => { wake = resolve })
  const failed = (error: unknown): void => { errors.push(error); wake() }
  server.on('error', failed)
  signal?.addEventListener('abort', wake, { once: true })
  if (signal?.aborted) wake()
  return { wait, close: (): void => {
    server.removeListener('error', failed)
    signal?.removeEventListener('abort', wake)
  } }
}

export const runServe = async (argv: readonly string[], context: RunContext = {}): Promise<number> => {
  const signal = context.signal
  if (signal?.aborted === true) return 0
  const stdout = context.stdout ?? process.stdout
  const stderr = context.stderr ?? process.stderr
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'max-sensitivity': { type: 'string' },
      'no-prelude': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  })
  if (values.help === true) {
    stdout.write(`${usage}\n`)
    return 0
  }
  if (positionals.length > 0) {
    stderr.write(`cave serve: unexpected argument ${JSON.stringify(positionals[0])}\n`)
    return 1
  }
  if (values.host !== undefined && values.host.trim() === '') {
    stderr.write('cave serve: --host expects a non-empty hostname or address\n')
    return 1
  }
  const port = values.port === undefined ? defaultPort : Number(values.port)
  if (values.port?.trim() === '' || !Number.isInteger(port) || port < 0 || port > 65535) {
    stderr.write(`cave serve: --port expects 0..65535, got '${values.port}'\n`)
    return 1
  }
  const maximum = Sensitivity.parse(values['max-sensitivity'] ?? Sensitivity.defaultMaximum)
  if (maximum === undefined) {
    stderr.write(`cave serve: --max-sensitivity expects ${Sensitivity.levels.join(', ')}, got ${JSON.stringify(values['max-sensitivity'])}\n`)
    return 1
  }
  const dbPath = values.db ?? defaultDbPath()
  const store = openAt(dbPath, { intent: 'read', assemble, ...values['no-prelude'] === true ? { registry: Registry.empty } : {} })
  let handle: Awaited<ReturnType<typeof serve>> | undefined
  const errors: unknown[] = []
  let stop: ReturnType<typeof waitForStop> | undefined
  try {
    handle = await serve(store, {
      port,
      label: dbPath,
      maxSensitivity: maximum,
      ...values.host === undefined ? {} : { host: values.host }
    })
    stop = waitForStop(handle.server, signal, errors)
    stdout.write(`serving ${dbPath} at ${handle.url} (sensitivity <= ${maximum}, read-only, ctrl-c to stop)\n`)
    await stop.wait
  } catch (error) { errors.push(error) }
  if (handle?.server.listening === true) {
    let closing: Promise<void> | undefined
    try {
      closing = handle.close()
      // Observe immediately, then retain its error in cleanup order below.
      void closing.catch(() => {})
    } catch (error) { errors.push(error) }
    try { handle.server.closeAllConnections() } catch (error) { errors.push(error) }
    try { await closing } catch (error) { errors.push(error) }
  }
  try { store.close() } catch (error) { errors.push(error) }
  stop?.close()
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors,
      `viewer failed: ${errors.map(errorMessage).join('; ')}`,
      { cause: errors[0] })
  }
  return 0
}
