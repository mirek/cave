#!/usr/bin/env node
/** `cave` binary entry point — see `cli.ts` for the command implementations. */

import { cave, highlightCommand } from './cli.ts'

const write = (code: number, out: string, err: string): void => {
  if (out !== '') {
    process.stdout.write(out)
  }
  if (err !== '') {
    process.stderr.write(err)
  }
  process.exitCode = code
}

// mcp, ingest and connect own their help text, so `cave help X` becomes `cave X --help`.
const raw = process.argv.slice(2)
const argv = raw[0] === 'help' && (raw[1] === 'mcp' || raw[1] === 'ingest' || raw[1] === 'connect') ?
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
} else if (argv[0] === 'connect') {
  // Async (URL sources fetch) and potentially long-running (--watch).
  const { runConnect } = await import('@cavelang/connect')
  process.exitCode = await runConnect(argv.slice(1))
} else if (argv[0] === 'highlight' && !argv.includes('--help') && !argv.includes('-h')) {
  // Async (grammar WASM loads on first use); --help stays on the sync path.
  const { code, out, err } = await highlightCommand(argv.slice(1))
  write(code, out, err)
} else {
  const { code, out, err } = cave(argv)
  // Canonical CAVE text going to a terminal gets syntax colors from the same
  // grammar query `cave highlight` uses; piping or NO_COLOR keeps bytes clean.
  const colorize = code === 0 && argv[0] === 'export' && !argv.includes('--out') &&
    out !== '' && process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined
  if (colorize) {
    const { highlighter } = await import('@cavelang/highlight')
    write(code, (await highlighter()).ansi(out), err)
  } else {
    write(code, out, err)
  }
}
