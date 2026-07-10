#!/usr/bin/env node
/** `cave` binary entry point — see `cli.ts` for the command implementations. */

import { cave, highlightCommand, reconstructCommand, suggestAliasCommand } from './cli.ts'

const write = (code: number, out: string, err: string): void => {
  if (out !== '') {
    process.stdout.write(out)
  }
  if (err !== '') {
    process.stderr.write(err)
  }
  process.exitCode = code
}

// mcp, ingest, connect and eval own their help text, so `cave help X` becomes `cave X --help`.
const raw = process.argv.slice(2)
const argv = raw[0] === 'help' && (raw[1] === 'mcp' || raw[1] === 'ingest' || raw[1] === 'connect' || raw[1] === 'eval') ?
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
} else if (argv[0] === 'eval') {
  // Long-running: drives an agent (and optionally a judge) over eval fixtures.
  const { runEval } = await import('@cavelang/eval')
  process.exitCode = await runEval(argv.slice(1))
} else if (argv[0] === 'connect') {
  // Async (URL sources fetch) and potentially long-running (--watch).
  const { runConnect } = await import('@cavelang/connect')
  process.exitCode = await runConnect(argv.slice(1))
} else if (argv[0] === 'reconstruct') {
  // Async: the LLM policy runs a shell agent once per step.
  const { code, out, err } = await reconstructCommand(argv.slice(1))
  write(code, out, err)
} else if (argv[0] === 'suggest-alias') {
  // Async: the optional judge runs a shell agent.
  const { code, out, err } = await suggestAliasCommand(argv.slice(1))
  write(code, out, err)
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
