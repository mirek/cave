/**
 * Declared sources (spec §23.4) — a `cave connect` invocation persisted
 * in-band as ordinary attribute claims on a `source/<name>` entity:
 *
 * ```cave
 * source/people HAS path: people.csv
 * source/people HAS map: people.map.cave
 * source/people HAS key: id
 * source/verbs HAS path: verbs.cave        ; a .cave file needs no map
 * ```
 *
 * The entity is the one §26.3 already uses for source policy, so
 * `source/people HAS reliability: 80%` applies to what the source yields:
 * declared sources stamp `@src:<name>/<key>` and keep their digests under
 * `source/<name>/<key>` (`declaredNaming`), the stamp and the entity
 * mirroring each other. Paths resolve against the store's directory — a
 * store and its sources travel together — never the working directory.
 *
 * `assemble` follows every declared source of a store synchronously, which
 * is what a CAVE text file used as `--db` needs (spec §13.7): the file and
 * what it declares are one store. `cave connect` with no source runs the
 * same declarations against a SQLite store, URLs included.
 */

import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { LocateError } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import * as Source from './source.ts'
import * as Template from './template.ts'
import { connect, declaredNaming } from './run.ts'
import type { Report } from './run.ts'

/** Entity prefix of source declarations and policy (spec §26.3). */
export const prefix = 'source/'

/** The declaration attributes, one per `cave connect` option. */
export const attributes = ['path', 'map', 'key', 'format', 'delimiter', 'table', 'sql', 'records'] as const

export type Attribute = typeof attributes[number]

export type Declared = {
  /** The entity name after `source/`. */
  readonly name: string
  /** File path (relative to the store's directory) or URL. */
  readonly path: string
  /** Mapping template path; a `.cave` source needs none. */
  readonly map?: string
  readonly key?: string
  /** `csv | tsv | json | jsonl | sqlite`, or `cave`; by extension when omitted. */
  readonly format?: string
  readonly delimiter?: string
  readonly table?: string
  readonly sql?: string
  readonly records?: string
}

export type t = Declared

const isAttribute = (name: string): name is Attribute =>
  (attributes as readonly string[]).includes(name)

/**
 * The store's declared sources: every `source/<name>` whose current belief
 * carries a positive `path`, with the other declaration attributes that
 * are current alongside it. Retracting the `path` (`… @ 0%`) removes the
 * source; superseding it moves it.
 */
