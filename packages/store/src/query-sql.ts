/**
 * Composable SQL fragments for CAVE's shared read semantics.
 *
 * These functions return SQL only; callers own the outer SELECT, ordering,
 * and additional predicates. Transaction boundaries contain only validated
 * UUIDv7 text generated here, so their literal form remains safe inside
 * nested CTEs where positional-parameter ordering would be fragile.
 */

import { Time, Uuidv7 } from '@cavelang/core'
import * as Row from './row.ts'

export type TransactionBounds = {
  readonly lo: string
  readonly hi: string
}

export type AsOfBoundary = {
  readonly operator: '<' | '<='
  readonly tx: string
}

/** UUIDv7 interval `[lo, hi)` for a UTC period or one-second timestamp. */
export const transactionBounds = (text: string): TransactionBounds | undefined => {
  const boundary = Time.parseBoundary(text)
  if (boundary === undefined) return undefined
  return {
    lo: Uuidv7.at(boundary.start, 0, new Uint8Array(8)),
    hi: Uuidv7.at(boundary.end, 0, new Uint8Array(8)),
  }
}

/**
 * Inclusive transaction boundary: an exact UUID includes that append; a
 * period/timestamp includes its whole UTC period/second through an exclusive high
 * bound. Returns `undefined` for text that is neither form.
 */
export const asOfBoundary = (text: string): AsOfBoundary | undefined => {
  const id = text.toLowerCase()
  if (Uuidv7.is(id)) return { operator: '<=', tx: id }
  const bounds = transactionBounds(text)
  return bounds === undefined ? undefined : { operator: '<', tx: bounds.hi }
}

/** A validated as-of predicate, optionally qualified with a table alias. */
export const asOfCondition = (boundary: AsOfBoundary, column = 'tx'): string =>
  `${column} ${boundary.operator} '${boundary.tx}'`

/** Every claim, optionally bounded in transaction time. */
export const claims = (boundary?: AsOfBoundary): string =>
  boundary === undefined ? 'cave_claim' :
    `(SELECT * FROM cave_claim WHERE ${asOfCondition(boundary)})`

/**
 * Latest transaction per claim key. `source` selects the eligible
 * `cave_claim` rows (for example `claims(asOfBoundary(...))`); the outer row
 * comes from the base table so the source fragment appears only once.
 */
export const current = (source: string = claims()): string => `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM ${source} GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

/** Current, positive, entity-to-entity ALIAS edges in both directions. */
export const aliasEdges = (currentSql: string = current()): string => `alias_edge(a, b) AS (
  SELECT c.subject, c.object FROM (${currentSql}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
    AND ${Row.entityTermSql('c.subject')} AND ${Row.entityTermSql('c.object')}
  UNION
  SELECT c.object, c.subject FROM (${currentSql}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
    AND ${Row.entityTermSql('c.subject')} AND ${Row.entityTermSql('c.object')}
)`

/** Full transitive alias closure as ordered pairs. Requires `WITH RECURSIVE`. */
export const aliasPairs = (currentSql: string = current()): string => `${aliasEdges(currentSql)},
alias_pair(a, b) AS (
  SELECT a, b FROM alias_edge
  UNION
  SELECT p.a, e.b FROM alias_pair p JOIN alias_edge e ON e.a = p.b
)`

/** Seeded alias closure. Its first SELECT consumes one positional parameter. */
export const aliasSeed = (): string => `alias_closure(name) AS (
  SELECT ?
  UNION
  SELECT e.b FROM alias_closure s JOIN alias_edge e ON e.a = s.name
)`

/** Ready-to-prefix seeded closure; the caller supplies the seed parameter. */
export const aliasClosure = (currentSql: string = current()): string =>
  `WITH RECURSIVE ${aliasEdges(currentSql)}, ${aliasSeed()}\n`

/** SQL equality widened through an `alias_pair` CTE already in scope. */
export const aliasSame = (left: string, right: string): string =>
  `(${left} = ${right} OR EXISTS (SELECT 1 FROM alias_pair p WHERE p.a = ${left} AND p.b = ${right}))`
