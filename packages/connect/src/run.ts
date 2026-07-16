/**
 * The connect pass (spec §23.2) — instantiate the mapping per record, append
 * through the standard pipeline with record provenance, and keep re-runs
 * row-level incremental via per-record digest claims:
 *
 * ```cave
 * connect/people/42 HAS connect-digest: 93a01c626b3f @src:cave-connect
 * ```
 *
 * Every claim a record produces is auto-stamped `@src:connect/<name>/<key>`
 * (spec §9.5), so a changed record diffs against itself: current claims
 * still carrying the record's stamp but no longer produced by it are
 * retracted (`@ 0%`). `--prune` extends the diff to records that vanished
 * from the source. Explicit `run` provenance is the lifecycle identity;
 * the compatibility stamp is also applied when a template names its own
 * `@src:` context (both are kept).
 */

import { createHash } from 'node:crypto'
import { Claim, Key, SourceSpan, Value } from '@cavelang/core'
import type { LineSpan } from '@cavelang/core'
import type { Row, Store } from '@cavelang/store'
import { query as caveQuery } from '@cavelang/query'
import type { Match, Options as QueryOptions } from '@cavelang/query'
import * as Template from './template.ts'

export const digestAttribute = 'connect-digest'

export const provenanceContext = 'src:cave-connect'

/** First 12 hex chars of SHA-256, mirroring `@cavelang/ingest` (spec §9.5). */
export const digestOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 12)

/**
 * Claim key of a unit's digest claim. The value is excluded from keys
 * (spec §9.2), so the key is stable while the digest evolves.
 */
const digestKey = (subject: string): string =>
  Key.of(Claim.of({
    subject: Claim.entity(subject),
    verb: 'HAS',
    payload: Claim.attribute(digestAttribute, Value.parse('x')),
    contexts: [provenanceContext]
  }))

/** @returns `true` when the unit's current digest claim matches `digest`. */
export const isConnected = (store: Store, subject: string, digest: string): boolean => {
  const known = store.currentBelief(digestKey(subject))
  return known !== undefined && known.value_text === digest && known.conf > 0
}

const recordDigest = (store: Store, subject: string, digest: string): void => {
  store.ingest(`${subject} HAS ${digestAttribute}: ${digest} @${provenanceContext}`)
}

export type ConnectOptions = {
  /** Source name for record identity (spec §23.2): `connect/<name>/<key>`. */
  readonly name: string
  /** Record key field; unkeyed records are content-addressed by digest. */
  readonly key?: string
  /** Underlying file/URL identity attached to generated record claims. */
  readonly source?: string
  /** Record-aligned source line spans, when the source format provides them. */
  readonly spans?: readonly LineSpan[]
  /** Re-map records whose digest is unchanged. */
  readonly force?: boolean
  /** Retract claims of records that disappeared from the source. */
  readonly prune?: boolean
}

export type Failure = {
  /** Record position (1-based) or key, whichever identifies it better. */
  readonly record: string
  readonly problems: readonly string[]
}

export type Report = {
  /** Records in the source. */
  readonly records: number
  /** Records whose claims were (re-)appended. */
  readonly mapped: number
  /** Records skipped — digest unchanged (spec §23.2). */
  readonly skipped: number
  /** Claims appended (record claims + prelude, excluding digest bookkeeping). */
  readonly added: number
  /** Claims retracted because a changed record no longer yields them. */
  readonly retracted: number
  /** Records retracted by `--prune`. */
  readonly pruned: number
  /** Claim lines dropped over missing/empty fields. */
  readonly dropped: number
  readonly failures: readonly Failure[]
  /** Run-level notes (duplicate keys, prelude state). */
  readonly notes: readonly string[]
}

const recordFailure = Symbol('cave-connect record failure')

type RecordError = { readonly [recordFailure]: true, readonly problems: readonly string[] }

const failRecord = (problems: readonly string[]): never => {
  throw { [recordFailure]: true, problems } satisfies RecordError
}

const isRecordError = (error: unknown): error is RecordError =>
  typeof error === 'object' && error !== null && recordFailure in error

/**
 * Context-safe record key from a field value: runs of characters outside
 * `A-Za-z0-9._-` collapse to `-` (the key rides in an entity name and a
 * `@src:` context — reserved characters would change the line's meaning).
 * Casing is preserved; keys needing exact identity should be shaped in the
 * source.
 */
const keyOf = (value: unknown): undefined | string => {
  if (value === undefined || value === null) {
    return undefined
  }
  const text = String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return text === '' ? undefined : text
}

/** In-band vocabulary declarations are append-only and never lifecycle-retracted. */
const isDeclaration = (row: Row.t): boolean =>
  row.verb === 'REVERSE' || row.verb === 'RENAMED-TO' ||
  (row.verb === 'IS' && row.object === 'verb')

/**
 * Retracts current claims carrying `context` that were not (re-)appended in
 * this pass (spec §23.2). Contexts are part of claim identity, so every row
 * of a stamped series carries the stamp — the latest row per key among the
 * stamped rows *is* the series' current belief.
 */
const retractStale = (store: Store, run: string, keepIds: ReadonlySet<string>): number => {
  const latest = new Map<string, Row.t>()
  for (const row of store.byProvenance('run', run)) {
    const seen = latest.get(row.claim_key)
    if (seen === undefined || seen.tx < row.tx) {
      latest.set(row.claim_key, row)
    }
  }
  const stale = [...latest.values()]
    .filter(row => row.conf > 0 && !keepIds.has(row.id) && !isDeclaration(row))
  if (stale.length === 0) {
    return 0
  }
  store.insertResult({
    claims: stale.map(row => ({
      claim: { ...store.toClaim(row), conf: 0, raw: '', comment: 'retracted: no longer in source' },
      line: 0
    })),
    edges: [],
    registry: store.registry(),
    problems: []
  })
  return stale.length
}

