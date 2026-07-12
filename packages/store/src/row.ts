/**
 * Row mapping — canonical claims ↔ `cave_claim` rows.
 *
 * Terms are stored *formatted* (delimiters preserved): entities as plain
 * text so §13.5 queries like `WHERE subject = 'auth/middleware'` work, code
 * literals as `` `<=` `` and text literals as `"…"` so a literal never
 * collides with a same-spelled entity. Values are stored as written
 * (`value_text`, incl. `~`, multiplier letters and delimiters) alongside
 * the normalized numeric value and unit (spec §13.4 step 9).
 */

import { Claim, Value } from '@cavelang/core'

/** A `cave_claim` row. */
export type Row = {
  readonly id: string
  readonly tx: string
  readonly subject: string
  readonly verb: string
  readonly negated: number
  readonly object: null | string
  readonly attribute: null | string
  readonly value_text: null | string
  readonly value_num: null | number
  readonly value_unit: null | string
  readonly value_approx: number
  readonly delta_text: null | string
  readonly delta_num: null | number
  readonly delta_unit: null | string
  readonly sigma_level: null | number
  readonly conf: number
  readonly importance: number
  readonly comment: null | string
  readonly raw_line: string
  readonly claim_key: string
}

export type t = Row

/** @returns term parsed back from its stored formatted text. */
export const parseTerm = (text: string): Claim.Term => {
  if (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) {
    return Claim.code(text.slice(1, -1))
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return Claim.text(text.slice(1, -1))
  }
  return Claim.entity(text)
}

/**
 * SQL predicate: `column` holds an entity-form term — not a `"…"` text or
 * `` `…` `` code literal encoding (the stored-text dual of `parseTerm`).
 * The §13.6 alias closure joins entity endpoints only: a literal names a
 * value, not an entity.
 */
export const entityTermSql = (column: string): string =>
  `NOT (length(${column}) >= 2 AND substr(${column}, 1, 1) = substr(${column}, -1, 1) AND substr(${column}, 1, 1) IN ('\`', '"'))`

/** @returns value parsed back from its stored as-written text. */
export const parseValue = (text: string): Value.t => {
  if (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) {
    return Value.ofCode(text.slice(1, -1))
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return Value.ofText(text.slice(1, -1))
  }
  return Value.parse(text)
}

/** Column values of a claim, in `cave_claim` insert order (id/tx excluded). */
export const toColumns = (claim: Claim.t): {
  subject: string
  verb: string
  negated: number
  object: null | string
  attribute: null | string
  valueText: null | string
  valueNum: null | number
  valueUnit: null | string
  valueApprox: number
  deltaText: null | string
  deltaNum: null | number
  deltaUnit: null | string
  sigmaLevel: number
  conf: number
  importance: number
  comment: null | string
  rawLine: string
  claimKey: string
} => {
  const payload = claim.payload
  const value =
    payload.kind === 'attribute' ? payload.value :
    payload.kind === 'metric' ? payload.value :
    undefined
  return {
    subject: Claim.formatTerm(claim.subject),
    verb: claim.verb,
    negated: claim.negated ? 1 : 0,
    object: payload.kind === 'relation' ? Claim.formatTerm(payload.object) : null,
    attribute: payload.kind === 'attribute' ? payload.attribute : null,
    valueText: value === undefined ? null : Value.format(value),
    valueNum: value?.num ?? null,
    valueUnit: value?.unit ?? null,
    valueApprox: value?.approx === true ? 1 : 0,
    deltaText: claim.delta === undefined ? null : Value.format(claim.delta),
    deltaNum: claim.delta?.num ?? null,
    deltaUnit: claim.delta?.unit ?? null,
    sigmaLevel: claim.sigmaLevel ?? 2,
    conf: claim.conf,
    importance: claim.importance ? 1 : 0,
    comment: claim.comment ?? null,
    rawLine: claim.raw,
    claimKey: '' // filled by the store with Key.of on the canonical claim
  }
}

/**
 * @returns canonical claim reconstructed from a row plus its side tables.
 * `sigmaLevel` collapses to `undefined` at the semantic default of 2.
 */
export const toClaim = (
  row: Row,
  contexts: readonly string[],
  tags: readonly { key: string, value: null | string }[]
): Claim.t =>
  Claim.of({
    subject: parseTerm(row.subject),
    verb: row.verb,
    negated: row.negated !== 0,
    payload:
      row.object !== null ? Claim.relation(parseTerm(row.object)) :
      row.attribute !== null && row.value_text !== null ? Claim.attribute(row.attribute, parseValue(row.value_text)) :
      row.value_text !== null ? Claim.metric(parseValue(row.value_text)) :
      Claim.none,
    contexts,
    tags: tags.map(tag => tag.value === null ? { key: tag.key } : { key: tag.key, value: tag.value }),
    conf: row.conf,
    importance: row.importance !== 0,
    ...row.delta_text !== null ? { delta: parseValue(row.delta_text) } : {},
    ...row.sigma_level !== null && row.sigma_level !== 2 ? { sigmaLevel: row.sigma_level } : {},
    ...row.comment !== null ? { comment: row.comment } : {},
    raw: row.raw_line
  })
