/**
 * Verb registry (spec §5.4, §5.5).
 *
 * Tracks in-band verb knowledge: extension verb declarations (`MIGRATES IS
 * verb`) and inverse pairs (`CONTAINS REVERSE PART-OF`). No verb is born
 * with an inverse — a relation without a `REVERSE` declaration simply has
 * no reverse name.
 *
 * The registry is an immutable value; declaring returns a new registry, so
 * the canonicalization pipeline can thread it through a document and
 * declarations take effect for subsequent lines only.
 */

import { Verb } from '@cave/core'

/** An inverse pair. The primary is the left side of the first declaration (spec §5.5). */
export type Pair = {
  readonly primary: string
  readonly inverse: string
}

export type Registry = {
  /** Every verb of every pair → its pair. */
  readonly pairs: ReadonlyMap<string, Pair>
  /** Extension verbs declared via `X IS verb`. */
  readonly declared: ReadonlySet<string>
}

export type t = Registry

/** Registry with no declarations. */
export const empty: Registry = {
  pairs: new Map(),
  declared: new Set()
}

export type Declared =
  | { readonly ok: true, readonly registry: Registry }
  | { readonly ok: false, readonly registry: Registry, readonly problem: string }

/**
 * Declares `a REVERSE b`: `a` is primary, `b` its inverse (spec §5.5).
 * Redeclaring an existing pair in either direction is a no-op; a
 * declaration that conflicts with an existing pair is rejected — the first
 * declaration wins.
 */
export const declareReverse = (registry: Registry, a: string, b: string): Declared => {
  if (!Verb.isVerbToken(a) || !Verb.isVerbToken(b)) {
    return { ok: false, registry, problem: `REVERSE operands must be UPPERCASE verbs, got ${a} REVERSE ${b}` }
  }
  const existingA = registry.pairs.get(a)
  const existingB = registry.pairs.get(b)
  const existing = existingA ?? existingB
  if (existing !== undefined) {
    const same =
      (existing.primary === a && existing.inverse === b) ||
      (existing.primary === b && existing.inverse === a)
    if (same && existingA === existingB) {
      return { ok: true, registry }
    }
    return {
      ok: false,
      registry,
      problem: `${a} REVERSE ${b} conflicts with existing ${existing.primary} REVERSE ${existing.inverse} — first declaration wins (spec §5.5)`
    }
  }
  const pair: Pair = { primary: a, inverse: b }
  const pairs = new Map(registry.pairs)
  pairs.set(a, pair)
  pairs.set(b, pair)
  return { ok: true, registry: { pairs, declared: registry.declared } }
}

/** Declares an extension verb (`X IS verb`, spec §5.4). */
export const declareVerb = (registry: Registry, verb: string): Registry => {
  if (registry.declared.has(verb)) {
    return registry
  }
  const declared = new Set(registry.declared)
  declared.add(verb)
  return { pairs: registry.pairs, declared }
}

/**
 * @returns the canonical primary of `verb` and whether `verb` is the
 * inverse side. An unpaired verb is its own primary.
 */
export const primaryOf = (registry: Registry, verb: string): { primary: string, isInverse: boolean } => {
  const pair = registry.pairs.get(verb)
  if (pair === undefined || pair.primary === verb) {
    return { primary: verb, isInverse: false }
  }
  return { primary: pair.primary, isInverse: true }
}

/**
 * @returns the opposite name of `verb` — `CONTAINS` → `PART-OF`,
 * `PART-OF` → `CONTAINS` — or `undefined` when no inverse is declared
 * (reverse reads then fall back to an un-named object-side scan, spec §5.5).
 */
export const inverseOf = (registry: Registry, verb: string): undefined | string => {
  const pair = registry.pairs.get(verb)
  if (pair === undefined) {
    return undefined
  }
  return pair.primary === verb ? pair.inverse : pair.primary
}

/** @returns `true` if `verb` was declared as an extension verb. */
export const isDeclared = (registry: Registry, verb: string): boolean =>
  registry.declared.has(verb)

/** All pairs, deduplicated, in insertion order. */
export const allPairs = (registry: Registry): Pair[] =>
  [...new Set(registry.pairs.values())]
