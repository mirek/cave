/**
 * `cave serve` entry (spec §30.3) — argument parsing, then the server
 * until interrupted. Long-running, so `main.ts` in the CLI routes it
 * like `mcp` and `automate`.
 */

import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { defaultDbPath, open } from '@cavelang/store'
import { defaultHost, defaultPort, serve } from './server.ts'

const usage = `cave serve — browse a CAVE store in the browser (spec §30)

Usage:
  cave serve [--db <path>] [--port <n>] [--host <address>]

Options:
  --db <path>    database file (default: $CAVE_DB, or cave.db)
  --port <n>     port to bind (default ${defaultPort} — "cave" on a phone
                 keypad; 0 picks a free port)
  --host <a>     interface to bind (default ${defaultHost} — localhost
                 only; binding wider shares the whole store, read-only)
  --no-prelude   open the store without the standard verb registry

One static, self-contained page over the store — no build step, no
external resources, works offline: entity 360 pages, topic browse, the
belief-history timeline of any claim key, BECAUSE/VIA lineage trees,
and the spec §20 coverage/frontier dashboard, with full-text search
over everything. Every request reads the live store, so a running
loop's appends show on the next refresh.

The surface is strictly read-only: only GET is answered and no
endpoint writes — recording knowledge stays with cave add, the MCP
tools and the kinetic layer (spec §24, §25, §29).

Examples:
  cave serve --db k.db
  cave serve --db k.db --port 8080
  CAVE_DB=k.db cave serve`

export const runServe = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-prelude': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  })
  if (values.help === true) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  if (positionals.length > 0) {
    process.stderr.write(`cave serve: unexpected argument ${JSON.stringify(positionals[0])}\n`)
    return 1
  }
  const port = values.port === undefined ? defaultPort : Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`cave serve: --port expects 0..65535, got '${values.port}'\n`)
    return 1
  }
  const dbPath = values.db ?? defaultDbPath()
  const store = open(dbPath, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    const handle = await serve(store, {
      port,
      label: dbPath,
      ...values.host === undefined ? {} : { host: values.host }
    })
    process.stdout.write(`serving ${dbPath} at ${handle.url} (read-only, ctrl-c to stop)\n`)
    return await new Promise<number>(() => {})
  } catch (error) {
    store.close()
    process.stderr.write(`cave serve: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
