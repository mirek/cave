/** Versioned, storage-independent claim and transaction records. */

import { Key, Uuidv7 } from '@cavelang/core'
import type { Claim } from '@cavelang/core'
import { emitClaim } from '@cavelang/canonical'
import type * as Provenance from './provenance.ts'
import type * as Row from './row.ts'

export const format = 'cave.claim' as const
export const version = 1 as const

/**
 * Public JSON representation. It deliberately contains semantic domain
 * values rather than `cave_claim` column names, so storage migrations do not
 * silently revise serialized APIs.
 */
export type V1 = {
  readonly format: typeof format
  readonly version: typeof version
  readonly id: string
  readonly tx: string
  readonly key: string
  /** Canonical primary-direction CAVE text. */
  readonly canonical: string
  /** Semantic claim; `claim.raw` retains the authored spelling. */
  readonly claim: Claim.t
  readonly provenance: Provenance.t
}

export type t = V1

export const of = (row: Row.t, claim: Claim.t, provenance: Provenance.t): t => ({
  format,
  version,
  id: row.id,
  tx: row.tx,
  key: row.claim_key,
  canonical: emitClaim(claim),
  claim,
  provenance,
})

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string')

/** Decode a persisted v1 fixture, rejecting unknown future formats loudly. */
export const decode = (input: string | unknown): t => {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!object(value) || value['format'] !== format) {
    throw new Error(`CAVE record: expected format ${JSON.stringify(format)}`)
  }
  if (value['version'] !== version) {
    throw new Error(`CAVE record: unsupported ${format} version ${JSON.stringify(value['version'])}`)
  }
  const claim = value['claim']
  const provenance = value['provenance']
  if (typeof value['id'] !== 'string' || typeof value['tx'] !== 'string' ||
      typeof value['key'] !== 'string' || typeof value['canonical'] !== 'string' ||
      !object(claim) || !object(claim['subject']) || !object(claim['payload']) ||
      typeof claim['verb'] !== 'string' || typeof claim['negated'] !== 'boolean' ||
      !strings(claim['contexts']) || !Array.isArray(claim['tags']) ||
      typeof claim['conf'] !== 'number' || typeof claim['importance'] !== 'boolean' ||
      typeof claim['raw'] !== 'string' || !object(provenance) ||
      !strings(provenance['actors']) || !strings(provenance['sources']) ||
      !strings(provenance['runs']) || !strings(provenance['domains'])) {
    throw new Error(`CAVE record: malformed ${format}/v${version}`)
  }
  const decoded = value as t
  if (!Uuidv7.is(decoded.id) || !Uuidv7.is(decoded.tx)) {
    throw new Error(`CAVE record: malformed ${format}/v${version} transaction identity`)
  }
  if (Key.of(decoded.claim) !== decoded.key || emitClaim(decoded.claim) !== decoded.canonical) {
    throw new Error(`CAVE record: malformed ${format}/v${version} semantic identity`)
  }
  return decoded
}

export const encode = (record: t, space?: number): string =>
  JSON.stringify(record, undefined, space)
