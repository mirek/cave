/**
 * `cave` command implementation — pure functions from parsed arguments to
 * `{ code, out, err }`, so tests can call commands directly and `main.ts`
 * stays a thin dispatcher.
 *
 * Commands:
 *
 * - `cave parse [file]` — lint / dump the AST (`--json`)
 * - `cave highlight [file]` — ANSI syntax colors (async, routed in `main.ts`)
 * - `cave add [--db <path>] [file…]` — ingest into a store (`--strict`, `--check`)
 * - `cave query [--db <path>] '<pattern>'` — CAVE-Q (`--json`, `--all`, `--aliases`, `--as-of`)
 * - `cave derive [--db <path>] [rules.cave…]` — fire rules (`--dry-run`, `--full`, `--list`, `--retract`)
 * - `cave act [--db <path>] <name> [param=value…]` — execute an action (spec §25; `--declare`, `--list`, `--retract`)
 * - `cave check [--db <path>]` — knowledge health report (`--stale`, `--json`)
 * - `cave export [--db <path>]` — canonical text out (`--current`)
 * - `cave connect [--db <path>] <source>` — deterministic structured ingestion (async, routed in `main.ts`)
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
import { check as caveCheck, defaultStaleDays, gatedIngest } from '@cavelang/shape'
import type { Report, Violation } from '@cavelang/shape'
import { declareRules, defaultMaxPasses, defaultMinConf, derive, listRules, retractRule } from '@cavelang/rules'
import type { Declaration, DeriveReport } from '@cavelang/rules'
import { act, declareActions, listActions, retractAction } from '@cavelang/act'
import type { ActReport } from '@cavelang/act'
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
  cave highlight [file...]                 print CAVE text with ANSI syntax colors
  cave add [--db <path>] [file...]         ingest into a store [--strict] [--check] [--no-prelude] [--no-src]
  cave import [--db <path>] [file...]      restore/merge from CAVE text (add without @src: stamping)
  cave query [--db <path>] <pattern>       run a CAVE-Q pattern [--json] [--all] [--aliases] [--as-of <t>] [--no-prelude]
  cave derive [--db <path>] [rules.cave..] declare + fire rules (spec §24) [--dry-run] [--full] [--list] [--retract <rule>]
  cave act [--db <path>] <name> [p=v...]   execute an action (spec §25) [--dry-run] [--no-check] [--hooks <file>]
  cave act --declare [file...]             declare actions from a CAVE document; --list / --retract <name> manage them
  cave check [--db <path>]                 knowledge health report (spec §20) [--stale <days>] [--json]
  cave export [--db <path>] [--out <file>] emit canonical CAVE text [--current] [--no-prelude]
  cave mcp [--db <path>]                   serve the engine as an MCP server on stdio [--no-prelude]
  cave ingest [--db <path>] <globs/urls..> LLM-driven ingestion of files and web pages
  cave connect <source> --map <file>       deterministic structured ingestion (CSV/JSON/SQLite/URL, spec §23)
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

  highlight: `cave highlight — print CAVE text with ANSI syntax colors

Usage:
  cave highlight [file...]

Reads stdin when no file (or \`-\`) is given. Colors come from the
tree-sitter grammar's highlight query (@cavelang/tree-sitter-cave), the
same source editors use. Output always carries ANSI codes — pipe through
\`less -R\` to page. \`cave export\` colors its output the same way when
stdout is a terminal (disable with NO_COLOR).

Examples:
  cave highlight notes.cave
  echo 'auth USES jwt @ 90%' | cave highlight
  cave highlight notes.cave | less -R`,

  add: `cave add — ingest CAVE text into a knowledge database

Usage:
  cave add [--db <path>] [file...] [--strict] [--check] [--no-prelude] [--no-src]

Options:
  ${dbHelp}
  --strict       reject the whole ingest on any problem
  --check        shape gate (spec §20.3): roll the append back if it
                 introduces new expectation violations
  --no-prelude   open the store without the standard verb registry
  --no-src       do not stamp actor provenance on appended claims

Reads stdin when no file (or \`-\`) is given. Claims that carry no @src:
context are stamped @src:cli (spec §9.5); use \`cave import\` to replay
exported text without stamping.

Examples:
  cave add --db k.db notes.cave
  echo 'auth USES jwt @ 90%' | cave add
  cave add --db k.db --strict reviewed.cave
  cave add --db k.db --check new-services.cave`,

  import: `cave import — restore/merge a database from CAVE text (add without @src: stamping)

Usage:
  cave import [--db <path>] [file...] [--strict] [--no-prelude]

Options:
  ${dbHelp}
  --strict       reject the whole import on any problem
  --no-prelude   open the store without the standard verb registry

Canonical CAVE text is the interchange format (spec §2.2): importing a
file written by \`cave export\` replays its claims append-only, preserving
the belief series, qualifier edges and in-band declarations. Unlike
\`cave add\`, import never stamps actor provenance — replayed claims must
keep the claim keys they were exported with (spec §9.5).

Examples:
  cave export --db old.db --out backup.cave
  cave import --db new.db backup.cave`,

  query: `cave query — run a CAVE-Q pattern against a store

Usage:
  cave query [--db <path>] <pattern> [WHERE <filter>] [--json] [--all] [--aliases] [--as-of <t>] [--no-prelude]

Options:
  ${dbHelp}
  --json         emit matches as JSON
  --all          match all beliefs, not just current ones
  --aliases      resolve entities through current ALIAS claims (spec §13.6)
  --as-of <t>    resolve beliefs as of a past moment (spec §12.3): a date
                 (whole day included), a timestamp (whole second), or a
                 transaction id — rows recorded later are invisible
  --no-prelude   open the store without the standard verb registry

Patterns are claim triples with ?variables and optional metadata filters
(spec §12). A second positional starting with WHERE filters on conf,
value or tx.

Examples:
  cave query '?x USES jwt'
  cave query --db k.db '?x HAS bug: ?bug #security'
  cave query --db k.db '?cause CAUSE app/crash' 'WHERE conf >= 0.5'
  cave query --db k.db 'terrier EXTENDS+ animal'
  cave query --db k.db '?x USES postgres' --aliases
  cave query --db k.db 'server IS compromised' --as-of 2026-01-15
  cave query --db k.db '?x ?verb ?y @production' --json`,

  derive: `cave derive — declare and fire rules (spec §24)

Usage:
  cave derive [--db <path>] [rules.cave...] [--dry-run] [--full] [--aliases]
              [--min-conf <p>] [--max-passes <n>] [--json] [--no-prelude]
  cave derive [--db <path>] --list
  cave derive [--db <path>] --retract <digest|subject>

Options:
  ${dbHelp}
  --dry-run      compute and report inside a rolled-back transaction
  --full         ignore stored watermarks — re-fire every rule (spec §24.4)
  --aliases      premises match through the alias closure (spec §13.6)
  --min-conf <p> do not assert conclusions below this confidence
                 (0..1 or N%, default ${defaultMinConf})
  --max-passes <n> fixpoint guard (default ${defaultMaxPasses})
  --list         print the store's current rules and exit
  --retract <r>  retract a rule (digest, unambiguous prefix, or subject)
                 together with everything it derived, and exit
  --json         emit the report as JSON
  --no-prelude   open the store without the standard verb registry

Rule files are CAVE documents whose \`premises => conclusion\` lines are
rules (spec §24.1); other lines — verb declarations the rules need — are
prelude, ingested first. Rules are stored in-band as
\`rule/<digest> HAS rule: \\\`…\\\`\` claims, so \`cave derive\` with no file
fires whatever the store already knows. Derived claims are stamped
@src:rule/<digest>, carry BECAUSE edges to their premise rows and a VIA
edge to the rule, and update append-only: re-runs are idempotent and
watermark-incremental, and conclusions whose premises no longer hold are
retracted (spec §24.2–§24.5).

Examples:
  cave derive --db k.db rules.cave
  cave derive --db k.db
  echo '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z' | cave derive --db k.db -
  cave derive --db k.db --dry-run --json
  cave derive --db k.db --list
  cave derive --db k.db --retract 4a0bb974f43c`,

  act: `cave act — execute, declare, list and retract actions (spec §25)

Usage:
  cave act [--db <path>] <name> [param=value...] [--dry-run] [--no-check]
           [--aliases] [--hooks <file>] [--json] [--no-prelude]
  cave act [--db <path>] --declare [file...]
  cave act [--db <path>] --list [--json]
  cave act [--db <path>] --retract <name>

Options:
  ${dbHelp}
  --dry-run      validate and report inside a rolled-back transaction;
                 hooks never fire
  --no-check     skip the shape gate (spec §25.3) — by default an
                 execution that introduces new EXPECTS violations is
                 rolled back
  --aliases      preconditions match through the alias closure (spec §13.6)
  --hooks <file> JSON file of out-of-band hook command templates,
                 name → shell template (spec §25.4); default: $CAVE_HOOKS
  --declare      declare the actions of CAVE documents (stdin when no
                 file); other lines are prelude, ingested first
  --list         print the store's current actions and exit
  --retract <n>  retract an action's declaration (effects of past
                 executions stay recorded) and exit
  --json         emit the report as JSON
  --no-prelude   open the store without the standard verb registry

An action is a named, governed write template (spec §25):

  action/mark-deployed HAS action: \`?service, ?version,
    ?service IS service => ?service HAS deployed-version: ?version\`

Executing validates the parameters, checks each precondition against
current belief (a premise with no match fails the action — nothing is
appended), then appends the effects atomically, stamped
@src:action/<name> with BECAUSE/VIA lineage. Re-runs are idempotent. A
declared hook (action/<name> HAS hook: <hook>) runs after commit when
the configuration defines it — {action} and {param} placeholders are
shell-quoted, the appended claims arrive on stdin.

Examples:
  cave act --db k.db --declare actions.cave
  cave act --db k.db mark-deployed service=api-gateway version=1.2.3
  cave act --db k.db mark-deployed service=api version=2 --dry-run
  cave act --db k.db mark-deployed service=api version=2 --hooks hooks.json
  cave act --db k.db --list
  cave act --db k.db --retract mark-deployed`,

  check: `cave check — knowledge health report (spec §20)

Usage:
  cave check [--db <path>] [--stale <days>] [--json] [--no-prelude]

Options:
  ${dbHelp}
  --stale <days> staleness horizon (default: ${defaultStaleDays})
  --json         emit the full report as JSON
  --no-prelude   open the store without the standard verb registry

Reads the store against its own in-band EXPECTS declarations (spec §20.1)
and reports shape violations, stale current beliefs, review candidates
(conf 0.3–0.7), alias disagreements (spec §13.6) and coverage stats.
Exits 1 when violations exist; everything else is advisory.

Examples:
  cave check --db k.db
  cave check --db k.db --stale 30
  cave check --db k.db --json | jq '.violations'`,

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

/**
 * `cave highlight` — ANSI syntax colors from the tree-sitter grammar's own
 * highlight query. Async (the grammar WASM loads on first use), so `main.ts`
 * routes it separately, like `mcp` and `ingest`.
 */
