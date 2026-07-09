/**
 * Claim scoring — the produced extraction against the golden (roadmap
 * item 9).
 *
 * Both sides run through the same pipeline: parse → canonicalize → strip
 * actor stamps → re-key → keep the last claim per key. Actor stamps are
 * the `@src:` contexts appended by the engine itself under spec §9.5
 * (`@src:cli`, `@src:agent/<name>`, `@src:ingest/<digest>`) — which actor
 * happened to write a claim must not shift its key away from the golden's,
 * while *content* sources the fixture author wrote (`@src:maria`,
 * `@src:notes.md`) stay part of claim identity: the golden decides which
 * contexts extraction is expected to produce.
 *
 * A golden claim *matches* a produced claim when their normalized keys are
 * equal and their values agree — numerically within a relative tolerance
 * (units must agree; `~` approximation is metadata), textually otherwise.
 * Relation and existence claims carry their object in the key, so the key
 * alone decides. Confidence, tags, `+/-` uncertainty, importance and
 * comments are metadata and never scored; a key that matches with a
 * disagreeing value is counted separately (`valueOff`) — the right fact,
 * the wrong value.
 */

import { Claim, Key, Value } from '@cavelang/core'
import { canonicalizeText, emitClaim, standardRegistry } from '@cavelang/canonical'
import type { Registry } from '@cavelang/canonical'
import { Files } from '@cavelang/ingest'
import type { Store } from '@cavelang/store'

/** Actor-stamp sources appended by the engine (spec §9.5), ignored in scoring. */
const actorStampRe = /^src:(?:cli$|agent\/|ingest\/)/

/** @returns the claim without engine-appended actor stamps. */
export const normalize = (claim: Claim.t): Claim.t => {
  const contexts = claim.contexts.filter(context => !actorStampRe.test(context))
  return contexts.length === claim.contexts.length ? claim : { ...claim, contexts }
}

/** @returns the claim key of the normalized claim. */
export const keyOf = (claim: Claim.t): string =>
  Key.of(normalize(claim))

/** One fact under a normalized key — the unit of comparison. */
export type Fact = {
  readonly key: string
  readonly claim: Claim.t
}

/**
 * @returns one fact per normalized key, the last claim winning — the same
 * latest-wins semantics the store gives a belief series (spec §9.1).
 */
export const factsOf = (claims: readonly Claim.t[]): Fact[] => {
  const byKey = new Map<string, Claim.t>()
  for (const claim of claims) {
    byKey.set(keyOf(claim), claim)
  }
  return [...byKey].map(([key, claim]) => ({ key, claim }))
}

/** Parses a golden document into facts; parse problems are fixture problems. */
export const goldenFacts = (
  text: string,
  registry: Registry.t = standardRegistry
): { facts: readonly Fact[], problems: readonly string[] } => {
  const result = canonicalizeText(text, registry)
  return {
    facts: factsOf(result.claims.map(entry => entry.claim)),
    problems: result.problems.map(problem => `golden line ${problem.line}: ${problem.message}`)
  }
}

/**
 * @returns the facts an extraction run produced — the store's current
 * beliefs minus the orchestrator's own `ingest-digest` provenance claims
 * (`@cavelang/ingest` bookkeeping, not extracted knowledge).
 */
export const producedFacts = (store: Store): Fact[] =>
  factsOf(
    store.currentBeliefs()
      .filter(row => row.attribute !== Files.digestAttribute)
      .map(row => store.toClaim(row))
  )

const valueOf = (claim: Claim.t): undefined | Value.t =>
  claim.payload.kind === 'attribute' ? claim.payload.value :
  claim.payload.kind === 'metric' ? claim.payload.value :
  undefined

/**
 * @returns whether the produced value agrees with the golden's: equal
 * numbers (within `tolerance`, relative to the golden) under equal units,
 * or the exact same canonical text. Claims without a value (relations,
 * existence) always agree — their key already carries the object.
 */
export const valueAgrees = (golden: Claim.t, produced: Claim.t, tolerance = 0): boolean => {
  const goldenValue = valueOf(golden)
  const producedValue = valueOf(produced)
  if (goldenValue === undefined || producedValue === undefined) {
    return goldenValue === producedValue
  }
  if (goldenValue.num !== undefined && producedValue.num !== undefined) {
    if ((goldenValue.unit ?? '') !== (producedValue.unit ?? '')) {
      return false
    }
    return goldenValue.num === producedValue.num ||
      Math.abs(producedValue.num - goldenValue.num) <= tolerance * Math.abs(goldenValue.num)
  }
  return Value.format(goldenValue) === Value.format(producedValue)
}

export type Comparison = {
  readonly golden: number
  readonly produced: number
  /** Facts whose key and value both agree. */
  readonly matched: number
  /** Keys present on both sides with disagreeing values — right fact, wrong value. */
  readonly valueOff: number
  /** Golden facts with no match. */
  readonly misses: readonly Fact[]
  /** Produced facts with no match. */
  readonly extras: readonly Fact[]
  readonly precision: number
  readonly recall: number
  readonly f1: number
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

/** @returns the F1 of a precision/recall pair, 0 when both are 0. */
export const f1Of = (precision: number, recall: number): number =>
  precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

/** Compares produced facts against golden facts. */
export const compare = (
  golden: readonly Fact[],
  produced: readonly Fact[],
  options: { tolerance?: number } = {}
): Comparison => {
  const byKey = new Map(produced.map(fact => [fact.key, fact]))
  const misses: Fact[] = []
  const matchedKeys = new Set<string>()
  let matched = 0
  let valueOff = 0
  for (const fact of golden) {
    const candidate = byKey.get(fact.key)
    if (candidate !== undefined && valueAgrees(fact.claim, candidate.claim, options.tolerance)) {
      matched += 1
      matchedKeys.add(fact.key)
    } else {
      if (candidate !== undefined) {
        valueOff += 1
      }
      misses.push(fact)
    }
  }
  const extras = produced.filter(fact => !matchedKeys.has(fact.key))
  const precision = ratio(matched, produced.length)
  const recall = ratio(matched, golden.length)
  return {
    golden: golden.length,
    produced: produced.length,
    matched,
    valueOff,
    misses,
    extras,
    precision,
    recall,
    f1: f1Of(precision, recall)
  }
}

/** @returns the canonical line of a fact, for reports and judge prompts. */
export const lineOf = (fact: Fact): string =>
  emitClaim(normalize(fact.claim))
