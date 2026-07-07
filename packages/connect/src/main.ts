/**
 * `cave connect` entry — argument parsing, pass orchestration (single,
 * `--watch`, `--query`), and report rendering around `run.ts`.
 */

import { existsSync, readFileSync, watch } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { defaultDbPath, open } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import * as Source from './source.ts'
import * as Template from './template.ts'
import { connect, federatedQuery } from './run.ts'
import type { Report } from './run.ts'

const usage = `cave connect — deterministic structured ingestion through a mapping template (spec §23)

Usage:
  cave connect [--db <path>] <source> --map <file> [options]

The source is a .csv/.tsv/.json/.jsonl/.ndjson file, a SQLite database
(with --table or --sql), or an http(s) URL serving JSON or CSV. The
mapping is an ordinary CAVE document whose ?field variables stand for
record fields; variable-free blocks append once per run, variable blocks
instantiate once per record — no LLM in the loop, same input, same claims.

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
                       when the database file does not exist
  --json               with --query: emit matches as JSON
  --all                with --query: match all beliefs, not just current ones
  --aliases            with --query: resolve entities through ALIAS claims
  --no-prelude         open the store without the standard §5.5 registry

Examples:
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
  help?: boolean
}

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

const sourceOptions = (values: Values): Source.Options => ({
  ...values.format === undefined ? {} : { format: values.format as Source.Format },
  ...values.delimiter === undefined ? {} : { delimiter: values.delimiter },
  ...values.table === undefined ? {} : { table: values.table },
  ...values.sql === undefined ? {} : { sql: values.sql },
  ...values.records === undefined ? {} : { records: values.records }
})

const runPass = async (store: Store, source: string, values: Values, name: string): Promise<number> => {
  const { mapping, problems } = loadMapping(values.map!)
  if (mapping === undefined) {
    process.stderr.write(`${problems.join('\n')}\n`)
    return 1
  }
  const loaded = await Source.load(source, sourceOptions(values))
  const report = connect(store, mapping, loaded.records, {
    name,
    ...values.key === undefined ? {} : { key: values.key },
    force: values.force === true,
    prune: values.prune === true
  })
  process.stdout.write(`${renderReport(report)}\n`)
  return report.failures.length > 0 ? 1 : 0
}

const runDry = async (source: string, values: Values): Promise<number> => {
  const { mapping, problems } = loadMapping(values.map!)
  if (mapping === undefined) {
    process.stderr.write(`${problems.join('\n')}\n`)
    return 1
  }
  const loaded = await Source.load(source, sourceOptions(values))
  const out: string[] = []
  if (mapping.prelude !== '') {
    out.push('; --- prelude', mapping.prelude.trimEnd())
  }
  let failures = 0
  loaded.records.forEach((record, at) => {
    const instantiation = Template.instantiate(mapping.templates, name => Template.fieldOf(record, name))
    out.push(`; --- record ${at + 1}`)
    if (instantiation.problems.length > 0) {
      failures += 1
      out.push(...instantiation.problems.map(problem => `; FAILED — ${problem}`))
      return
    }
    out.push(instantiation.text.trimEnd())
  })
  process.stdout.write(`${out.join('\n')}\n`)
  return failures > 0 ? 1 : 0
}

const runQuery = async (source: string, values: Values, name: string): Promise<number> => {
  const { mapping, problems } = loadMapping(values.map!)
  if (mapping === undefined) {
    process.stderr.write(`${problems.join('\n')}\n`)
    return 1
  }
  const loaded = await Source.load(source, sourceOptions(values))
  const db = values.db ?? defaultDbPath()
  const registry = values['no-prelude'] === true ? { registry: Registry.empty } : {}
  const store = existsSync(db) ? open(db, registry) : open(':memory:', registry)
  try {
    const { matches, report } = federatedQuery(
      store, mapping, loaded.records,
      { name, ...values.key === undefined ? {} : { key: values.key } },
      values.query!,
      { all: values.all === true, aliases: values.aliases === true }
    )
    if (report.failures.length > 0) {
      process.stderr.write(`${renderReport(report)}\n`)
    }
    if (values.json === true) {
      process.stdout.write(`${JSON.stringify(matches, undefined, 2)}\n`)
      return 0
    }
    if (matches.length === 0) {
      process.stdout.write('no matches\n')
      return 0
    }
    const lines = matches.map(match => {
      const bindings = Object.entries(match.bindings)
        .map(([variable, value]) => `?${variable} = ${value}`)
        .join('  ')
      return bindings !== '' ? bindings : match.row?.raw_line ?? values.query!
    })
    process.stdout.write(`${lines.join('\n')}\n`)
    return 0
  } finally {
    store.close()
  }
}

const runWatch = async (store: Store, source: string, values: Values, name: string): Promise<number> => {
  const passOnce = async (): Promise<void> => {
    try {
      await runPass(store, source, values, name)
    } catch (error) {
      process.stderr.write(`cave connect: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  await passOnce()
  let running = false
  let queued = false
  let timer: undefined | NodeJS.Timeout
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
  const trigger = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => { void fire() }, 200)
  }
  // Watch the parent directories — editors replace files on save, and a
  // watcher on the file itself dies with the old inode.
  const targets = [...new Set([resolve(source), resolve(values.map!)])]
  for (const target of targets) {
    watch(dirname(target), (_event, filename) => {
      if (filename === basename(target)) {
        trigger()
      }
    })
  }
  process.stdout.write('watching (ctrl-c to stop)\n')
  return new Promise<number>(() => {})
}

export const runConnect = async (argv: readonly string[]): Promise<number> => {
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
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  }) as { values: Values, positionals: string[] }
  if (values.help === true) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  const [source] = positionals
  if (source === undefined || positionals.length !== 1) {
    process.stderr.write(`cave connect: exactly one source is required\n\n${usage}\n`)
    return 1
  }
  if (values.map === undefined) {
    process.stderr.write(`cave connect: --map <file> is required\n\n${usage}\n`)
    return 1
  }
  if (values.format !== undefined && !['csv', 'tsv', 'json', 'jsonl', 'sqlite'].includes(values.format)) {
    process.stderr.write(`cave connect: unknown format ${JSON.stringify(values.format)}\n`)
    return 1
  }
  if (values.delimiter !== undefined && values.delimiter.length !== 1) {
    process.stderr.write('cave connect: --delimiter must be a single character\n')
    return 1
  }
  if (values.watch === true && (values.query !== undefined || values['dry-run'] === true || Source.isUrl(source))) {
    process.stderr.write('cave connect: --watch takes a local file source and excludes --query/--dry-run\n')
    return 1
  }
  const name = values.name ?? Source.nameOf(source)
  try {
    if (values['dry-run'] === true) {
      return await runDry(source, values)
    }
    if (values.query !== undefined) {
      return await runQuery(source, values, name)
    }
    const store = open(values.db ?? defaultDbPath(), values['no-prelude'] === true ? { registry: Registry.empty } : {})
    try {
      if (values.watch === true) {
        return await runWatch(store, source, values, name)
      }
      return await runPass(store, source, values, name)
    } finally {
      if (values.watch !== true) {
        store.close()
      }
    }
  } catch (error) {
    process.stderr.write(`cave connect: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