export const highlightCommand = async (argv: readonly string[]): Promise<Output> => {
  const { positionals } = parseArgs({ args: [...argv], options: {}, allowPositionals: true })
  const input = readInput(positionals)
  const { highlighter } = await import('@cavelang/highlight')
  const { ansi } = await highlighter()
  return ok(ansi(input))
}

/**
 * Shared by `add` and `import`; the difference is actor provenance
 * (spec §9.5). `add` records knowledge authored now, so claims without a
 * `@src:` context are stamped `@src:cli` (`--no-src` opts out); `import`
 * replays interchange text, which must preserve claim keys as exported,
 * so it never stamps.
 */
const formatViolation = (violation: Violation): string =>
  `${violation.entity} missing ${violation.expectation.kind} ${violation.expectation.name} ` +
  `(${violation.entity} IS ${violation.via}; ${violation.expectation.type} EXPECTS ${violation.expectation.name})`

const ingestCommand = (name: 'add' | 'import') => (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      strict: { type: 'boolean' },
      'no-prelude': { type: 'boolean' },
      ...name === 'add' ? { 'no-src': { type: 'boolean' }, check: { type: 'boolean' } } : {}
    },
    allowPositionals: true
  })
  const input = readInput(positionals)
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    const options = {
      strict: values.strict === true,
      ...name === 'add' && values['no-src'] !== true ? { source: 'cli' } : {}
    }
    // The shape gate (spec §20.3): append + check in one transaction,
    // rolled back when the append introduces new expectation violations.
    const outcome = name === 'add' && values.check === true ?
      gatedIngest(store, input, options) :
      { ok: true as const, result: store.ingest(input, options) }
    if (!outcome.ok) {
      const detail = outcome.violations.map(violation => `  ${formatViolation(violation)}`).join('\n')
      return fail(`rejected: ${outcome.violations.length} new violation(s), nothing added (spec §20.3)\n${detail}\n`)
    }
    const problems = outcome.result.problems
      .map(problem => `line ${problem.line}: ${problem.message}`)
      .join('\n')
    return {
      code: 0,
      out: `added ${outcome.result.ids.length} claim(s), ${outcome.result.edges} edge(s)\n`,
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
 * `add` minus provenance stamping: canonical CAVE text *is* the interchange
 * format (spec §2.2), so importing a file exported with `cave export`
 * replays its claims append-only — and because contexts are part of claim
 * identity, replay must not add a `@src:` stamp (spec §9.5). What the text
 * round trip preserves: every claim with metadata, full belief-series order
 * (rows export in tx order and re-ingest with fresh monotonic tx ids),
 * qualifier/grouping edges, and in-band registry declarations. Original tx
 * timestamps are re-minted — the text format carries no transaction
 * identity.
 */
export const importCommand = ingestCommand('import')

export const queryCommand = (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      aliases: { type: 'boolean' },
      'as-of': { type: 'string' },
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
    const matches = caveQuery(store, pattern, {
      all: values.all === true,
      aliases: values.aliases === true,
      ...values['as-of'] === undefined ? {} : { asOf: values['as-of'] }
    })
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

export const deriveCommand = (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      'dry-run': { type: 'boolean' },
      full: { type: 'boolean' },
      aliases: { type: 'boolean' },
      'min-conf': { type: 'string' },
      'max-passes': { type: 'string' },
      list: { type: 'boolean' },
      retract: { type: 'string' },
      json: { type: 'boolean' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: true
  })
  const minConf = values['min-conf'] === undefined ?
    undefined :
    values['min-conf'].endsWith('%') ? Number(values['min-conf'].slice(0, -1)) / 100 : Number(values['min-conf'])
  if (minConf !== undefined && (!Number.isFinite(minConf) || minConf < 0 || minConf > 1)) {
    return fail(`cave derive: --min-conf expects a confidence in 0..1 or N%, got ${JSON.stringify(values['min-conf'])}\n`)
  }
  const maxPasses = values['max-passes'] === undefined ? undefined : Number(values['max-passes'])
  if (maxPasses !== undefined && (!Number.isInteger(maxPasses) || maxPasses < 1)) {
    return fail(`cave derive: --max-passes expects a positive integer, got ${JSON.stringify(values['max-passes'])}\n`)
  }
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    if (values.list === true) {
      const rules = listRules(store)
      if (values.json === true) {
        return ok(`${JSON.stringify(rules, undefined, 2)}\n`)
      }
      if (rules.length === 0) {
        return ok('no rules\n')
      }
      const lines = rules.map(rule =>
        `${rule.subject} \`${rule.text}\`${rule.label === undefined ? '' : ` ; ${rule.label}`}` +
        (rule.ok ? '' : `\n  problems: ${rule.problems.join('; ')}`))
      return ok(`${lines.join('\n')}\n`)
    }
    if (values.retract !== undefined) {
      const outcome = retractRule(store, values.retract)
      if (!outcome.ok) {
        return fail(`cave derive: ${outcome.error}\n`)
      }
      return ok(`retracted ${outcome.subjects.join(', ')} and ${outcome.derived} derived claim(s)\n`)
    }

    const err: string[] = []
    const out: string[] = []
    // Unlike parse/add, no positional means "fire the stored rules", never
    // stdin — pass `-` to read a rule file from stdin explicitly.
    const input = positionals.length > 0 ? readInput(positionals) : undefined
    const options = {
      full: values.full === true,
      aliases: values.aliases === true,
      ...minConf === undefined ? {} : { minConf },
      ...maxPasses === undefined ? {} : { maxPasses }
    }
    let declaration: undefined | Declaration
    let report: DeriveReport
    if (values['dry-run'] === true) {
      // A dry run persists nothing — rule declarations from the file
      // included, so declare + fire share one rolled-back transaction.
      const rolledBack = Symbol('cave derive --dry-run')
      let outcome: undefined | { declaration?: Declaration, report: DeriveReport }
      try {
        store.transaction(() => {
          outcome = {
            ...input === undefined ? {} : { declaration: declareRules(store, input) },
            report: derive(store, options)
          }
          throw rolledBack
        })
      } catch (error) {
        if (error !== rolledBack) {
          throw error
        }
      }
      declaration = outcome!.declaration
      report = outcome!.report
    } else {
      declaration = input === undefined ? undefined : declareRules(store, input)
      report = derive(store, options)
    }
    if (declaration !== undefined) {
      err.push(...declaration.problems.map(problem => `rules line ${problem.line}: ${problem.message}`))
      out.push(`declared ${declaration.declared} rule(s)` +
        (declaration.unchanged > 0 ? `, ${declaration.unchanged} unchanged` : '') +
        (declaration.prelude > 0 ? `, +${declaration.prelude} prelude claim(s)` : ''))
    }
    if (values.json === true) {
      return { code: report.problems.length > 0 ? 1 : 0, out: `${JSON.stringify(report, undefined, 2)}\n`, err: err.join('\n') + (err.length > 0 ? '\n' : '') }
    }
    for (const problem of report.problems) {
      err.push(`${problem.subject}: ${problem.problems.join('; ')}`)
    }
    for (const rule of report.rules) {
      const state = rule.fired ?
        `${rule.solutions} solution(s), +${rule.appended} appended, ${rule.updated} updated, ${rule.retracted} retracted, ${rule.unchanged} unchanged` :
        'unchanged premises, skipped'
      out.push(`${rule.subject}: ${state}${rule.label === undefined ? '' : ` ; ${rule.label}`}`)
      err.push(...rule.problems.map(problem => `${rule.subject}: ${problem}`))
    }
    out.push(...report.notes.map(note => `note: ${note}`))
    out.push(
      `derived${values['dry-run'] === true ? ' (dry run)' : ''}: ` +
      `+${report.appended} appended, ${report.updated} updated, ${report.retracted} retracted, ` +
      `${report.unchanged} unchanged (${report.passes} pass(es))`)
    const hasProblems = report.problems.length > 0 || report.rules.some(rule => rule.problems.length > 0)
    return { code: hasProblems ? 1 : 0, out: `${out.join('\n')}\n`, err: err.length === 0 ? '' : `${err.join('\n')}\n` }
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    store.close()
  }
}

