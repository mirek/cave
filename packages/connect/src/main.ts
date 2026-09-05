/**
 * `cave connect` entry — argument parsing, pass orchestration (single,
 * `--watch`, `--query`), and report rendering around `run.ts`.
 */

import { readFileSync, watch as watchFs } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { LocateError, defaultDbPath, kindOf, open, openAt } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { Record as QueryRecord, query as caveQuery } from '@cavelang/query'
import type { Match } from '@cavelang/query'
import * as Declared from './declared.ts'
import * as Source from './source.ts'
import * as Template from './template.ts'
import { connect, federatedQuery } from './run.ts'
import type { Report } from './run.ts'

const usage = `cave connect — deterministic structured ingestion through a mapping template (spec §23)

Usage:
  cave connect [--db <path>] <source> --map <file> [options]
  cave connect [--db <path>] [--name <n>] [--force] [--prune] [--dry-run] [--watch]
  cave connect [--db <path>] --list
  cave connect [--db <path>] --query '<pattern>'

The source is a .csv/.tsv/.json/.jsonl/.ndjson file, a SQLite database
(with --table or --sql), or an http(s) URL serving JSON or CSV. The
mapping is an ordinary CAVE document whose ?field variables stand for
record fields; variable-free blocks append once per run, variable blocks
instantiate once per record — no LLM in the loop, same input, same claims.
Mapped claims retain the physical source; CSV/TSV and JSONL records also carry
their exact one-based inclusive line span (spec §9.8).

Without a source, the store's declared sources run (spec §23.4): every
source/<name> entity whose current claims name a path, with the other
options as attributes — HAS map:, key:, format:, delimiter:, table:, sql:,
records:. A .cave path needs no map (the file is its own template). Paths
resolve against the store's directory. Declared sources stamp
@src:<name>/<key> and keep digests under source/<name>/<key>, so the
source/<name> entity also carries the §26.3 policy for what it yields. A
CAVE text file used as --db follows its declared sources on every open.

Options:
  --db <path>          knowledge database (default: $CAVE_DB, or cave.db)
  --map <file>         mapping template (required)
  --name <name>        source name for record identity (default: file basename)
  --key <field>        record key field — keyed records diff against their
                       previous claims on change; unkeyed records are
                       content-addressed
  --format <fmt>       csv | tsv | json | jsonl | sqlite (default: by extension)
  --delimiter <char>   CSV field delimiter (default , — tab for .tsv)
  --table <name>       SQLite table to read (SELECT *)
  --sql <query>        SQLite query (alternative to --table)
  --records <path>     dot path to the record array inside a JSON document
  --force              re-map records whose digest is unchanged
  --prune              retract claims of records that disappeared from the source
  --dry-run            print the instantiated claims, write nothing
  --watch              keep running; re-map when the source or mapping changes
  --query <pattern>    federation-lite (spec §23.3): map, query the union,
                       roll back — nothing persists; uses an in-memory store
                       when the database file does not exist; without a
                       source, overlays every declared source
  --list               print the declared sources as cave connect invocations
  --name <name>        without a source: run only this declared source
  --json               with --query: emit matches as JSON
  --all                with --query: match all beliefs, not just current ones
  --aliases            with --query: resolve entities through ALIAS claims
  --no-prelude         open the store without the standard §5.5 registry

Examples:
  cave connect --db k.db --list
  cave connect --db k.db
  cave connect --db k.db --watch
  cave query --db notes.cave '?who WORKS-AT acme'     # a text store follows its sources
  cave connect people.csv --map people.map.cave --db k.db --key id
  cave connect crm.sqlite --table contacts --map contacts.map.cave --key email
  cave connect https://api.example.com/deps.json --records data.items --map deps.map.cave
  cave connect events.jsonl --map events.map.cave --watch
  cave connect people.csv --map people.map.cave --query '?who WORKS-AT acme'`

