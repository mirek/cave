/**
 * `cave mcp` entry — opens the knowledge database and serves MCP on stdio
 * until the client disconnects. Everything written to stdout is protocol;
 * the startup banner goes to stderr.
 */

import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { open } from '@cavelang/store'
import { serve, serverInfo } from './server.ts'

/** Runs the server; resolves with the process exit code. */
export const runMcp = async (argv: readonly string[]): Promise<number> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: false
  })
  if (values.db === undefined) {
    process.stderr.write('cave mcp: --db <path> is required\n')
    return 1
  }
  const store = open(values.db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  process.stderr.write(`${serverInfo.name} mcp server ${serverInfo.version} — db ${values.db}\n`)
  try {
    await serve(store, process.stdin, process.stdout)
  } finally {
    store.close()
  }
  return 0
}
