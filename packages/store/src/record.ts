/** Versioned, storage-independent claim and transaction records. */

import { Key, Uuidv7, Value } from '@cavelang/core'
import type { Claim } from '@cavelang/core'
import { emitClaim } from '@cavelang/canonical'
import type * as Provenance from './provenance.ts'
import { parse as parseProvenance } from './provenance.ts'
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

const requireTransactionIdentity = (id: unknown, tx: unknown): void => {
  if (typeof id !== 'string' || !Uuidv7.is(id) || tx !== id) {
    throw new Error(`CAVE record: malformed ${format}/v${version} transaction identity`)
  }
}

export const of = (row: Row.t, claim: Claim.t, provenance: Provenance.t): t => {
  const id = row.id, tx = row.tx
  requireTransactionIdentity(id, tx)
  const key = row.claim_key
  const capturedClaim = structuredClone(claim)
  validateClaim(capturedClaim)
  if (Key.of(capturedClaim) !== key) {
    throw new Error(`CAVE record: malformed ${format}/v${version} semantic identity`)
  }
  const capturedProvenance = structuredClone(provenance)
  if (parseProvenance(capturedProvenance) === undefined) {
    throw new Error(`CAVE record: malformed ${format}/v${version} provenance`)
  }
  return {
    format,
    version,
    id,
    tx,
    key,
    canonical: emitClaim(capturedClaim),
    claim: capturedClaim,
    provenance: capturedProvenance,
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): value is readonly string[] => {
  if (!Array.isArray(value)) return false
  for (const entry of value) if (typeof entry !== 'string') return false
  return true
}

const term = (value: unknown): boolean => object(value) &&
  (value['kind'] === 'entity' || value['kind'] === 'text' || value['kind'] === 'code') &&
  typeof value['text'] === 'string'

const semanticValue = (value: unknown): boolean => {
  if (!object(value) || typeof value['kind'] !== 'string' ||
      !['number', 'trajectory', 'date', 'atom', 'text', 'code'].includes(value['kind']) ||
      typeof value['raw'] !== 'string' || typeof value['approx'] !== 'boolean' ||
      (value['unit'] !== undefined && typeof value['unit'] !== 'string')) return false
  for (const field of ['num', 'from', 'to']) {
    const number = value[field]
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number))) return false
  }
  const parsed = value['kind'] === 'text' ? Value.ofText(value['raw']) :
    value['kind'] === 'code' ? Value.ofCode(value['raw']) : Value.parse(value['raw'])
  return value['kind'] === parsed.kind && value['approx'] === parsed.approx &&
    value['num'] === parsed.num && value['from'] === parsed.from && value['to'] === parsed.to &&
    value['unit'] === parsed.unit
}

const payload = (value: Record<string, unknown>): boolean => {
  switch (value['kind']) {
    case 'none': return true
    case 'relation': return term(value['object'])
    case 'attribute': return typeof value['attribute'] === 'string' && semanticValue(value['value'])
    case 'metric': return semanticValue(value['value'])
    default: return false
  }
}

const validateClaim = (claim: unknown): void => {
  if (!object(claim) || !object(claim['subject']) || !object(claim['payload']) ||
      typeof claim['verb'] !== 'string' || typeof claim['negated'] !== 'boolean' ||
      !strings(claim['contexts']) || !Array.isArray(claim['tags']) ||
      typeof claim['conf'] !== 'number' || typeof claim['importance'] !== 'boolean' ||
      typeof claim['raw'] !== 'string') {
    throw new Error(`CAVE record: malformed ${format}/v${version}`)
  }
  for (const tag of claim['tags']) {
    if (!object(tag) || typeof tag['key'] !== 'string' ||
        (tag['value'] !== undefined && typeof tag['value'] !== 'string')) {
      throw new Error(`CAVE record: malformed ${format}/v${version} tag`)
    }
  }
  if (!term(claim['subject']) ||
      (claim['payload']['kind'] === 'relation' && !term(claim['payload']['object']))) {
    throw new Error(`CAVE record: malformed ${format}/v${version} term`)
  }
  if (!payload(claim['payload'])) {
    throw new Error(`CAVE record: malformed ${format}/v${version} payload`)
  }
  const sigmaLevel = claim['sigmaLevel']
  const delta = claim['delta']
  if ((delta !== undefined && (!semanticValue(delta) || !object(delta) ||
        typeof delta['num'] !== 'number' || delta['num'] <= 0)) ||
      (sigmaLevel !== undefined && (typeof sigmaLevel !== 'number' || !Number.isFinite(sigmaLevel) || sigmaLevel <= 0)) ||
      (claim['comment'] !== undefined && typeof claim['comment'] !== 'string')) {
    throw new Error(`CAVE record: malformed ${format}/v${version} metadata`)
  }
}

/** Decode a persisted v1 fixture, rejecting unknown future formats loudly. */
export const decode = (input: string | unknown): t => {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : structuredClone(input)
  if (!object(value) || value['format'] !== format) {
    throw new Error(`CAVE record: expected format ${JSON.stringify(format)}`)
  }
  if (value['version'] !== version) {
    throw new Error(`CAVE record: unsupported ${format} version ${JSON.stringify(value['version'])}`)
  }
  if (typeof value['id'] !== 'string' || typeof value['tx'] !== 'string' ||
      typeof value['key'] !== 'string' || typeof value['canonical'] !== 'string' ||
      parseProvenance(value['provenance']) === undefined) {
    throw new Error(`CAVE record: malformed ${format}/v${version}`)
  }
  validateClaim(value['claim'])
  const decoded = value as t
  requireTransactionIdentity(decoded.id, decoded.tx)
  if (Key.of(decoded.claim) !== decoded.key || emitClaim(decoded.claim) !== decoded.canonical) {
    throw new Error(`CAVE record: malformed ${format}/v${version} semantic identity`)
  }
  return decoded
}

export const encode = (record: t, space?: number): string =>
  JSON.stringify(record, undefined, space)
