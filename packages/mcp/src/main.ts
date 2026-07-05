/**
 * `cave mcp` entry — opens the knowledge database and serves MCP on stdio
 * until the client disconnects. Everything written to stdout is protocol;
 * the startup banner goes to stderr.
 */

import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { defaultDbPath, open } from '@cavelang/store'
import { serve, serverInfo } from './server.ts'

export const usage = `cave mcp — serve a CAVE knowledge database as an MCP server on stdio

Usage:
  cave mcp [--db <path>] [--no-prelude]

Options:
  --db <path>    database file (default: $CAVE_DB, or cave.db)
  --no-prelude   open the store without the standard verb registry

Runs until the client disconnects; stdout is protocol, diagnostics go
to stderr.

Examples:
  cave mcp --db k.db
  claude mcp add cave -- cave mcp --db k.db`

/** Runs the server; resolves with the process exit code. */
export const runMcp = async (argv: readonly string[]): Promise<number> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      'no-prelude': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  })
  if (values.help === true) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  const db = values.db ?? defaultDbPath()
  const store = open(db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  process.stderr.write(`${serverInfo.name} mcp server ${serverInfo.version} — db ${db}\n`)
  try {
    await serve(store, process.stdin, process.stdout)
  } finally {
    store.close()
  }
  return 0
}
