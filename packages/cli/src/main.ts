#!/usr/bin/env node
/** `cave` binary entry point — see `cli.ts` for the command implementations. */

import { cave } from './cli.ts'

const argv = process.argv.slice(2)
if (argv[0] === 'mcp') {
  // Long-running: serves MCP on stdio until the client disconnects.
  const { runMcp } = await import('@cave/mcp')
  process.exitCode = await runMcp(argv.slice(1))
} else {
  const { code, out, err } = cave(argv)
  if (out !== '') {
    process.stdout.write(out)
  }
  if (err !== '') {
    process.stderr.write(err)
  }
  process.exitCode = code
}