/**
 * Loads a hooks configuration file (spec §25.4): a JSON object mapping
 * hook names to shell command templates.
 */
const readHooks = (path: string): Record<string, string> => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
      Object.values(parsed).some(value => typeof value !== 'string')) {
    throw new Error(`${path}: hooks must be a JSON object of name → shell template strings`)
  }
  return parsed as Record<string, string>
}

/** Text rendering of a spec §25.2 execution report. */
const renderActReport = (report: ActReport): { lines: string[], code: number } => {
  if (!report.ok) {
    const lines = [`cave act: ${report.error}`]
    for (const violation of report.violations ?? []) {
      lines.push(`  ${formatViolation(violation)}`)
    }
    return { lines, code: 1 }
  }
  const lines = [
    `executed ${report.subject}${report.dryRun ? ' (dry run)' : ''}: ` +
    `+${report.appended} appended, ${report.updated} updated, ${report.unchanged} unchanged ` +
    `(${report.solutions} solution(s))`,
    ...report.effects.map(effect => `  ${effect.outcome}: ${effect.line}`)
  ]
  let code = 0
  if (report.hook !== undefined) {
    if (!report.hook.fired) {
      lines.push(`hook ${report.hook.name}: not fired (${report.hook.note})`)
    } else if (report.hook.error === undefined) {
      lines.push(`hook ${report.hook.name}: ok`)
    } else {
      // The claims committed before the hook ran (spec §25.4) — the
      // failure is reported, and the exit code carries it.
      lines.push(`hook ${report.hook.name}: ${report.hook.error}`)
      code = 1
    }
  }
  return { lines, code }
}

