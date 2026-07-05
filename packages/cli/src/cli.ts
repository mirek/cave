/**
 * `cave` command implementation — pure functions from parsed arguments to
 * `{ code, out, err }`, so tests can call commands directly and `main.ts`
 * stays a thin dispatcher.
 *
 * Commands:
 *
 * - `cave parse [file]` — lint / dump the AST (`--json`)
 * - `cave add [--db <path>] [file…]` — ingest into a store (`--strict`)
 * - `cave query [--db <path>] '<pattern>'` — CAVE-Q (`--json`, `--all`)
 * - `cave export [--db <path>]` — canonical text out (`--current`)
 * - `cave demo` — the cave-loop multi-hop recovery demo
 * - `cave version` — print the cave version
 * - `cave help [command]` — overview, or one command's help
 *
 * `file` defaults to stdin (`-`); `--db` defaults to `$CAVE_DB`, then
 * `cave.db`. Every command answers `--help` with options and examples.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Version } from '@cavelang/core'
import { parseDocument } from '@cavelang/parser'
import { Registry, standardRegistry } from '@cavelang/canonical'
import { defaultDbPath, open } from '@cavelang/store'
import { query as caveQuery } from '@cavelang/query'
import { Demo } from '@cavelang/loop'

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
  cave parse [file...] [--json]            lint CAVE text (stdin when no file)
  cave add [--db <path>] [file...]         ingest into a store [--strict] [--no-prelude]
  cave import [--db <path>] [file...]      restore/merge from CAVE text (same as add)
  cave query [--db <path>] <pattern>       run a CAVE-Q pattern [--json] [--all] [--no-prelude]
  cave export [--db <path>] [--out <file>] emit canonical CAVE text [--current] [--no-prelude]
  cave mcp [--db <path>]                   serve the engine as an MCP server on stdio [--no-prelude]
  cave ingest [--db <path>] <globs/urls..> LLM-driven ingestion of files and web pages
  cave demo                                run the cave-loop reconstruction demo
  cave version                             print the cave version
  cave help [command]                      this text, or one command's options and examples

Every command answers --help. --db defaults to $CAVE_DB, or cave.db in
the current directory. The spec lives in the .claude/skills/ directory at
the repository root (section index in README.md).`

const dbHelp = `--db <path>    database file (default: $CAVE_DB, or cave.db)`

/** Per-command help, printed for \`cave <command> --help\` and \`cave help <command>\`. */
export const commandHelp: Record<string, string> = {
  parse: `cave parse — lint CAVE text, or dump the parsed document

Usage:
  cave parse [file...] [--json]

Options:
  --json         dump the parsed document as JSON instead of a summary

Reads stdin when no file (or \`-\`) is given. Exits 1 when the text has
diagnostics, printing them one per line to stderr.

Examples:
  cave parse notes.cave
  echo 'auth USES jwt @ 90%' | cave parse
  cave parse notes.cave --json | jq '.lines[0]'`,

  add: `cave add — ingest CAVE text into a knowledge database

Usage:
  cave add [--db <path>] [file...] [--strict] [--no-prelude]

Options:
  ${dbHelp}
  --strict       reject the whole ingest on any problem
  --no-prelude   open the store without the standard verb registry

Reads stdin when no file (or \`-\`) is given.

Examples:
  cave add --db k.db notes.cave
  echo 'auth USES jwt @ 90%' | cave add
  cave add --db k.db --strict reviewed.cave`,

  import: `cave import — restore/merge a database from CAVE text (same as add)

Usage:
  cave import [--db <path>] [file...] [--strict] [--no-prelude]

Options:
  ${dbHelp}
  --strict       reject the whole import on any problem
  --no-prelude   open the store without the standard verb registry

Canonical CAVE text is the interchange format (spec §2.2): importing a
file written by \`cave export\` replays its claims append-only, preserving
the belief series, qualifier edges and in-band declarations.

Examples:
  cave export --db old.db --out backup.cave
  cave import --db new.db backup.cave`,

  query: `cave query — run a CAVE-Q pattern against a store

Usage:
  cave query [--db <path>] <pattern> [WHERE <filter>] [--json] [--all] [--no-prelude]

Options:
  ${dbHelp}
  --json         emit matches as JSON
  --all          match all beliefs, not just current ones
  --no-prelude   open the store without the standard verb registry

Patterns are claim triples with ?variables and optional metadata filters
(spec §12). A second positional starting with WHERE filters on conf,
value or tx.

Examples:
  cave query '?x USES jwt'
  cave query --db k.db '?x HAS bug: ?bug #security'
  cave query --db k.db '?cause CAUSE app/crash' 'WHERE conf >= 0.5'
  cave query --db k.db 'terrier EXTENDS+ animal'
  cave query --db k.db '?x ?verb ?y @production' --json`,

  export: `cave export — emit canonical CAVE text from a store

Usage:
  cave export [--db <path>] [--out <file>] [--current] [--no-prelude]

Options:
  ${dbHelp}
  --out <file>   write to a file instead of stdout
  --current      current beliefs only (skip superseded rows)
  --no-prelude   open the store without the standard verb registry

Examples:
  cave export --db k.db
  cave export --db k.db --out backup.cave
  cave export --db k.db --current --out snapshot.cave`,

  demo: `cave demo — run the cave-loop multi-hop reconstruction demo

Usage:
  cave demo

Narrates the spec §18 recovery: seed cues expand symptom → cause →
topic → fix over a small in-memory store.`,

  version: `cave version — print the cave version

Usage:
  cave version`
}

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
  const input = readInput(positionals)
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
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
  if (positionals.length === 0) {
    return fail('cave query: a pattern is required (spec §12.1)\n')
  }
  const pattern = positionals.join('\n')
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
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
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
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

export const versionCommand = (): Output =>
  ok(`${Version.current()}\n`)

/** `cave help [command]` — the overview, or one command's help text. */
export const helpCommand = (argv: readonly string[]): Output => {
  const [topic] = argv
  if (topic === undefined) {
    return ok(`${usage}\n`)
  }
  const text = commandHelp[topic === 'q' ? 'query' : topic]
  if (text !== undefined) {
    return ok(`${text}\n`)
  }
  // mcp and ingest own their help (main.ts forwards `help X` to `X --help`).
  if (topic === 'mcp' || topic === 'ingest') {
    return ok(`see: cave ${topic} --help\n`)
  }
  return fail(`cave help: unknown command ${JSON.stringify(topic)}\n\n${usage}\n`, 2)
}

/** Dispatches one invocation. */
export const cave = (argv: readonly string[]): Output => {
  const [command, ...rest] = argv
  const canonical = command === 'q' ? 'query' : command
  try {
    if (canonical !== undefined && canonical in commandHelp &&
        (rest.includes('--help') || rest.includes('-h'))) {
      return ok(`${commandHelp[canonical]}\n`)
    }
    switch (canonical) {
      case 'parse':
        return parseCommand(rest)
      case 'add':
        return addCommand(rest)
      case 'import':
        return importCommand(rest)
      case 'query':
        return queryCommand(rest)
      case 'export':
        return exportCommand(rest)
      case 'demo':
        return demoCommand()
      case 'version':
      case '--version':
      case '-v':
        return versionCommand()
      case 'help':
        return helpCommand(rest)
      case undefined:
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