export const declaredSources = (store: Store): Declared[] => {
  const byName = new Map<string, Partial<Record<Attribute, string>>>()
  for (const row of store.currentBeliefs()) {
    if (row.conf <= 0 || row.negated !== 0 || row.verb !== 'HAS' || row.attribute === null ||
      row.value_text === null || !row.subject.startsWith(prefix) || !isAttribute(row.attribute)) {
      continue
    }
    const name = row.subject.slice(prefix.length)
    if (name === '') {
      continue
    }
    const fields = byName.get(name) ?? {}
    fields[row.attribute] = row.value_text
    byName.set(name, fields)
  }
  return [...byName]
    .filter(([, fields]) => fields.path !== undefined)
    .map(([name, fields]) => ({ name, ...fields, path: fields.path! }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Where a declared path points: URLs as they are, files against the store's directory. */
export const resolvePath = (path: string, dir: string): string =>
  Source.isUrl(path) ? path : resolve(dir, path)

/** A mapping-free CAVE text source: the file is its own template (all prelude). */
export const isCave = (declared: Declared): boolean =>
  declared.format === 'cave' || (declared.format === undefined && extname(declared.path).toLowerCase() === '.cave')

/** The declaration as the equivalent `cave connect` invocation, for listings. */
export const describe = (declared: Declared): string => {
  const parts = [declared.path]
  for (const attribute of attributes) {
    if (attribute === 'path') continue
    const value = declared[attribute]
    if (value !== undefined) {
      parts.push(`--${attribute} ${/[\s"]/.test(value) ? JSON.stringify(value) : value}`)
    }
  }
  return `${declared.name}: ${parts.join(' ')}`
}

/** The store directory a root path implies: the file's directory, or the working directory for `:memory:`. */
export const directoryOf = (root: string): string =>
  root === ':memory:' || root === '' ? process.cwd() : dirname(resolve(root))

const sourceOptions = (declared: Declared, fetchImpl?: Source.FetchLike): Source.Options => ({
  ...declared.format === undefined || declared.format === 'cave' ? {} : { format: declared.format as Source.Format },
  ...declared.delimiter === undefined ? {} : { delimiter: declared.delimiter },
  ...declared.table === undefined ? {} : { table: declared.table },
  ...declared.sql === undefined ? {} : { sql: declared.sql },
  ...declared.records === undefined ? {} : { records: declared.records },
  ...fetchImpl === undefined ? {} : { fetchImpl }
})

const validate = (declared: Declared): void => {
  if (declared.format !== undefined && declared.format !== 'cave' && !Source.formats.includes(declared.format as Source.Format)) {
    throw new Error(`unknown format ${JSON.stringify(declared.format)} — one of ${[...Source.formats, 'cave'].join(', ')}`)
  }
  if (declared.delimiter !== undefined && declared.delimiter.length !== 1) {
    throw new Error('delimiter must be a single character')
  }
  if (!isCave(declared) && declared.map === undefined) {
    throw new Error('a map is required — declare `HAS map: <template.cave>` (a .cave source needs none)')
  }
}

const parseTemplate = (path: string, label: string): Template.Mapping => {
  const { mapping, problems } = Template.parse(readFileSync(path, 'utf8'))
  if (mapping === undefined) {
    throw new Error(`${label}:\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  }
  return mapping
}

/** A declared source loaded and ready for a pass. */
export type Prepared = {
  readonly declared: Declared
  readonly mapping: Template.Mapping
  readonly records: readonly Record<string, unknown>[]
  readonly spans?: NonNullable<Source.Loaded['spans']>
  /** The path or URL the records came from, as declared — portable in `@src:` spans. */
  readonly source?: string
  readonly cave: boolean
}

const prepared = (declared: Declared, dir: string, mapping: Template.Mapping, loaded: undefined | Source.Loaded): Prepared => ({
  declared,
  mapping,
  records: loaded?.records ?? [],
  ...loaded?.spans === undefined ? {} : { spans: loaded.spans },
  ...loaded === undefined ? {} : { source: declared.path },
  cave: loaded === undefined
})

const mappingOf = (declared: Declared, dir: string): { mapping: Template.Mapping, cave: boolean } => {
  validate(declared)
  if (isCave(declared)) {
    return { mapping: parseTemplate(resolvePath(declared.path, dir), 'the .cave source does not parse'), cave: true }
  }
  return { mapping: parseTemplate(resolvePath(declared.map!, dir), `mapping ${declared.map}`), cave: false }
}

/** Loads a declared source synchronously — local files only (`assemble`). */
export const prepareSync = (declared: Declared, dir: string): Prepared => {
  const { mapping, cave } = mappingOf(declared, dir)
  return prepared(declared, dir, mapping, cave ? undefined : Source.loadSync(resolvePath(declared.path, dir), sourceOptions(declared)))
}

/** Loads a declared source, URLs included (`cave connect`). */
export const prepare = async (declared: Declared, dir: string, fetchImpl?: Source.FetchLike): Promise<Prepared> => {
  const { mapping, cave } = mappingOf(declared, dir)
  return prepared(declared, dir, mapping, cave ? undefined : await Source.load(resolvePath(declared.path, dir), sourceOptions(declared, fetchImpl)))
}

export type RunOptions = {
  readonly force?: boolean
  readonly prune?: boolean
}

/** One pass of a prepared declared source under `declaredNaming` (spec §23.4). */
export const run = (store: Store, ready: Prepared, options: RunOptions = {}): Report =>
  connect(store, ready.mapping, ready.records, {
    name: ready.declared.name,
    naming: declaredNaming(ready.declared.name),
    // A .cave source is data that changes: claims it no longer yields retract.
    preludeLifecycle: ready.cave,
    ...ready.source === undefined ? {} : { source: ready.source },
    ...ready.spans === undefined ? {} : { spans: ready.spans },
    ...ready.declared.key === undefined ? {} : { key: ready.declared.key },
    force: options.force === true,
    prune: options.prune === true
  })

export type Assembled = {
  readonly declared: Declared
  readonly report: Report
}

/**
 * Follows every declared source of the store, the ones the followed
 * sources declare in turn included, until none is left. `root` is the
 * store's own file (or `:memory:`): paths resolve against its directory
 * and the root file itself is never re-read as a source, so a file that
 * declares itself, directly or through a cycle, is loaded exactly once.
 * Failures are `LocateError`s — the store is incomplete without its
 * sources, exactly as with a text file that does not parse.
 */
export const assemble = (store: Store, root: string, options: { readonly force?: boolean } = {}): Assembled[] => {
  const dir = directoryOf(root)
  const done = new Set<string>()
  const seen = new Set<string>(root === ':memory:' || root === '' ? [] : [resolve(root)])
  const assembled: Assembled[] = []
  for (;;) {
    const pending = declaredSources(store).filter(declared => !done.has(declared.name))
    if (pending.length === 0) {
      return assembled
    }
    for (const declared of pending) {
      done.add(declared.name)
      const path = resolvePath(declared.path, dir)
      if (seen.has(path)) {
        continue
      }
      seen.add(path)
      try {
        const report = run(store, prepareSync(declared, dir), { force: options.force === true })
        if (report.failures.length > 0) {
          throw new Error(report.failures.map(failure => `${failure.record}: ${failure.problems.join('; ')}`).join('\n'))
        }
        assembled.push({ declared, report })
      } catch (error) {
        throw new LocateError(`${prefix}${declared.name} (${declared.path}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
