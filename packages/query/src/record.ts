/** Versioned JSON projection of CAVE-Q matches. */

import { Record as ClaimRecord } from '@cavelang/store/adapter'
import type { Store } from '@cavelang/store/adapter'
import type { Match, Options } from './compile.ts'
import { query } from './bounded.ts'

export const format = 'cave.query-match' as const
export const version = 1 as const

export type t = {
  readonly format: typeof format
  readonly version: typeof version
  readonly bindings: Readonly<Record<string, string>>
  readonly claim?: ClaimRecord.t
  readonly support?: readonly ClaimRecord.t[]
  readonly at?: Match['at']
}

export const of = (store: Store, match: Match): t => ({
  format,
  version,
  bindings: match.bindings,
  ...(match.row === undefined ? {} : { claim: store.recordOf(match.row) }),
  ...(match.rows === undefined ? {} : { support: match.rows.map(store.recordOf) }),
  ...(match.at === undefined ? {} : { at: match.at }),
})

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Decode a persisted query-match record and every nested claim record. */
export const decode = (input: string | unknown): t => {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!object(value) || value['format'] !== format) {
    throw new Error(`CAVE query record: expected format ${JSON.stringify(format)}`)
  }
  if (value['version'] !== version) {
    throw new Error(`CAVE query record: unsupported ${format} version ${JSON.stringify(value['version'])}`)
  }
  if (!object(value['bindings']) ||
      !Object.values(value['bindings']).every(binding => typeof binding === 'string') ||
      (value['support'] !== undefined && !Array.isArray(value['support']))) {
    throw new Error(`CAVE query record: malformed ${format}/v${version}`)
  }
  const decoded = value as t
  return {
    ...decoded,
    ...(decoded.claim === undefined ? {} : { claim: ClaimRecord.decode(decoded.claim) }),
    ...(decoded.support === undefined ? {} : {
      support: decoded.support.map(record => ClaimRecord.decode(record))
    }),
  }
}

export const encode = (record: t, space?: number): string =>
  JSON.stringify(record, undefined, space)

/** Stable library/JSON query surface; raw `query()` remains storage-oriented. */
export const queryRecords = (
  store: Store,
  input: string,
  options: Options = {}
): t[] => query(store, input, options).map(match => of(store, match))
