/**
 * Claim keys (spec §9.2).
 *
 * The claim key identifies the *fact* whose belief evolves over time: the
 * latest transaction with the same key is the current belief (spec §9.1).
 * Keys are computed on the canonical (primary-direction) form, so a forward
 * claim and its inverse reading share one key — one fact, two names
 * (spec §5.5).
 *
 * Key components:
 *
 * - relational claim:      subject, verb, object, negated, context set
 * - attribute/value claim: subject, verb, attribute, negated, context set
 * - metric claim:          subject, verb, negated, context set
 *
 * The value is *excluded* — it may change over time while the key stays
 * about the same property. Confidence, tags, uncertainty, importance and
 * comments are metadata and never key components. Contexts participate as a
 * sorted, deduplicated set, which is what lets competing hypotheses
 * differentiate by `@hyp:` context (spec §10.3).
 *
 * The key format is a JSON array — deterministic, collision-free and
 * readable in the database.
 */

import type * as Claim from './claim.ts'

const termPart = (term: Claim.Term): string =>
  term.kind === 'entity' ? term.text : `${term.kind}:${term.text}`

const payloadPart = (payload: Claim.Payload): string => {
  switch (payload.kind) {
    case 'relation':
      return `r:${termPart(payload.object)}`
    case 'attribute':
      return `a:${payload.attribute}`
    case 'metric':
      return 'm'
    case 'none':
      return 'n'
  }
}

/** @returns stable claim key of a canonical claim. */
export const of = (claim: Claim.t): string =>
  JSON.stringify([
    termPart(claim.subject),
    claim.verb,
    claim.negated ? 1 : 0,
    payloadPart(claim.payload),
    [...new Set(claim.contexts)].sort()
  ])