/**
 * One connect pass: prelude (digest-skipped as a unit under
 * `connect/<name>`), then each record (digest-skipped under
 * `connect/<name>/<key>`), then optional pruning. Each unit appends inside
 * its own transaction — a failing record rolls back cleanly and never
 * poisons the rest of the run.
 */
export const connect = (
  store: Store,
  mapping: Template.Mapping,
  records: readonly Record<string, unknown>[],
  options: ConnectOptions
): Report => {
  const force = options.force === true
  // The name rides in entity names and @src: contexts, like record keys.
  const name = keyOf(options.name)
  if (name === undefined) {
    throw new Error(`cave connect: unusable source name ${JSON.stringify(options.name)} — pass --name`)
  }
  const failures: Failure[] = []
  const notes: string[] = []
  const seen = new Set<string>()
  let mapped = 0
  let skipped = 0
  let added = 0
  let retracted = 0
  let pruned = 0
  let dropped = 0

  const ingestUnit = (subject: string, text: string, digest: string, sourceContext?: string): void => {
    store.transaction(() => {
      const result = store.ingest(text, {
        source: subject,
        lifecycle: true,
        ...sourceContext === undefined ? {} : { contexts: [sourceContext] }
      })
      if (result.problems.length > 0) {
        failRecord(result.problems.map(problem => `line ${problem.line}: ${problem.message}`))
      }
      added += result.ids.length
      retracted += retractStale(store, subject, new Set(result.ids))
      recordDigest(store, subject, digest)
    })
  }

  if (mapping.prelude !== '') {
    const subject = `connect/${name}`
    const digest = digestOf(mapping.prelude)
    if (force || !isConnected(store, subject, digest)) {
      store.transaction(() => {
        const result = store.ingest(mapping.prelude, { source: subject })
        if (result.problems.length > 0) {
          // The prelude was linted with the mapping; a problem here aborts the run.
          const detail = result.problems.map(problem => `prelude line ${problem.line}: ${problem.message}`).join('\n')
          throw new Error(`cave connect: prelude failed to ingest\n${detail}`)
        }
        added += result.ids.length
        recordDigest(store, subject, digest)
      })
    } else {
      notes.push('prelude unchanged, skipped')
    }
  }

  records.forEach((record, at) => {
    const instantiation = Template.instantiate(mapping.templates, name => Template.fieldOf(record, name))
    dropped += instantiation.dropped
    const key = options.key === undefined ?
      digestOf(instantiation.text) :
      keyOf(Template.fieldOf(record, options.key))
    if (key === undefined) {
      failures.push({ record: `record ${at + 1}`, problems: [`--key field ${JSON.stringify(options.key)} is missing or empty`] })
      return
    }
    if (seen.has(key)) {
      notes.push(`duplicate record key ${JSON.stringify(key)} — last record wins`)
    }
    // Failed records still count as seen — pruning must never mistake a
    // transient failure for a record that left the source.
    seen.add(key)
    if (instantiation.problems.length > 0) {
      failures.push({ record: `record ${at + 1} (${key})`, problems: instantiation.problems })
      return
    }
    const subject = `connect/${name}/${key}`
    const sourceContext = options.source === undefined ? undefined :
      SourceSpan.context(options.source, options.spans?.[at])
    const digest = digestOf(`${instantiation.text}\0${sourceContext ?? ''}`)
    if (!force && isConnected(store, subject, digest)) {
      skipped += 1
      return
    }
    try {
      ingestUnit(subject, instantiation.text, digest, sourceContext)
      mapped += 1
    } catch (error) {
      if (!isRecordError(error)) {
        throw error
      }
      failures.push({ record: `record ${at + 1} (${key})`, problems: error.problems })
    }
  })

  if (options.prune === true) {
    const prefix = `connect/${name}/`
    const latest = new Map<string, Row.t>()
    for (const row of store.byContext(provenanceContext)) {
      const current = latest.get(row.claim_key)
      if (current === undefined || current.tx < row.tx) {
        latest.set(row.claim_key, row)
      }
    }
    for (const row of latest.values()) {
      if (row.conf <= 0 || !row.subject.startsWith(prefix) || seen.has(row.subject.slice(prefix.length))) {
        continue
      }
      store.transaction(() => {
        retracted += retractStale(store, row.subject, new Set())
        store.insertResult({
          claims: [{ claim: { ...store.toClaim(row), conf: 0, raw: '', comment: 'retracted: record left the source' }, line: 0 }],
          edges: [],
          registry: store.registry(),
          problems: []
        })
        pruned += 1
      })
    }
  }

  return { records: records.length, mapped, skipped, added, retracted, pruned, dropped, failures, notes }
}

export type FederatedOutcome = {
  readonly matches: readonly Match[]
  readonly report: Report
}

const rollback = Symbol('cave-connect query rollback')

/**
 * Federation-lite (spec §23.3): appends the mapped claims inside a
 * transaction, runs the CAVE-Q pattern over the union of store and source,
 * and rolls back — external data is consulted at query time, nothing
 * persists (digest bookkeeping included).
 */
export const federatedQuery = (
  store: Store,
  mapping: Template.Mapping,
  records: readonly Record<string, unknown>[],
  options: ConnectOptions,
  pattern: string,
  queryOptions: QueryOptions = {}
): FederatedOutcome => {
  let outcome: undefined | FederatedOutcome
  try {
    store.transaction(() => {
      const report = connect(store, mapping, records, { ...options, force: true, prune: false })
      outcome = { matches: caveQuery(store, pattern, queryOptions), report }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) {
      throw error
    }
  }
  return outcome!
}
