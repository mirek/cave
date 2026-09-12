/** Snapshot-stable, bounded CAVE-Q pages. */

import { QuerySql } from '@cavelang/store/adapter'
import type { Store } from '@cavelang/store/adapter'
import { Uuidv7, Value } from '@cavelang/core'
import type { Options } from './compile.ts'
import { queryRecords } from './record.ts'
import { of as recordOf } from './record.ts'
import type { t as QueryRecord } from './record.ts'
import { window } from './bounded.ts'
import { readSnapshot } from './read-snapshot.ts'
import * as Pattern from './pattern.ts'

export const format = 'cave.query-page' as const
export const version = 1 as const
export const defaultLimit = 100
export const maxLimit = 1_000

export type PageOptions = Omit<Options, 'limit' | 'offset' | 'asOf' | 'support'> & {
  readonly asOf?: string
  readonly limit?: number
  readonly cursor?: string
}

export type Page = {
  readonly format: typeof format
  readonly version: typeof version
  readonly snapshot: null | string
  readonly matches: readonly QueryRecord[]
  readonly next?: string
}

type Revision = readonly [number, number, number, number]
type Cursor = { readonly v: 2, readonly fingerprint: string, readonly snapshot: string, readonly offset: number, readonly revision: Revision }

const fingerprint = (input: string, options: PageOptions, limit: number): string => {
  const text = JSON.stringify({
    input, limit,
    all: options.all === true,
    aliases: options.aliases === true,
    asOf: options.asOf ?? null,
    at: options.at ?? null,
    resolve: options.resolve === true,
  })
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

const encodeCursor = (cursor: Cursor): string => encodeURIComponent(JSON.stringify(cursor))

const decodeCursor = (text: string): Cursor => {
  try {
    const value = JSON.parse(decodeURIComponent(text)) as Partial<Cursor>
    if (value.v !== 2 || typeof value.fingerprint !== 'string' || typeof value.snapshot !== 'string' ||
        !Uuidv7.is(value.snapshot) || !Number.isSafeInteger(value.offset) || value.offset! < 0 ||
        !Array.isArray(value.revision) || value.revision.length !== 4 ||
        !value.revision.every(entry => Number.isSafeInteger(entry) && entry >= 0)) throw new Error('invalid')
    return value as Cursor
  } catch {
    throw new Error('CAVE-Q: invalid pagination cursor; restart from the first page')
  }
}

const snapshotOf = (store: Store, asOf: string | undefined): null | string => {
  const boundary = asOf === undefined ? undefined : QuerySql.asOfBoundary(asOf)
  if (asOf !== undefined && boundary === undefined) throw new Error(`CAVE-Q: cannot parse as-of boundary ${JSON.stringify(asOf)}`)
  const where = boundary === undefined ? '' : ` WHERE ${QuerySql.asOfCondition(boundary)}`
  const row = store.db.prepare(`SELECT MAX(tx) AS tx FROM cave_claim${where}`).get()
  return typeof row?.['tx'] === 'string' ? row['tx'] : null
}

/**
 * Detect changes to an append-only historical universe, including edges from
 * future parents attached to old rows. This deliberately covers all touching
 * lineage, beyond vocabulary alone. One statement reads both sets consistently;
 * wholly future rows and edges are irrelevant.
 * Local rowid tails supplement counts and keep the token constant-sized.
 */
const revisionOf = (store: Store, snapshot: string): Revision => {
  const value = store.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cave_claim WHERE tx <= ?) AS claims,
      (SELECT COALESCE(MAX(rowid), 0) FROM cave_claim WHERE tx <= ?) AS claim_tail,
      COUNT(*) AS edges, COALESCE(MAX(e.rowid), 0) AS edge_tail
    FROM cave_edge e
    WHERE EXISTS (SELECT 1 FROM cave_claim c WHERE c.id = e.parent_id AND c.tx <= ?)
       OR EXISTS (SELECT 1 FROM cave_claim c WHERE c.id = e.child_id AND c.tx <= ?)
  `).get(snapshot, snapshot, snapshot, snapshot) as { claims: number, claim_tail: number, edges: number, edge_tail: number }
  return [value.claims, value.claim_tail, value.edges, value.edge_tail]
}

const sameRevision = (a: Revision, b: Revision): boolean => a.every((value, i) => value === b[i])
const changedSnapshot = (): never => { throw new Error('CAVE-Q: pagination snapshot changed; restart from the first page') }

/** Read one SQL-bounded page frozen at the first page's transaction boundary. */
export const page = (store: Store, input: string, options: PageOptions = {}): Page => {
  // Read the declared fields once, including inherited/non-enumerable values.
  // Fingerprinting, snapshot selection and SQL must use the same options even
  // when the caller supplies accessors whose values can change between reads.
  options = {
    all: options.all,
    aliases: options.aliases,
    asOf: options.asOf,
    at: options.at,
    resolve: options.resolve,
    limit: options.limit,
    cursor: options.cursor,
  }
  const limit = options.limit === undefined ? defaultLimit : options.limit
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`CAVE-Q: page limit must be an integer from 1 to ${maxLimit}`)
  }
  const expected = fingerprint(input, options, limit)
  const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor)
  if (cursor !== undefined && cursor.fingerprint !== expected) {
    throw new Error('CAVE-Q: pagination cursor does not match this query and its options')
  }
  const snapshot = cursor?.snapshot ?? snapshotOf(store, options.asOf)
  const { cursor: _cursor, limit: _limit, ...queryOptions } = options
  const pattern = Pattern.parse(input)
  if (snapshot === null) {
    // Use ordinary compilation/validation even when no rows exist at the
    // requested boundary. A bounded read avoids a separate validation policy.
    window(store, pattern, { ...queryOptions, limit: 1 })
    return { format, version, snapshot, matches: [] }
  }
  const revision = revisionOf(store, snapshot)
  if (cursor !== undefined && !sameRevision(cursor.revision, revision)) changedSnapshot()
  const offset = cursor?.offset ?? 0
  const exactNumeric = pattern.payload.kind === 'attribute' && pattern.payload.value.kind === 'term' &&
    Value.parse(pattern.payload.value.text).kind === 'number'
  let matches: readonly QueryRecord[]
  let nextOffset: undefined | number
  if (options.at === undefined && !exactNumeric) {
    const found = queryRecords(store, input, {
      ...queryOptions,
      asOf: snapshot,
      limit: limit + 1,
      offset,
    })
    matches = found.slice(0, limit)
    if (found.length > limit) nextOffset = offset + limit
  } else {
    // Valid-time coverage and exact numeric approximation checks happen
    // after SQLite returns. Original row positions let a full candidate
    // batch stop at the last selected match without consuming later rows.
    matches = readSnapshot(store, () => {
      const found: QueryRecord[] = []
      let rawOffset = offset
      let scanned = 0
      const scanBudget = Math.max(defaultLimit, limit)
      let exhausted = false
      let unread = false
      while (found.length < limit && scanned < scanBudget) {
        const positions = new WeakMap<object, number>()
        const result = window(store, pattern, {
          ...queryOptions,
          asOf: snapshot,
          limit: scanBudget - scanned,
          offset: rawOffset,
        }, positions)
        if (result.scanned === 0) {
          exhausted = true
          break
        }
        const selected = result.matches.slice(0, limit - found.length)
        for (const match of selected) found.push(recordOf(store, match))
        // This path has physical rows: valid-time transitive queries are
        // rejected, and exact numeric patterns are attribute queries.
        const consumed = found.length === limit
          ? positions.get(selected.at(-1)!.row!)! + 1 : result.scanned
        rawOffset += consumed
        scanned += consumed
        unread = consumed < result.scanned
      }
      if (unread) nextOffset = rawOffset
      else if (!exhausted) {
        // A single bounded probe distinguishes a genuinely finished page from
        // one that filled its match/scan budget. It need not pass post-filters:
        // the continuation resumes before it and applies them normally.
        const probe = window(store, pattern, {
          ...queryOptions,
          asOf: snapshot,
          limit: 1,
          offset: rawOffset,
        })
        if (probe.scanned > 0) nextOffset = rawOffset
      }
      return found
    })
  }
  // No mixed result escapes if a peer or callback changes history while the
  // page's SQL windows and record projections are being evaluated.
  if (!sameRevision(revision, revisionOf(store, snapshot))) changedSnapshot()
  return {
    format,
    version,
    snapshot,
    matches,
    ...nextOffset === undefined ? {} : {
      next: encodeCursor({ v: 2, fingerprint: expected, snapshot, offset: nextOffset, revision })
    }
  }
}
