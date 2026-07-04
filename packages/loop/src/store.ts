/**
 * The store contract the language guarantees the agent (spec §18), plus a
 * dependency-free in-memory implementation.
 *
 * The contract: forward reads via the subject index, named inverse reads
 * via the object index plus `inverse_of()`, current-belief resolution via
 * claim keys, and topic expansion via `CONTAINS` in both directions.
 * `@cavelang/store`'s SQLite store satisfies the same shape; the in-memory
 * store keeps the loop testable without I/O.
 */

import { Claim, Key } from '@cavelang/core'
import { Registry, canonicalizeText, standardRegistry } from '@cavelang/canonical'

/** A traversable edge, read from one endpoint. */
export type Edge = {
  readonly from: string
  readonly to: string
  /** Canonical (primary) verb of the underlying fact. */
  readonly verb: string
  /**
   * Relation name in the direction of traversal: the verb itself going
   * forward, the declared inverse going backward — `undefined` when no
   * inverse is declared (the un-named fallback, spec §5.5).
   */
  readonly rel?: string
  readonly conf: number
  readonly claim: Claim.t
}

/** Injectable store interface for the reconstruction loop (spec §18). */
export type CaveStore = {
  /** Current relational facts with `entity` as subject. */
  forward(entity: string): Edge[]
  /** Current relational facts with `entity` as object, inverse-named. */
  reverse(entity: string): Edge[]
  /** Current claims about `entity` (either endpoint, any payload). */
  claimsAbout(entity: string): Claim.t[]
  /** Members of a topic — forward `CONTAINS` (spec §11.2). */
  expandTopic(topic: string): string[]
  /** Containers of an entity — inverse `CONTAINS` (spec §11.2). */
  topicsOf(entity: string): string[]
}

const subjectText = (claim: Claim.t): string =>
  Claim.formatTerm(claim.subject)

const objectText = (claim: Claim.t): undefined | string =>
  claim.payload.kind === 'relation' ? Claim.formatTerm(claim.payload.object) : undefined

/**
 * In-memory `CaveStore` over canonical claims. Claim order is transaction
 * order — for duplicated claim keys the last one wins (current belief,
 * spec §9.1). Negated and retracted (`@ 0%`) facts are excluded from
 * traversal, matching `@cavelang/store` defaults.
 */
export const memoryStore = (claims: readonly Claim.t[], registry: Registry.t = standardRegistry): CaveStore => {
  const current = new Map<string, Claim.t>()
  for (const claim of claims) {
    current.set(Key.of(claim), claim)
  }
  const bySubject = new Map<string, Claim.t[]>()
  const byObject = new Map<string, Claim.t[]>()
  const push = (map: Map<string, Claim.t[]>, key: string, claim: Claim.t): void => {
    const existing = map.get(key)
    if (existing === undefined) {
      map.set(key, [claim])
    } else {
      existing.push(claim)
    }
  }
  for (const claim of current.values()) {
    push(bySubject, subjectText(claim), claim)
    const object = objectText(claim)
    if (object !== undefined) {
      push(byObject, object, claim)
    }
  }
  const traversable = (claim: Claim.t): boolean =>
    !claim.negated && claim.conf > 0

  return {
    forward(entity) {
      return (bySubject.get(entity) ?? [])
        .filter(claim => traversable(claim) && objectText(claim) !== undefined)
        .map(claim => ({
          from: entity,
          to: objectText(claim)!,
          verb: claim.verb,
          rel: claim.verb,
          conf: claim.conf,
          claim
        }))
    },
    reverse(entity) {
      return (byObject.get(entity) ?? [])
        .filter(traversable)
        .map(claim => {
          const rel = Registry.inverseOf(registry, claim.verb)
          return {
            from: entity,
            to: subjectText(claim),
            verb: claim.verb,
            ...rel === undefined ? {} : { rel },
            conf: claim.conf,
            claim
          }
        })
    },
    claimsAbout(entity) {
      const about = [
        ...bySubject.get(entity) ?? [],
        ...(byObject.get(entity) ?? []).filter(claim => subjectText(claim) !== entity)
      ]
      return about
    },
    expandTopic(topic) {
      return (bySubject.get(topic) ?? [])
        .filter(claim => traversable(claim) && claim.verb === 'CONTAINS')
        .flatMap(claim => {
          const object = objectText(claim)
          return object === undefined ? [] : [object]
        })
    },
    topicsOf(entity) {
      return (byObject.get(entity) ?? [])
        .filter(claim => traversable(claim) && claim.verb === 'CONTAINS')
        .map(subjectText)
    }
  }
}

/** Convenience: in-memory store straight from CAVE text. */
export const memoryStoreOfText = (text: string, registry: Registry.t = standardRegistry): CaveStore => {
  const result = canonicalizeText(text, registry)
  return memoryStore(result.claims.map(entry => entry.claim), result.registry)
}