export const actCommand = (argv: readonly string[]): Output => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      declare: { type: 'boolean' },
      list: { type: 'boolean' },
      retract: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'no-check': { type: 'boolean' },
      aliases: { type: 'boolean' },
      hooks: { type: 'string' },
      json: { type: 'boolean' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: true
  })
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    if (values.declare === true) {
      const declaration = declareActions(store, readInput(positionals))
      const err = declaration.problems.map(problem => `line ${problem.line}: ${problem.message}`)
      const out = `declared ${declaration.declared} action(s)` +
        (declaration.unchanged > 0 ? `, ${declaration.unchanged} unchanged` : '') +
        (declaration.prelude > 0 ? `, +${declaration.prelude} prelude claim(s)` : '')
      return {
        code: declaration.problems.length > 0 ? 1 : 0,
        out: `${out}\n`,
        err: err.length === 0 ? '' : `${err.join('\n')}\n`
      }
    }
    if (values.list === true) {
      const actions = listActions(store)
      if (values.json === true) {
        return ok(`${JSON.stringify(actions, undefined, 2)}\n`)
      }
      if (actions.length === 0) {
        return ok('no actions\n')
      }
      const lines = actions.flatMap(action => [
        `${action.subject} \`${action.text}\`${action.description === undefined ? '' : ` ; ${action.description}`}`,
        ...action.params.map(param => `  ?${param.name}${param.doc === undefined ? '' : ` — ${param.doc}`}`),
        ...action.hook === undefined ? [] : [`  hook: ${action.hook}`],
        ...action.ok ? [] : [`  problems: ${action.problems.join('; ')}`]
      ])
      return ok(`${lines.join('\n')}\n`)
    }
    if (values.retract !== undefined) {
      const outcome = retractAction(store, values.retract)
      if (!outcome.ok) {
        return fail(`cave act: ${outcome.error}\n`)
      }
      return ok(`retracted ${outcome.subject} — effects of past executions stay recorded (spec §25.1)\n`)
    }

    const [name, ...pairs] = positionals
    if (name === undefined) {
      return fail('cave act: an action name is required — or --declare, --list, --retract (spec §25.2)\n')
    }
    const args: Record<string, string> = {}
    for (const pair of pairs) {
      const at = pair.indexOf('=')
      if (at <= 0) {
        return fail(`cave act: expected param=value, got ${JSON.stringify(pair)}\n`)
      }
      args[pair.slice(0, at)] = pair.slice(at + 1)
    }
    const hooksPath = values.hooks ?? process.env['CAVE_HOOKS']
    const report = act(store, name, args, {
      dryRun: values['dry-run'] === true,
      check: values['no-check'] !== true,
      aliases: values.aliases === true,
      ...hooksPath === undefined ? {} : { hooks: readHooks(hooksPath) }
    })
    if (values.json === true) {
      return { code: report.ok && report.hook?.error === undefined ? 0 : 1, out: `${JSON.stringify(report, undefined, 2)}\n`, err: '' }
    }
    const { lines, code } = renderActReport(report)
    return report.ok ?
      { code, out: `${lines.join('\n')}\n`, err: '' } :
      { code, out: '', err: `${lines.join('\n')}\n` }
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    store.close()
  }
}

