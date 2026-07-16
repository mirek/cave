/**
 * Verb registry (spec §5.4, §5.5, §5.8).
 *
 * Tracks in-band verb knowledge: extension verb declarations (`MIGRATES IS
 * verb`), inverse pairs (`CONTAINS REVERSE PART-OF`), and lifecycle chains
 * (`OLD RENAMED-TO NEW`). No verb is born with an inverse or alias.
 *
 * The registry is an immutable value; declaring returns a new registry, so
 * the canonicalization pipeline can thread it through a document and
 * declarations take effect for subsequent lines only.
 */

import { Verb } from '@cavelang/core'

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
  /** Every lifecycle spelling → its stable, oldest storage spelling. */
  readonly storage: ReadonlyMap<string, string>
  /** Stable storage spelling → the currently preferred spelling. */
  readonly preferred: ReadonlyMap<string, string>
  /** Accepted `old → new` declarations, used to make replay idempotent. */
  readonly renames: ReadonlyMap<string, string>
}

export type t = Registry

/** Registry with no declarations. */
export const empty: Registry = {
  pairs: new Map(),
  declared: new Set(),
  storage: new Map(),
  preferred: new Map(),
  renames: new Map()
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
  a = storageOf(registry, a)
  b = storageOf(registry, b)
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
  return { ok: true, registry: { ...registry, pairs } }
}

/** Declares an extension verb (`X IS verb`, spec §5.4). */
export const declareVerb = (registry: Registry, verb: string): Registry => {
  verb = storageOf(registry, verb)
  if (registry.declared.has(verb)) {
    return registry
  }
  const declared = new Set(registry.declared)
  declared.add(verb)
  return { ...registry, declared }
}

/** @returns the stable storage spelling for a lifecycle alias (spec §5.8). */
export const storageOf = (registry: Registry, verb: string): string =>
  registry.storage.get(verb) ?? verb

/** @returns the latest preferred spelling in a lifecycle chain (spec §5.8). */
export const preferredOf = (registry: Registry, verb: string): string => {
  const storage = storageOf(registry, verb)
  return registry.preferred.get(storage) ?? storage
}

/** @returns whether `verb` remains accepted but has a newer preferred spelling. */
export const isDeprecated = (registry: Registry, verb: string): boolean =>
  registry.storage.has(verb) && preferredOf(registry, verb) !== verb

/** All accepted spellings for the same-direction verb, storage spelling first. */
export const spellingsOf = (registry: Registry, verb: string): string[] => {
  const storage = storageOf(registry, verb)
  return [
    storage,
    ...[...registry.storage.entries()]
      .filter(([spelling, root]) => root === storage && spelling !== storage)
      .map(([spelling]) => spelling)
  ]
}

/**
 * Declares `old RENAMED-TO new` (spec §5.8). The oldest spelling remains
 * the stable storage identity, while the right side becomes preferred for
 * authors. A chain must advance from its current preferred spelling;
 * branches, joins, and cycles are rejected, and the first declaration wins.
 */
export const declareRename = (registry: Registry, old: string, replacement: string): Declared => {
  if (!Verb.isVerbToken(old) || !Verb.isVerbToken(replacement)) {
    return {
      ok: false,
      registry,
      problem: `RENAMED-TO operands must be UPPERCASE verbs, got ${old} RENAMED-TO ${replacement}`
    }
  }
  if (old === replacement) {
    return { ok: false, registry, problem: `${old} cannot be RENAMED-TO itself` }
  }
  if (registry.renames.get(old) === replacement) {
    return { ok: true, registry }
  }
  const storage = storageOf(registry, old)
  const preferred = preferredOf(registry, old)
  if (preferred !== old) {
    return {
      ok: false,
      registry,
      problem: `${old} was already renamed to ${preferred}; continue the chain from ${preferred}`
    }
  }
  if (registry.storage.has(replacement)) {
    return {
      ok: false,
      registry,
      problem: `${replacement} already belongs to the ${storageOf(registry, replacement)} lifecycle; branches, joins, and cycles are not allowed`
    }
  }
  if (Verb.isKnown(replacement) || registry.pairs.has(replacement) || registry.declared.has(replacement)) {
    return {
      ok: false,
      registry,
      problem: `${replacement} already has an independent verb identity and cannot join the ${storage} lifecycle`
    }
  }
  const nextStorage = new Map(registry.storage)
  // The original spelling is entered too, so deprecation is directly
  // observable even for the first link in a chain.
  nextStorage.set(old, storage)
  nextStorage.set(replacement, storage)
  const nextPreferred = new Map(registry.preferred)
  nextPreferred.set(storage, replacement)
  const renames = new Map(registry.renames)
  renames.set(old, replacement)
  return {
    ok: true,
    registry: { ...registry, storage: nextStorage, preferred: nextPreferred, renames }
  }
}

/**
 * @returns the canonical primary of `verb` and whether `verb` is the
 * inverse side. An unpaired verb is its own primary.
 */
export const primaryOf = (registry: Registry, verb: string): { primary: string, isInverse: boolean } => {
  const storage = storageOf(registry, verb)
  const pair = registry.pairs.get(storage)
  if (pair === undefined || pair.primary === storage) {
    return { primary: storage, isInverse: false }
  }
  return { primary: pair.primary, isInverse: true }
}

/**
 * @returns the opposite name of `verb` — `CONTAINS` → `PART-OF`,
 * `PART-OF` → `CONTAINS` — or `undefined` when no inverse is declared
 * (reverse reads then fall back to an un-named object-side scan, spec §5.5).
 */
export const inverseOf = (registry: Registry, verb: string): undefined | string => {
  const storage = storageOf(registry, verb)
  const pair = registry.pairs.get(storage)
  if (pair === undefined) {
    return undefined
  }
  const inverse = pair.primary === storage ? pair.inverse : pair.primary
  return preferredOf(registry, inverse)
}

/** @returns `true` if `verb` was declared as an extension verb. */
export const isDeclared = (registry: Registry, verb: string): boolean =>
  registry.declared.has(storageOf(registry, verb))

/** All pairs, deduplicated, in insertion order. */
export const allPairs = (registry: Registry): Pair[] =>
  [...new Set(registry.pairs.values())]
