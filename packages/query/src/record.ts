/** Versioned JSON projection of CAVE-Q matches. */

import { Record as ClaimRecord } from '@cavelang/store/adapter'
import type { Store } from '@cavelang/store/adapter'
import type { Match, Options } from './compile.ts'
import { query } from './bounded.ts'
import { readSnapshot } from './read-snapshot.ts'
import { captureOptions } from './capture.ts'

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

export const of = (store: Store, match: Match): t => {
  const supplied = { bindings: match.bindings, row: match.row, rows: match.rows, at: match.at }
  requireBindingPrototype(supplied.bindings)
  const { bindings, row, rows, at } = structuredClone(supplied)
  validateMetadata(bindings, rows, at)
  if (rows !== undefined) for (const evidence of rows) {
    if (!object(evidence)) throw new Error(`CAVE query record: malformed ${format}/v${version} support`)
  }
  return {
    format,
    version,
    bindings,
    ...(row === undefined ? {} : { claim: store.recordOf(row) }),
    ...(rows === undefined ? {} : { support: rows.map(store.recordOf) }),
    ...(at === undefined ? {} : { at }),
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireBindingPrototype = (bindings: unknown): void => {
  if (object(bindings) && Object.getPrototypeOf(bindings) !== Object.prototype &&
      Object.getPrototypeOf(bindings) !== null) {
    throw new Error(`CAVE query record: malformed ${format}/v${version}`)
  }
}

const validateMetadata = (bindings: unknown, support: unknown, at: unknown): void => {
  if (!object(bindings) ||
      (Object.getPrototypeOf(bindings) !== Object.prototype && Object.getPrototypeOf(bindings) !== null) ||
      !Object.values(bindings).every(binding => typeof binding === 'string') ||
      (support !== undefined && !Array.isArray(support))) {
    throw new Error(`CAVE query record: malformed ${format}/v${version}`)
  }
  if (at !== undefined && (!object(at) || typeof at['num'] !== 'number' || !Number.isFinite(at['num']) ||
      typeof at['text'] !== 'string' || (at['unit'] !== undefined && typeof at['unit'] !== 'string'))) {
    throw new Error(`CAVE query record: malformed ${format}/v${version} interpolation`)
  }
}

/** Decode a persisted query-match record and every nested claim record. */
export const decode = (input: string | unknown): t => {
  let value: unknown = typeof input === 'string' ? JSON.parse(input) : object(input) ? { ...input } : input
  if (typeof input !== 'string' && object(value)) {
    // Check the supplied map before cloning normalizes custom prototypes.
    requireBindingPrototype(value['bindings'])
    value = structuredClone(value)
  }
  if (!object(value) || value['format'] !== format) {
    throw new Error(`CAVE query record: expected format ${JSON.stringify(format)}`)
  }
  if (value['version'] !== version) {
    throw new Error(`CAVE query record: unsupported ${format} version ${JSON.stringify(value['version'])}`)
  }
  validateMetadata(value['bindings'], value['support'], value['at'])
  const decoded = value as t
  return {
    ...decoded,
    ...(decoded.claim === undefined ? {} : { claim: ClaimRecord.decode(decoded.claim) }),
    ...(decoded.support === undefined ? {} : {
      support: Array.from({ length: decoded.support.length },
        (_, index) => ClaimRecord.decode(decoded.support![index]))
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
): t[] => {
  options = captureOptions(options)
  return readSnapshot(store, () => query(store, input, options).map(match => of(store, match)))
}
