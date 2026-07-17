/** Snapshot-stable, bounded CAVE-Q pages. */

import { QuerySql } from '@cavelang/store/adapter'
import type { Store } from '@cavelang/store/adapter'
import { Value } from '@cavelang/core'
import type { Options } from './compile.ts'
import { queryRecords } from './record.ts'
import { of as recordOf } from './record.ts'
import type { t as QueryRecord } from './record.ts'
import { window } from './bounded.ts'
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

type Cursor = { readonly v: 1, readonly fingerprint: string, readonly snapshot: string, readonly offset: number }

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
    if (value.v !== 1 || typeof value.fingerprint !== 'string' || typeof value.snapshot !== 'string' ||
        !Number.isInteger(value.offset) || value.offset! < 0) throw new Error('invalid')
    return value as Cursor
  } catch {
    throw new Error('CAVE-Q: invalid pagination cursor')
  }
}

const snapshotOf = (store: Store, asOf: string | undefined): null | string => {
  const boundary = asOf === undefined ? undefined : QuerySql.asOfBoundary(asOf)
  if (asOf !== undefined && boundary === undefined) throw new Error(`CAVE-Q: cannot parse as-of boundary ${JSON.stringify(asOf)}`)
  const where = boundary === undefined ? '' : ` WHERE ${QuerySql.asOfCondition(boundary)}`
  const row = store.db.prepare(`SELECT MAX(tx) AS tx FROM cave_claim${where}`).get()
  return typeof row?.['tx'] === 'string' ? row['tx'] : null
}

/** Read one SQL-bounded page frozen at the first page's transaction boundary. */
export const page = (store: Store, input: string, options: PageOptions = {}): Page => {
  const limit = options.limit ?? defaultLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`CAVE-Q: page limit must be an integer from 1 to ${maxLimit}`)
  }
  const expected = fingerprint(input, options, limit)
  const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor)
  if (cursor !== undefined && cursor.fingerprint !== expected) {
    throw new Error('CAVE-Q: pagination cursor does not match this query and its options')
  }
  const snapshot = cursor?.snapshot ?? snapshotOf(store, options.asOf)
  if (snapshot === null) return { format, version, snapshot, matches: [] }
  const offset = cursor?.offset ?? 0
  const { cursor: _cursor, limit: _limit, ...queryOptions } = options
  const pattern = Pattern.parse(input)
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
    // after SQLite returns. Consume one SQL row at a time so a rejected row
    // advances the cursor while the first match of the next page does not.
    const found: QueryRecord[] = []
    let rawOffset = offset
    let scanned = 0
    const scanBudget = Math.max(defaultLimit, limit)
    let exhausted = false
    while (found.length < limit && scanned < scanBudget) {
      const result = window(store, pattern, {
        ...queryOptions,
        asOf: snapshot,
        limit: 1,
        offset: rawOffset,
      })
      if (result.scanned === 0) {
        exhausted = true
        break
      }
      if (result.matches.length > 0) {
        found.push(recordOf(store, result.matches[0]!))
      }
      rawOffset += result.scanned
      scanned += result.scanned
    }
    if (!exhausted) {
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
    matches = found
  }
  return {
    format,
    version,
    snapshot,
    matches,
    ...nextOffset === undefined ? {} : {
      next: encodeCursor({ v: 1, fingerprint: expected, snapshot, offset: nextOffset })
    }
  }
}