type Values = {
  db?: string
  map?: string
  name?: string
  key?: string
  format?: string
  delimiter?: string
  table?: string
  sql?: string
  records?: string
  force?: boolean
  prune?: boolean
  'dry-run'?: boolean
  watch?: boolean
  query?: string
  json?: boolean
  all?: boolean
  aliases?: boolean
  'no-prelude'?: boolean
  list?: boolean
  help?: boolean
}

export type RunContext = {
  readonly stdout?: NodeJS.WritableStream
  readonly stderr?: NodeJS.WritableStream
  readonly signal?: AbortSignal
  /** URL transport injection for deterministic integrations. */
  readonly fetchImpl?: Source.FetchLike
  /** Directory-watcher injection; production uses `node:fs.watch`. */
  readonly watch?: WatchLike
  /** Debounce scheduler injection; production waits 200ms. */
  readonly schedule?: ScheduleLike
  readonly cancelScheduled?: (handle: unknown) => void
}

export type WatchLike = (
  path: string,
  listener: (event: string, filename: string | Buffer | null) => void
) => { close(): void }

export type ScheduleLike = (callback: () => Promise<void>, delayMs: number) => unknown

type IO = {
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

const waitForAbort = (signal?: AbortSignal): Promise<void> =>
  signal?.aborted === true ? Promise.resolve() : new Promise(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }))

const renderReport = (report: Report): string => {
  const lines = [
    `connect: ${report.records} record(s): ${report.mapped} mapped, ${report.skipped} skipped (unchanged)` +
    `${report.failures.length > 0 ? `, ${report.failures.length} failed` : ''}` +
    `; +${report.added} claim(s)` +
    `${report.retracted > 0 ? `, ${report.retracted} retracted` : ''}` +
    `${report.pruned > 0 ? `, ${report.pruned} record(s) pruned` : ''}` +
    `${report.dropped > 0 ? `, ${report.dropped} line(s) dropped` : ''}`
  ]
  for (const note of report.notes) {
    lines.push(`  note: ${note}`)
  }
  for (const failure of report.failures) {
    lines.push(`  ${failure.record}: FAILED`)
    lines.push(...failure.problems.map(problem => `    ${problem}`))
  }
  return lines.join('\n')
}

const loadMapping = (path: string): { mapping?: Template.Mapping, problems: readonly string[] } =>
  Template.parse(readFileSync(path, 'utf8'))

const sourceOptions = (values: Values, context: RunContext): Source.Options => ({
  ...values.format === undefined ? {} : { format: values.format as Source.Format },
  ...values.delimiter === undefined ? {} : { delimiter: values.delimiter },
  ...values.table === undefined ? {} : { table: values.table },
  ...values.sql === undefined ? {} : { sql: values.sql },
  ...values.records === undefined ? {} : { records: values.records },
  ...context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }
})

