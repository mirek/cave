/**
 * `cave mcp` entry — opens the knowledge database and serves MCP on stdio
 * until the client disconnects. Everything written to stdout is protocol;
 * the startup banner goes to stderr.
 */

import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { defaultDbPath, open } from '@cavelang/store'
import { serve, serverInfo } from './server.ts'
import { scopedTools } from './tools.ts'

export const usage = `cave mcp — serve a CAVE knowledge database as an MCP server on stdio

Usage:
  cave mcp [--db <path>] [--no-prelude] [--read-only] [--tools <list>]
           [--src <context>] [--no-src]

Options:
  --db <path>      database file (default: $CAVE_DB, or cave.db)
  --no-prelude     open the store without the standard verb registry
  --read-only      serve only tools that never write (drops cave_add)
  --tools <list>   serve only these tools (comma-separated); --read-only
                   still drops writing tools from the list
  --src <context>  provenance stamp for appends, without the src: prefix
                   (default: agent/<client-name> from the MCP handshake)
  --no-src         do not stamp actor provenance on appends

Appended claims that carry no @src: context are stamped with the
connected client's source context (spec §9.5). Tools outside the served
scope are absent from tools/list and unknown to tools/call. Runs until
the client disconnects; stdout is protocol, diagnostics go to stderr.

Examples:
  cave mcp --db k.db
  cave mcp --db k.db --read-only
  cave mcp --db k.db --tools cave_query,cave_about,cave_search
  cave mcp --db k.db --src pipeline/nightly
  claude mcp add cave -- cave mcp --db k.db`

/** Runs the server; resolves with the process exit code. */
export const runMcp = async (argv: readonly string[]): Promise<number> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      'no-prelude': { type: 'boolean' },
      'read-only': { type: 'boolean' },
      tools: { type: 'string' },
      src: { type: 'string' },
      'no-src': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  })
  if (values.help === true) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  if (values.src !== undefined && !/^[A-Za-z0-9._/:-]+$/.test(values.src)) {
    process.stderr.write('cave mcp: --src must be a context token (letters, digits, . _ / : -)\n')
    return 2
  }
  const scope = {
    ...values['read-only'] === true ? { readOnly: true } : {},
    ...values.tools === undefined ? {} : {
      tools: values.tools.split(',').map(name => name.trim()).filter(name => name !== '')
    }
  }
  try {
    // Validate the scope before touching the database or the protocol —
    // a misconfigured permission boundary must not come up at all.
    scopedTools(scope)
  } catch (error) {
    process.stderr.write(`cave mcp: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const db = values.db ?? defaultDbPath()
  const store = open(db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  const scopeNote = [
    ...values['read-only'] === true ? ['read-only'] : [],
    ...scope.tools === undefined ? [] : [`tools ${scopedTools(scope).map(tool => tool.name).join(',')}`]
  ]
  process.stderr.write(`${serverInfo.name} mcp server ${serverInfo.version} — db ${db}` +
    `${scopeNote.length > 0 ? ` (${scopeNote.join('; ')})` : ''}\n`)
  try {
    await serve(store, process.stdin, process.stdout, {
      ...scope,
      ...values['no-src'] === true ? { source: false } : values.src === undefined ? {} : { source: values.src }
    })
  } finally {
    store.close()
  }
  return 0
}