/** Text rendering of the §20.2 report: always shape + coverage, non-empty advisory sections. */
const renderReport = (report: Report, staleDays: number): string => {
  const lines: string[] = []
  const { coverage } = report
  lines.push(`shape: ${coverage.expectations} expectation(s), ${coverage.instances} instance(s), ${coverage.satisfied}/${coverage.checks} satisfied`)
  if (report.violations.length > 0) {
    lines.push(`violations (${report.violations.length}):`)
    lines.push(...report.violations.map(violation => `  ${formatViolation(violation)}`))
  }
  if (report.stale.length > 0) {
    lines.push(`stale (${report.stale.length}, older than ${staleDays} day(s)):`)
    lines.push(...report.stale.map(({ row, ageDays }) => `  ${row.raw_line} (${ageDays}d)`))
  }
  if (report.review.length > 0) {
    lines.push(`review candidates (${report.review.length}, conf 0.3-0.7):`)
    lines.push(...report.review.map(row => `  ${row.raw_line}`))
  }
  if (report.disagreements.length > 0) {
    lines.push(`alias disagreements (${report.disagreements.length}):`)
    for (const disagreement of report.disagreements) {
      lines.push(`  ${disagreement.about} across ${disagreement.entities.join(', ')}:`)
      lines.push(...disagreement.rows.map(row => `    ${row.raw_line}`))
    }
  }
  const confidence = coverage.averageConfidence === null ?
    '' :
    `; avg conf ${Math.round(coverage.averageConfidence * 100)}%, ${coverage.lowConfidence} low (< 0.3)`
  lines.push(
    `coverage: ${coverage.rows} row(s), ${coverage.facts} fact(s) — ` +
    `${coverage.current} current, ${coverage.retracted} retracted, ${coverage.negated} negated` +
    `${confidence}; ${coverage.entities} entities, ${coverage.typedEntities} typed`
  )
  return `${lines.join('\n')}\n`
}

export const checkCommand = (argv: readonly string[]): Output => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      stale: { type: 'string' },
      json: { type: 'boolean' },
      'no-prelude': { type: 'boolean' }
    },
    allowPositionals: false
  })
  const staleDays = values.stale === undefined ? defaultStaleDays : Number(values.stale)
  if (!Number.isFinite(staleDays) || staleDays < 0) {
    return fail(`cave check: --stale expects a non-negative number of days, got ${JSON.stringify(values.stale)}\n`)
  }
  const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
  try {
    const report = caveCheck(store, { staleDays })
    const out = values.json === true ?
      `${JSON.stringify(report, undefined, 2)}\n` :
      renderReport(report, staleDays)
    // Violations fail the check (spec §20.2); the other sections are advisory.
    return { code: report.violations.length > 0 ? 1 : 0, out, err: '' }
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
  // mcp, ingest and connect own their help (main.ts forwards `help X` to `X --help`).
  if (topic === 'mcp' || topic === 'ingest' || topic === 'connect') {
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
      case 'derive':
        return deriveCommand(rest)
      case 'act':
        return actCommand(rest)
      case 'check':
        return checkCommand(rest)
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
