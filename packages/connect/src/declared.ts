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
import { LocateError, open } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import * as Source from './source.ts'
import * as Template from './template.ts'
import { connect, declaredNaming, hasDigest, provenanceContext } from './run.ts'
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

/**
 * The sources a CAVE text declares, read without touching any store: the
 * text is replayed into a scratch in-memory store. This is how an overlay
 * or a dry run discovers what a followed `.cave` source declares in turn,
 * before anything is appended.
 */
export const declaredIn = (text: string): Declared[] => {
  const scratch = open()
  try {
    scratch.ingest(text)
    return declaredSources(scratch)
  } finally {
    scratch.close()
  }
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

/** The declaration's content, for change detection between passes of one run. */
export const signature = (declared: Declared): string =>
  JSON.stringify(attributes.map(attribute => declared[attribute] ?? null))

/**
 * @returns `true` when the store has followed the source at all: its
 * prelude digest, or any current record digest under `source/<name>/`.
 * A record-only mapping (no variable-free block) writes no prelude digest.
 */
export const followed = (store: Store, name: string): boolean => {
  const naming = declaredNaming(name)
  if (hasDigest(store, naming.unit())) {
    return true
  }
  const latest = new Map<string, { conf: number, tx: string, subject: string }>()
  for (const row of store.byContext(provenanceContext)) {
    const seen = latest.get(row.claim_key)
    if (seen === undefined || seen.tx < row.tx) {
      latest.set(row.claim_key, row)
    }
  }
  return [...latest.values()].some(row => row.conf > 0 && row.subject.startsWith(naming.recordPrefix))
}

const validate = (declared: Declared): void => {
  if (declared.name.includes('/')) {
    // `source/team/admin` is also record `admin` of source `team`: the
    // digest entity and the stamp would collide (spec §23.4).
    throw new Error(`source names are one path segment — source/${declared.name} would collide with record ${JSON.stringify(declared.name.split('/').slice(1).join('/'))} of source/${declared.name.split('/')[0]}`)
  }
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

const parseTemplate = (text: string, label: string): Template.Mapping => {
  const { mapping, problems } = Template.parse(text)
  if (mapping === undefined) {
    throw new Error(`${label}:\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  }
  return mapping
}

const urlRefused = (source: string): Error =>
  new Error(`${source}: URL sources are followed by cave connect, not when assembling a text store`)

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

const caveLabel = 'the .cave source does not parse'

/** The mapping template: the declared map file, or the `.cave` source itself. */
const mappingSync = (declared: Declared, dir: string): { mapping: Template.Mapping, cave: boolean } => {
  validate(declared)
  if (isCave(declared)) {
    if (Source.isUrl(declared.path)) {
      throw urlRefused(declared.path)
    }
    return { mapping: parseTemplate(readFileSync(resolvePath(declared.path, dir), 'utf8'), caveLabel), cave: true }
  }
  return { mapping: parseTemplate(readFileSync(resolvePath(declared.map!, dir), 'utf8'), `mapping ${declared.map}`), cave: false }
}

const mappingAsync = async (declared: Declared, dir: string, fetchImpl?: Source.FetchLike): Promise<{ mapping: Template.Mapping, cave: boolean }> => {
  if (isCave(declared) && Source.isUrl(declared.path)) {
    validate(declared)
    const { text } = await Source.fetchText(declared.path, sourceOptions(declared, fetchImpl))
    return { mapping: parseTemplate(text, caveLabel), cave: true }
  }
  return mappingSync(declared, dir)
}

/** Loads a declared source synchronously — local files only (`assemble`); a URL is refused. */
export const prepareSync = (declared: Declared, dir: string): Prepared => {
  if (Source.isUrl(declared.path)) {
    throw urlRefused(declared.path)
  }
  const { mapping, cave } = mappingSync(declared, dir)
  return prepared(declared, dir, mapping, cave ? undefined : Source.loadSync(resolvePath(declared.path, dir), sourceOptions(declared)))
}

/** Loads a declared source, URLs included — a `.cave` URL is fetched and parsed as the template (`cave connect`). */
export const prepare = async (declared: Declared, dir: string, fetchImpl?: Source.FetchLike): Promise<Prepared> => {
  const { mapping, cave } = await mappingAsync(declared, dir, fetchImpl)
  return prepared(declared, dir, mapping, cave ? undefined : await Source.load(resolvePath(declared.path, dir), sourceOptions(declared, fetchImpl)))
}

export type DiscoverOptions = {
  readonly fetchImpl?: Source.FetchLike
  /** Only this declared source (and what it declares in turn). */
  readonly only?: string
  /**
   * Skip sources the store has already followed (they carry a digest claim)
   * — what a text store's overlay needs: assembly followed every local
   * source on open, so only the URL ones, and what they declare, are left.
   */
  readonly skipFollowed?: boolean
}

/**
 * Loads every declared source of the store without appending anything,
 * URLs included: what a followed `.cave` source declares in turn is read
 * from its text (`declaredIn`), so an overlay or a dry run sees the same
 * sources a real pass would follow. Declared order, nested ones after the
 * source that declared them.
 */
export const discover = async (store: Store, root: string, options: DiscoverOptions = {}): Promise<Prepared[]> => {
  const dir = directoryOf(root)
  const known = new Map(declaredSources(store).map(declared => [declared.name, declared]))
  if (options.only !== undefined) {
    const selected = known.get(options.only)
    if (selected === undefined) {
      throw new Error(`no declared source/${options.only}` +
        (known.size === 0 ? ' — the store declares no sources' : ` — declared: ${[...known.keys()].join(', ')}`))
    }
    known.clear()
    known.set(selected.name, selected)
  }
  const done = new Map<string, string>()
  const ready = new Map<string, Prepared>()
  let steps = 0
  // A followed .cave source may re-declare a source, its path or mapping
  // included: the later declaration wins, exactly as it would once
  // appended, so a source is (re)prepared until its declaration settles.
  for (;;) {
    const next = [...known.values()].find(declared => done.get(declared.name) !== signature(declared))
    if (next === undefined) {
      return [...ready.values()]
    }
    if (++steps > fixedPointSteps) {
      throw new Error(noFixedPoint)
    }
    done.set(next.name, signature(next))
    if (options.skipFollowed === true && followed(store, next.name)) {
      continue
    }
    const loaded = await prepare(next, dir, options.fetchImpl)
    ready.set(next.name, loaded)
    if (loaded.cave) {
      for (const nested of declaredIn(loaded.mapping.prelude)) {
        known.set(nested.name, nested)
      }
    }
  }
}

const fixedPointSteps = 1000

const noFixedPoint = `declared sources keep re-declaring one another — no fixed point after ${fixedPointSteps} steps`

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
 * declares itself, directly or through a cycle, is loaded exactly once —
 * one file under several names, with different mappings say, is followed
 * under each. URL sources are skipped, not errors: fetching cannot be
 * synchronous, and `cave connect` follows them. Other failures are
 * `LocateError`s — the store is incomplete without its sources, exactly
 * as with a text file that does not parse.
 */
export const assemble = (store: Store, root: string, options: { readonly force?: boolean } = {}): Assembled[] => {
  const dir = directoryOf(root)
  const done = new Map<string, string>()
  const self = root === ':memory:' || root === '' ? undefined : resolve(root)
  const assembled: Assembled[] = []
  let steps = 0
  // Declarations are re-read after every followed source: a .cave source
  // may declare a source the root does not, or re-declare one the root
  // does (a newer path, say) — the current declaration is what runs, and a
  // source whose declaration changed runs again, its earlier claims
  // retracted by the ordinary diff-on-change.
  for (;;) {
    const next = declaredSources(store).find(declared => done.get(declared.name) !== signature(declared))
    if (next === undefined) {
      return assembled
    }
    if (++steps > fixedPointSteps) {
      throw new LocateError(noFixedPoint)
    }
    done.set(next.name, signature(next))
    if (Source.isUrl(next.path) || resolvePath(next.path, dir) === self) {
      continue
    }
    try {
      const report = run(store, prepareSync(next, dir), { force: options.force === true })
      if (report.failures.length > 0) {
        throw new Error(report.failures.map(failure => `${failure.record}: ${failure.problems.join('; ')}`).join('\n'))
      }
      assembled.push({ declared: next, report })
    } catch (error) {
      throw new LocateError(`${prefix}${next.name} (${next.path}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
