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

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { LocateError, open } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import * as Source from './source.ts'
import * as Template from './template.ts'
import { connect, declaredNaming, digestAttribute, digestOf, hasDigest, provenanceContext } from './run.ts'
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

/** A source's declaration attributes as one text carries them — possibly partial, a delta over what the store knows. */
export type Delta = { readonly name: string, readonly fields: Partial<Record<Attribute, string>> }

/** Every `source/<name>` attribute claim current in the store, grouped by source — complete or not. */
export const deltasOf = (store: Store): Delta[] => {
  // Several belief series may speak about one attribute (the root file
  // and a followed source stamp differently): the newest current claim
  // wins, so what was asserted last is what runs.
  const byName = new Map<string, Partial<Record<Attribute, { value: string, tx: string }>>>()
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
    const seen = fields[row.attribute]
    if (seen === undefined || seen.tx < row.tx) {
      fields[row.attribute] = { value: row.value_text, tx: row.tx }
    }
    byName.set(name, fields)
  }
  return [...byName]
    .map(([name, fields]) => ({
      name,
      fields: Object.fromEntries(Object.entries(fields).map(([attribute, entry]) => [attribute, entry!.value])) as Partial<Record<Attribute, string>>
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A delta applied over a known declaration; a source without a `path` is not declared. */
export const merge = (known: undefined | Declared, delta: Delta): undefined | Declared => {
  const fields = { ...known === undefined ? {} : known, ...delta.fields, name: delta.name }
  return fields.path === undefined ? undefined : fields as Declared
}

/**
 * The store's declared sources: every `source/<name>` whose current belief
 * carries a positive `path`, with the other declaration attributes that
 * are current alongside it. Retracting the `path` (`… @ 0%`) removes the
 * source; superseding it moves it.
 */
export const declaredSources = (store: Store): Declared[] =>
  deltasOf(store).flatMap(delta => {
    const declared = merge(undefined, delta)
    return declared === undefined ? [] : [declared]
  })

/**
 * The sources a CAVE text declares, read without touching any store: the
 * text is replayed into a scratch in-memory store. This is how an overlay
 * or a dry run discovers what a followed `.cave` source declares in turn,
 * before anything is appended.
 */
export const declaredIn = (text: string): Declared[] =>
  declarationsIn(text).flatMap(delta => {
    const declared = merge(undefined, delta)
    return declared === undefined ? [] : [declared]
  })

/**
 * Every source declaration attribute a CAVE text carries, complete or
 * partial: a followed `.cave` source may change just the map or key of a
 * source the store already declares, and that delta must reach whatever
 * reads declarations without appending (`discover`, `--name`).
 */
export const declarationsIn = (text: string): Delta[] => {
  const scratch = open()
  try {
    scratch.ingest(text)
    return deltasOf(scratch)
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

/** Bookkeeping attribute recording which declaration a source was last run under. */
export const declarationAttribute = 'connect-declaration'

/** Digest of a declaration — what a run records, and what `followed` compares. */
export const declarationDigest = (declared: Declared): string =>
  digestOf(signature(declared))

/**
 * @returns `true` when the store followed the source under exactly this
 * declaration: every run records the declaration's digest on the source
 * entity (`source/<name> HAS connect-declaration: …`), so a source
 * re-declared since — a local file that became a URL, say — is not
 * followed, whatever digests its earlier version left behind.
 */
export const followed = (store: Store, declared: Declared): boolean => {
  const expected = declarationDigest(declared)
  return store.currentBeliefs().some(row =>
    row.conf > 0 && row.negated === 0 && row.subject === `${prefix}${declared.name}` &&
    row.attribute === declarationAttribute && row.value_text === expected)
}

/** A selection and everything it owns, transitively — what a named watch must watch. */
export const closure = (store: Store, names: readonly string[]): Declared[] => {
  const owners = ownership(store)
  const selected = new Set(names)
  const queue = [...names]
  for (let owner = queue.shift(); owner !== undefined; owner = queue.shift()) {
    for (const name of owners.get(owner) ?? []) {
      if (!selected.has(name)) {
        selected.add(name)
        queue.push(name)
      }
    }
  }
  return declaredSources(store).filter(declared => selected.has(declared.name))
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
  /** Simulate a `--force` pass: every followed text is applied, digest or not. */
  readonly force?: boolean
  /** Simulate a `--prune` pass: records that left a source retract, declarations they made included. */
  readonly prune?: boolean
  /**
   * Skip sources the store has already followed (they carry a digest claim)
   * — what a text store's overlay needs: assembly followed every local
   * source on open, so only the URL ones, and what they declare, are left.
   */
  readonly skipFollowed?: boolean
}

/** How often one source may be re-declared within a pass before it is a cycle, not convergence. */
const redeclarationLimit = 20

const noFixedPoint = (name: string): string =>
  `source/${name} keeps being re-declared — no fixed point after ${redeclarationLimit} re-declarations`

/** Counts a source's declaration versions within one pass and refuses a cycle. */
export const versionCounter = (): (name: string) => void => {
  const versions = new Map<string, number>()
  return name => {
    const count = (versions.get(name) ?? 0) + 1
    versions.set(name, count)
    if (count > redeclarationLimit) {
      throw new Error(noFixedPoint(name))
    }
  }
}

/**
 * Loads every declared source of the store without leaving anything in
 * it, URLs included, and returns the exact sequence a pass would run —
 * a source re-declared along the way appears again, later. Nothing is
 * simulated: the sources run through the real pass against a private
 * snapshot of the store, each exactly once as it is discovered, and the
 * declarations are read from that copy as they stand after each run; so
 * precedence, deltas, retractions, and what an unchanged source skips
 * come out exactly as in the pass, and the real database holds no lock
 * while sources load. `force` replays every text (the overlay applies
 * everything it loads); `prune` retracts what vanished records declared.
 */
export const discover = async (origin: Store, root: string, options: DiscoverOptions = {}): Promise<Prepared[]> => {
  const dir = directoryOf(root)
  const baseline = signatures(declaredSources(origin))
  if (options.only !== undefined && !baseline.has(options.only)) {
    throw new Error(`no declared source/${options.only}` +
      (baseline.size === 0 ? ' — the store declares no sources' : ` — declared: ${[...baseline.keys()].join(', ')}`))
  }
  // The selection starts as the named source and everything it already
  // owns, so a parent that fails to load does not hide its descendants.
  const allowed = options.only === undefined ? undefined : new Set(closure(origin, [options.only]).map(declared => declared.name))
  const sequence: Prepared[] = []
  const done = new Map<string, string>()
  const version = versionCounter()
  let seen = baseline
  // Everything runs against a private snapshot of the store: the real
  // database holds no lock while sources load (a URL may take a minute),
  // and the copy is simply discarded.
  const { store, dispose } = snapshot(origin)
  try {
    for (;;) {
      const current = declaredSources(store)
      // A selection grows by what the replayed sources changed — added,
      // re-declared, or retracted declarations alike; what they own is
      // added as each one runs, below.
      if (allowed !== undefined) {
        for (const name of changedNames(seen, signatures(current))) allowed.add(name)
      }
      seen = signatures(current)
      const next = current.find(declared => (allowed === undefined || allowed.has(declared.name)) && done.get(declared.name) !== signature(declared))
      if (next === undefined) {
        return sequence
      }
      version(next.name)
      done.set(next.name, signature(next))
      // The name rule holds for every declaration, skipped ones included.
      validate(next)
      // Followed means followed under this very declaration: a version a
      // replayed source produced, or one assembly replaced, is new. A source
      // already loaded in this discovery is never skipped again — a
      // declaration that went away and came back must run again, after the
      // intervening version.
      if (options.skipFollowed === true && !sequence.some(ready => ready.declared.name === next.name) && followed(store, next)) {
        continue
      }
      const loaded = await prepare(next, dir, options.fetchImpl)
      sequence.push(loaded)
      run(store, loaded, { force: options.force === true, prune: options.prune === true })
      if (allowed !== undefined) {
        // Ownership only changes when a source runs: one pass for this one.
        for (const name of ownedDeclarations(store, loaded.declared.name)) allowed.add(name)
      }
    }
  } finally {
    dispose()
  }
}

/** A private, disposable copy of a store — an exact snapshot in a temporary file, opened writable. */
const snapshot = (origin: Store): { store: Store, dispose: () => void } => {
  const capability = origin.adapter.capabilities.backup
  if (capability === undefined) {
    throw new Error(`cave connect: SQLite adapter ${JSON.stringify(origin.adapter.name)} cannot snapshot a store for discovery`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'cave-discover-'))
  const path = join(dir, 'snapshot.db')
  capability.write(origin.db, path)
  const store = open(path, { registry: origin.baseRegistry(), access: 'no-migrate' })
  return {
    store,
    dispose: () => {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Names of the sources whose current declaration claims a followed source
 * owns — appended under its run — so a selection keeps a source's
 * descendants even when its run changed nothing.
 */
export const ownedDeclarations = (store: Store, owner: string): string[] =>
  [...ownership(store).get(owner) ?? []].sort()

/**
 * Who owns which declarations, in one pass over the current declaration
 * rows: the prelude runs as `<owner>`, a record as `<owner>/<key>`, so a
 * mapping that emits declarations per record owns them through its
 * records.
 */
export const ownership = (store: Store): Map<string, Set<string>> => {
  const owners = new Map<string, Set<string>>()
  for (const row of store.currentBeliefs()) {
    if (row.conf <= 0 || row.negated !== 0 || row.verb !== 'HAS' || row.attribute === null ||
      !row.subject.startsWith(prefix) || !isAttribute(row.attribute)) {
      continue
    }
    for (const run of store.provenanceOf(row)?.runs ?? []) {
      const owner = run.split('/')[0]!
      const owned = owners.get(owner) ?? new Set<string>()
      owned.add(row.subject.slice(prefix.length))
      owners.set(owner, owned)
    }
  }
  return owners
}

/** Declaration signatures by name. */
export const signatures = (declared: readonly Declared[]): Map<string, string> =>
  new Map(declared.map(entry => [entry.name, signature(entry)]))

/** Names whose declaration was added, changed, or removed between two snapshots. */
export const changedNames = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] =>
  [...new Set([...before.keys(), ...after.keys()])].filter(name => before.get(name) !== after.get(name))

export type RunOptions = {
  readonly force?: boolean
  readonly prune?: boolean
}

/** The digest of the declaration a source was last run under, if any. */
export const recordedDeclaration = (store: Store, name: string): undefined | string =>
  store.currentBeliefs().find(row =>
    row.conf > 0 && row.negated === 0 && row.subject === `${prefix}${name}` && row.attribute === declarationAttribute)?.value_text ?? undefined

/** @returns `true` when any digest bookkeeping exists for the source — its prelude's or a record's. */
const hasAnyDigest = (store: Store, name: string): boolean => {
  const naming = declaredNaming(name)
  if (hasDigest(store, naming.unit())) {
    return true
  }
  const latest = new Map<string, { conf: number, tx: string, subject: string }>()
  for (const row of store.byContext(provenanceContext)) {
    if (row.attribute !== digestAttribute || row.negated !== 0) continue
    const seen = latest.get(row.claim_key)
    if (seen === undefined || seen.tx < row.tx) latest.set(row.claim_key, row)
  }
  return [...latest.values()].some(row => row.conf > 0 && row.subject.startsWith(naming.recordPrefix))
}

/**
 * One pass of a prepared declared source under `declaredNaming` (spec
 * §23.4), recording the declaration it ran under. A source whose
 * declaration changed since its last run — another path, key, query, or
 * record selector — prunes as it runs: records the new version does not
 * produce are retired, since the per-record diff never visits them. A
 * source that was followed without a recorded declaration (digests, no
 * marker) is treated as changed, conservatively.
 */
export const run = (store: Store, ready: Prepared, options: RunOptions = {}): Report => {
  const previous = recordedDeclaration(store, ready.declared.name)
  const transition = previous === undefined ?
    hasAnyDigest(store, ready.declared.name) :
    previous !== declarationDigest(ready.declared)
  const report = connect(store, ready.mapping, ready.records, {
    name: ready.declared.name,
    naming: declaredNaming(ready.declared.name),
    // A .cave source is data that changes: claims it no longer yields retract.
    preludeLifecycle: ready.cave,
    ...ready.source === undefined ? {} : { source: ready.source },
    ...ready.spans === undefined ? {} : { spans: ready.spans },
    ...ready.declared.key === undefined ? {} : { key: ready.declared.key },
    force: options.force === true,
    prune: options.prune === true || transition
  })
  if (!followed(store, ready.declared)) {
    store.ingest(`${prefix}${ready.declared.name} HAS ${declarationAttribute}: ${declarationDigest(ready.declared)} @${provenanceContext}`)
  }
  return report
}

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
  const version = versionCounter()
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
    try {
      version(next.name)
    } catch (error) {
      throw new LocateError(error instanceof Error ? error.message : String(error))
    }
    done.set(next.name, signature(next))
    try {
      // The name rule holds for every declaration, skipped ones included.
      validate(next)
    } catch (error) {
      throw new LocateError(`${prefix}${next.name} (${next.path}): ${error instanceof Error ? error.message : String(error)}`)
    }
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
