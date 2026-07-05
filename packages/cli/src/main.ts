#!/usr/bin/env node
/** `cave` binary entry point — see `cli.ts` for the command implementations. */

import { cave } from './cli.ts'

// mcp and ingest own their help text, so `cave help X` becomes `cave X --help`.
const raw = process.argv.slice(2)
const argv = raw[0] === 'help' && (raw[1] === 'mcp' || raw[1] === 'ingest') ?
  [raw[1], '--help'] :
  raw
if (argv[0] === 'mcp') {
  // Long-running: serves MCP on stdio until the client disconnects.
  const { runMcp } = await import('@cavelang/mcp')
  process.exitCode = await runMcp(argv.slice(1))
} else if (argv[0] === 'ingest') {
  // Long-running: drives an LLM agent over batches of files.
  const { runIngest } = await import('@cavelang/ingest')
  process.exitCode = await runIngest(argv.slice(1))
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