const loadSource = async (source: string, values: Values, context: RunContext): Promise<Source.Loaded> => {
  try {
    return await Source.load(source, sourceOptions(values, context))
  } catch (error) {
    throw new Error(`load ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const runPass = async (
  store: Store,
  source: string,
  values: Values,
  name: string,
  io: IO,
  context: RunContext
): Promise<number> => {
  const { mapping, problems } = loadMapping(values.map!)
  if (mapping === undefined) {
    io.stderr.write(`${problems.join('\n')}\n`)
    return 1
  }
  const loaded = await loadSource(source, values, context)
  const report = connect(store, mapping, loaded.records, {
    name,
    source,
    ...loaded.spans === undefined ? {} : { spans: loaded.spans },
    ...values.key === undefined ? {} : { key: values.key },
    force: values.force === true,
    prune: values.prune === true
  })
  io.stdout.write(`${renderReport(report)}\n`)
  return report.failures.length > 0 ? 1 : 0
}

const runDry = async (source: string, values: Values, io: IO, context: RunContext): Promise<number> => {
  const { mapping, problems } = loadMapping(values.map!)
  if (mapping === undefined) {
    io.stderr.write(`${problems.join('\n')}\n`)
    return 1
  }
  const loaded = await loadSource(source, values, context)
  // Each section opens with a marker comment and a blank line: the blank
  // line keeps the marker documentary (§6.4) when the preview is added to
  // a store, so it carries exactly the claims a real run would write.
  const sections: string[] = []
  if (mapping.prelude !== '') {
    sections.push(`; --- prelude\n\n${mapping.prelude.trimEnd()}`)
  }
  let failures = 0
  loaded.records.forEach((record, at) => {
    const instantiation = Template.instantiate(mapping.templates, name => Template.fieldOf(record, name))
    if (instantiation.problems.length > 0) {
      failures += 1
      sections.push([`; --- record ${at + 1}`, ...instantiation.problems.map(problem => `; FAILED — ${problem}`)].join('\n'))
      return
    }
    sections.push(`; --- record ${at + 1}\n\n${instantiation.text.trimEnd()}`)
  })
  io.stdout.write(`${sections.join('\n\n')}\n`)
  return failures > 0 ? 1 : 0
}

const runQuery = async (
  source: string,
  values: Values,
  name: string,
  io: IO,
  context: RunContext
): Promise<number> => {
  const { mapping, problems } = loadMapping(values.map!)
  if (mapping === undefined) {
    io.stderr.write(`${problems.join('\n')}\n`)
    return 1
  }
  const loaded = await loadSource(source, values, context)
  const db = values.db ?? defaultDbPath()
  const registry = values['no-prelude'] === true ? { registry: Registry.empty } : {}
  // Federation over a store that does not exist yet queries the source alone.
  const store = kindOf(db) === 'missing' ? open(':memory:', registry) : openAt(db, { intent: 'scratch', ...registry })
  try {
    const { matches, report } = federatedQuery(
      store, mapping, loaded.records,
      {
        name,
        source,
        ...loaded.spans === undefined ? {} : { spans: loaded.spans },
        ...values.key === undefined ? {} : { key: values.key }
      },
      values.query!,
      { all: values.all === true, aliases: values.aliases === true }
    )
    // A failed record means the union was incomplete — matches still print
    // as partial results, but the exit code must not read as success.
    const code = report.failures.length > 0 ? 1 : 0
    if (code !== 0) {
      io.stderr.write(`${renderReport(report)}\n`)
    }
    if (values.json === true) {
      io.stdout.write(`${JSON.stringify(matches.map(match => QueryRecord.of(store, match)), undefined, 2)}\n`)
      return code
    }
    if (matches.length === 0) {
      io.stdout.write('no matches\n')
      return code
    }
    const lines = matches.map(match => {
      const bindings = Object.entries(match.bindings)
        .map(([variable, value]) => `?${variable} = ${value}`)
        .join('  ')
      return bindings !== '' ? bindings : match.row?.raw_line ?? values.query!
    })
    io.stdout.write(`${lines.join('\n')}\n`)
    return code
  } finally {
    store.close()
  }
}

const runWatch = async (
  store: Store,
  source: string,
  values: Values,
  name: string,
  io: IO,
  context: RunContext
): Promise<number> => {
  const passOnce = async (): Promise<void> => {
    try {
      await runPass(store, source, values, name, io, context)
    } catch (error) {
      io.stderr.write(`cave connect watch pass: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  let running = false
  let queued = false
  let timer: unknown
  let active: undefined | Promise<void>
  const fire = async (): Promise<void> => {
    if (running) {
      queued = true
      return
    }
    running = true
    do {
      queued = false
      await passOnce()
    } while (queued)
    running = false
  }
  const schedule: ScheduleLike = context.schedule ?? ((callback, delayMs) =>
    setTimeout(() => { void callback() }, delayMs))
  const cancelScheduled = context.cancelScheduled ?? (handle =>
    clearTimeout(handle as ReturnType<typeof setTimeout>))
  const trigger = (): void => {
    if (running) {
      queued = true
      return
    }
    if (timer !== undefined) cancelScheduled(timer)
    timer = schedule(async () => {
      timer = undefined
      const pass = fire()
      active = pass
      await pass
      if (active === pass) active = undefined
    }, 200)
  }
  // Watch the parent directories — editors replace files on save, and a
  // watcher on the file itself dies with the old inode.
  const targets = [...new Set([resolve(source), resolve(values.map!)])]
  const watch: WatchLike = context.watch ?? ((path, listener) => watchFs(path, listener))
  const watchers = targets.map(target =>
    watch(dirname(target), (_event, filename) => {
      // Some platforms and watcher backends cannot identify the changed
      // directory entry. A filename-less event is therefore a rescan signal,
      // while Buffer filenames retain the same exact target filtering.
      if (filename === null || filename.toString() === basename(target)) {
        trigger()
      }
    }))
  try {
    // Install watchers before the initial pass. A save during startup is
    // therefore either read by this pass or queued for the next one.
    await passOnce()
    io.stdout.write('watching (ctrl-c to stop)\n')
    await waitForAbort(io.signal)
    return 0
  } finally {
    if (timer !== undefined) cancelScheduled(timer)
    watchers.forEach(watcher => watcher.close())
    await active
  }
}

const printMatches = (store: Store, matches: readonly Match[], pattern: string, values: Values, io: IO): void => {
  if (values.json === true) {
    io.stdout.write(`${JSON.stringify(matches.map(match => QueryRecord.of(store, match)), undefined, 2)}\n`)
    return
  }
  if (matches.length === 0) {
    io.stdout.write('no matches\n')
    return
  }
  const lines = matches.map(match => {
    const bindings = Object.entries(match.bindings)
      .map(([variable, value]) => `?${variable} = ${value}`)
      .join('  ')
    return bindings !== '' ? bindings : match.row?.raw_line ?? pattern
  })
  io.stdout.write(`${lines.join('\n')}\n`)
}

const registryOf = (values: Values): { registry?: Registry.t } =>
  values['no-prelude'] === true ? { registry: Registry.empty } : {}

/** The declared sources of the store, or the one `--name` selects. */
const selectDeclared = (store: Store, values: Values): Declared.t[] => {
  const declared = Declared.declaredSources(store)
  if (values.name === undefined) {
    return declared
  }
  const selected = declared.filter(source => source.name === values.name)
  if (selected.length === 0) {
    throw new Error(`no declared source/${values.name}` +
      (declared.length === 0 ? ' — the store declares no sources' : ` — declared: ${declared.map(source => source.name).join(', ')}`))
  }
  return selected
}

const declaredPass = async (
  store: Store,
  root: string,
  values: Values,
  io: IO,
  context: RunContext
): Promise<number> => {
  const dir = Declared.directoryOf(root)
  let failed = 0
  const done = new Set<string>()
  // A followed .cave source may declare sources of its own: keep going
  // until no undeclared-so-far source is left, as `assemble` does.
  for (;;) {
    const pending = selectDeclared(store, values).filter(declared => !done.has(declared.name))
    if (pending.length === 0) {
      return failed > 0 ? 1 : 0
    }
    for (const declared of pending) {
      done.add(declared.name)
      try {
        const ready = await Declared.prepare(declared, dir, context.fetchImpl)
        const report = Declared.run(store, ready, { force: values.force === true, prune: values.prune === true })
        io.stdout.write(`source/${declared.name}: ${renderReport(report).replace(/^connect: /, '')}\n`)
        if (report.failures.length > 0) failed += 1
      } catch (error) {
        io.stderr.write(`source/${declared.name} (${declared.path}): ${error instanceof Error ? error.message : String(error)}\n`)
        failed += 1
      }
    }
  }
}

const declaredDry = async (store: Store, root: string, values: Values, io: IO, context: RunContext): Promise<number> => {
  const dir = Declared.directoryOf(root)
  const sections: string[] = []
  let failures = 0
  for (const declared of selectDeclared(store, values)) {
    sections.push(`; === source/${declared.name} (${declared.path})`)
    try {
      const ready = await Declared.prepare(declared, dir, context.fetchImpl)
      if (ready.mapping.prelude !== '') {
        sections.push(`; --- prelude\n\n${ready.mapping.prelude.trimEnd()}`)
      }
      ready.records.forEach((record, at) => {
        const instantiation = Template.instantiate(ready.mapping.templates, name => Template.fieldOf(record, name))
        if (instantiation.problems.length > 0) {
          failures += 1
          sections.push([`; --- record ${at + 1}`, ...instantiation.problems.map(problem => `; FAILED — ${problem}`)].join('\n'))
          return
        }
        sections.push(`; --- record ${at + 1}\n\n${instantiation.text.trimEnd()}`)
      })
    } catch (error) {
      failures += 1
      sections.push(`; FAILED — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  io.stdout.write(`${sections.join('\n\n')}\n`)
  return failures > 0 ? 1 : 0
}

const rollback = Symbol('cave-connect declared query rollback')

/** Federation-lite over every declared source (spec §23.3, §23.4): assemble inside a transaction, query, roll back. */
const declaredQuery = (store: Store, root: string, values: Values, io: IO): number => {
  let matches: undefined | readonly Match[]
  try {
    store.transaction(() => {
      Declared.assemble(store, root)
      matches = caveQuery(store, values.query!, { all: values.all === true, aliases: values.aliases === true })
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) {
      throw error
    }
  }
  printMatches(store, matches!, values.query!, values, io)
  return 0
}

const declaredWatch = async (store: Store, root: string, values: Values, io: IO, context: RunContext): Promise<number> => {
  const dir = Declared.directoryOf(root)
  const passOnce = async (): Promise<void> => {
    try {
      await declaredPass(store, root, values, io, context)
    } catch (error) {
      io.stderr.write(`cave connect watch pass: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  let running = false
  let queued = false
  let timer: unknown
  const fire = async (): Promise<void> => {
    if (running) {
      queued = true
      return
    }
    running = true
    do {
      queued = false
      await passOnce()
    } while (queued)
    running = false
  }
  const schedule: ScheduleLike = context.schedule ?? ((callback, delayMs) =>
    setTimeout(() => { void callback() }, delayMs))
  const cancelScheduled = context.cancelScheduled ?? (handle =>
    clearTimeout(handle as ReturnType<typeof setTimeout>))
  const trigger = (): void => {
    if (running) {
      queued = true
      return
    }
    if (timer !== undefined) cancelScheduled(timer)
    timer = schedule(async () => {
      timer = undefined
      await fire()
    }, 200)
  }
  // Every local declared file and mapping; URL sources only run on file changes.
  const targets = [...new Set(selectDeclared(store, values).flatMap(declared => [
    ...Source.isUrl(declared.path) ? [] : [Declared.resolvePath(declared.path, dir)],
    ...declared.map === undefined ? [] : [Declared.resolvePath(declared.map, dir)]
  ]))]
  if (targets.length === 0) {
    io.stderr.write('cave connect: nothing to watch — no declared local source\n')
    return 1
  }
  const watch: WatchLike = context.watch ?? ((path, listener) => watchFs(path, listener))
  const watchers = targets.map(target =>
    watch(dirname(target), (_event, filename) => {
      if (filename === null || filename.toString() === basename(target)) {
        trigger()
      }
    }))
  try {
    await passOnce()
    io.stdout.write('watching (ctrl-c to stop)\n')
    await waitForAbort(io.signal)
    return 0
  } finally {
    if (timer !== undefined) cancelScheduled(timer)
    for (const watcher of watchers) watcher.close()
  }
}

/**
 * `cave connect` without a source (spec §23.4): the store's declared
 * sources. `--list` prints them, `--dry-run` previews, `--query` overlays
 * them in a rolled-back transaction, `--watch` re-runs on file changes,
 * and the plain form runs one pass over each.
 */
const runDeclared = async (values: Values, io: IO, context: RunContext): Promise<number> => {
  const perSource = (['map', 'key', 'format', 'delimiter', 'table', 'sql', 'records'] as const)
    .filter(option => values[option] !== undefined)
  if (perSource.length > 0) {
    io.stderr.write(`cave connect: ${perSource.map(option => `--${option}`).join(', ')} describe a source argument — ` +
      'without one, declare them on the source/<name> entity (spec §23.4)\n')
    return 1
  }
  const db = values.db ?? defaultDbPath()
  try {
    if (values.list === true) {
      const store = openAt(db, { intent: 'read', assemble: Declared.assemble, ...registryOf(values) })
      try {
        const declared = selectDeclared(store, values)
        io.stdout.write(declared.length === 0 ? 'no declared sources\n' : `${declared.map(Declared.describe).join('\n')}\n`)
        return 0
      } finally {
        store.close()
      }
    }
    if (values['dry-run'] === true || values.query !== undefined) {
      // A text store already followed its sources on open; the overlay
      // then finds every record unchanged and adds nothing.
      const store = openAt(db, { intent: values.query === undefined ? 'read' : 'scratch', assemble: Declared.assemble, ...registryOf(values) })
      try {
        return values.query === undefined ?
          await declaredDry(store, db, values, io, context) :
          declaredQuery(store, db, values, io)
      } finally {
        store.close()
      }
    }
    const store = openAt(db, { intent: 'write', ...registryOf(values) })
    try {
      return values.watch === true ?
        await declaredWatch(store, db, values, io, context) :
        await declaredPass(store, db, values, io, context)
    } finally {
      store.close()
    }
  } catch (error) {
    io.stderr.write(`cave connect: ${error instanceof Error ? error.message : String(error)}\n`)
    return error instanceof LocateError ? 1 : 1
  }
}

export const runConnect = async (argv: readonly string[], context: RunContext = {}): Promise<number> => {
  const io: IO = {
    stdout: context.stdout ?? process.stdout,
    stderr: context.stderr ?? process.stderr,
    ...context.signal === undefined ? {} : { signal: context.signal }
  }
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      map: { type: 'string' },
      name: { type: 'string' },
      key: { type: 'string' },
      format: { type: 'string' },
      delimiter: { type: 'string' },
      table: { type: 'string' },
      sql: { type: 'string' },
      records: { type: 'string' },
      force: { type: 'boolean' },
      prune: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      watch: { type: 'boolean' },
      query: { type: 'string' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      aliases: { type: 'boolean' },
      'no-prelude': { type: 'boolean' },
      list: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  }) as { values: Values, positionals: string[] }
  if (values.help === true) {
    io.stdout.write(`${usage}\n`)
    return 0
  }
  if (positionals.length === 0) {
    return runDeclared(values, io, context)
  }
  const [source] = positionals
  if (source === undefined || positionals.length !== 1) {
    io.stderr.write(`cave connect: exactly one source is required\n\n${usage}\n`)
    return 1
  }
  if (values.list === true) {
    io.stderr.write('cave connect: --list takes no source\n')
    return 1
  }
  if (values.map === undefined) {
    io.stderr.write(`cave connect: --map <file> is required\n\n${usage}\n`)
    return 1
  }
  if (values.format !== undefined && !['csv', 'tsv', 'json', 'jsonl', 'sqlite'].includes(values.format)) {
    io.stderr.write(`cave connect: unknown format ${JSON.stringify(values.format)}\n`)
    return 1
  }
  if (values.delimiter !== undefined && values.delimiter.length !== 1) {
    io.stderr.write('cave connect: --delimiter must be a single character\n')
    return 1
  }
  if (values.watch === true && (values.query !== undefined || values['dry-run'] === true || Source.isUrl(source))) {
    io.stderr.write('cave connect: --watch takes a local file source and excludes --query/--dry-run\n')
    return 1
  }
  const name = values.name ?? Source.nameOf(source)
  try {
    if (values['dry-run'] === true) {
      return await runDry(source, values, io, context)
    }
    if (values.query !== undefined) {
      return await runQuery(source, values, name, io, context)
    }
    const store = openAt(values.db ?? defaultDbPath(), {
      intent: 'write',
      ...values['no-prelude'] === true ? { registry: Registry.empty } : {}
    })
    try {
      if (values.watch === true) {
        return await runWatch(store, source, values, name, io, context)
      }
      return await runPass(store, source, values, name, io, context)
    } finally {
      store.close()
    }
  } catch (error) {
    io.stderr.write(`cave connect: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
