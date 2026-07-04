/**
 * `cave` command implementation — pure functions from parsed arguments to
 * `{ code, out, err }`, so tests can call commands directly and `main.ts`
 * stays a thin dispatcher.
 *
 * Commands:
 *
 * - `cave parse [file]` — lint / dump the AST (`--json`)
 * - `cave add [file…] --db <path>` — ingest into a store (`--strict`)
 * - `cave query '<pattern>' --db <path>` — CAVE-Q (`--json`, `--all`)
 * - `cave export --db <path>` — canonical text out (`--current`)
 * - `cave demo` — the cave-loop multi-hop recovery demo
 *
 * `file` defaults to stdin (`-`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { parseDocument } from '@cave/parser'
import { Registry, standardRegistry } from '@cave/canonical'
import { open } from '@cave/store'
import { query as caveQuery } from '@cave/query'
import { Demo } from '@cave/loop'

export type Output = {
  readonly code: number
  readonly out: string
  readonly err: string
}

const ok = (out: string): Output =>
  ({ code: 0, out, err: '' })

const fail = (err: string, code = 1): Output =>
  ({ code, out: '', err })

export const usage = `cave — Compressed Atomic Verb Expressions

Usage:
  cave parse [file] [--json]             lint CAVE text (stdin when no file)
  cave add [file...] --db <path>         ingest into a store [--strict] [--no-prelude]
  cave import [file...] --db <path>      restore/merge a database from CAVE text (same as add)
  cave query <pattern> --db <path>       run a CAVE-Q pattern [--json] [--all] [--no-prelude]
  cave export --db <path> [--out <file>] emit canonical CAVE text [--current] [--no-prelude]
  cave mcp --db <path>                   serve the engine as an MCP server on stdio [--no-prelude]
  cave ingest <globs...> --db <path>     LLM-driven ingestion of files (cave ingest --help)
  cave demo                              run the cave-loop reconstruction demo
  cave help                              this text

The spec lives in README.md at the repository root.`

const readInput = (files: readonly string[]): string =>
  files.length === 0 || (files.length === 1 && files[0] === '-') ?
    readFileSync(0, 'utf8') :
    files.map(file => readFileSync(file, 'utf8')).join('\n')

export const parseCommand = (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { json: { type: 'boolean' } },
    allowPositionals: true
  })
  const input = readInput(positionals)
  const document = parseDocument(input)
  if (values.json === true) {
    return ok(`${JSON.stringify(document, undefined, 2)}\n`)
  }
  const counts = new Map<string, number>()
  for (const line of document.lines) {
    counts.set(line.kind, (counts.get(line.kind) ?? 0) + 1)
  }
  const summary = [...counts]
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ')
  if (document.diagnostics.length === 0) {
    return ok(`ok: ${summary}\n`)
  }
  const problems = document.diagnostics
    .map(diagnostic => `line ${diagnostic.line}: ${diagnostic.message}`)
    .join('\n')
  return { code: 1, out: `${summary}\n`, err: `${problems}\n` }
}

const ingestCommand = (name: string) => (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      strict: { type: 'boolean' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: true
  })
  if (values.db === undefined) {
    return fail(`cave ${name}: --db <path> is required\n`)
  }
  const input = readInput(positionals)
  const store = open(values.db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    const result = store.ingest(input, { strict: values.strict === true })
    const problems = result.problems
      .map(problem => `line ${problem.line}: ${problem.message}`)
      .join('\n')
    return {
      code: 0,
      out: `added ${result.ids.length} claim(s), ${result.edges} edge(s)\n`,
      err: problems === '' ? '' : `${problems}\n`
    }
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    store.close()
  }
}

export const addCommand = ingestCommand('add')

/**
 * `cave import` — restore/merge a knowledge database from CAVE text files.
 * Identical to `add` by design: canonical CAVE text *is* the interchange
 * format (spec §2.2), so importing a file exported with `cave export`
 * replays its claims append-only. What the text round trip preserves:
 * every claim with metadata, full belief-series order (rows export in tx
 * order and re-ingest with fresh monotonic tx ids), qualifier/grouping
 * edges, and in-band registry declarations. Original tx timestamps are
 * re-minted — the text format carries no transaction identity.
 */
export const importCommand = ingestCommand('import')

export const queryCommand = (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: true
  })
  if (values.db === undefined) {
    return fail('cave query: --db <path> is required\n')
  }
  if (positionals.length === 0) {
    return fail('cave query: a pattern is required (spec §12.1)\n')
  }
  const pattern = positionals.join('\n')
  const store = open(values.db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    const matches = caveQuery(store, pattern, { all: values.all === true })
    if (values.json === true) {
      return ok(`${JSON.stringify(matches, undefined, 2)}\n`)
    }
    if (matches.length === 0) {
      return ok('no matches\n')
    }
    const lines = matches.map(match => {
      const bindings = Object.entries(match.bindings)
        .map(([name, value]) => `?${name} = ${value}`)
        .join('  ')
      // A fully bound pattern has no bindings to print; transitive matches
      // additionally carry no row — confirm with the pattern itself.
      return bindings !== '' ? bindings : match.row?.raw_line ?? pattern.split('\n')[0]!
    })
    return ok(`${lines.join('\n')}\n`)
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    store.close()
  }
}

export const exportCommand = (argv: readonly string[]): Output => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      current: { type: 'boolean' },
      out: { type: 'string' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: false
  })
  if (values.db === undefined) {
    return fail('cave export: --db <path> is required\n')
  }
  const store = open(values.db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    const text = store.exportText({ current: values.current === true })
    if (values.out === undefined) {
      return ok(text)
    }
    writeFileSync(values.out, text)
    const claims = text === '' ? 0 : text.trimEnd().split('\n').length
    return ok(`exported ${claims} claim(s) to ${values.out}\n`)
  } finally {
    store.close()
  }
}

export const demoCommand = (): Output =>
  ok(`${Demo.run().lines.join('\n')}\n`)

/** Dispatches one invocation. */
export const cave = (argv: readonly string[]): Output => {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'parse':
        return parseCommand(rest)
      case 'add':
        return addCommand(rest)
      case 'import':
        return importCommand(rest)
      case 'query':
      case 'q':
        return queryCommand(rest)
      case 'export':
        return exportCommand(rest)
      case 'demo':
        return demoCommand()
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        return ok(`${usage}\n`)
      default:
        return fail(`cave: unknown command ${JSON.stringify(command)}\n\n${usage}\n`, 2)
    }
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n`)
  }
}
