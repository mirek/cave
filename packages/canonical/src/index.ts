/**
 * `@cavelang/canonical` — the CAVE semantic layer (spec §5.4, §5.5, §8, §13.4).
 *
 * Verb registry with in-band `REVERSE`/extension declarations, the
 * canonicalization pipeline (inverse resolution, continuation expansion,
 * qualifier edges, `UNLESS` normalization), the shared standard prelude and
 * the canonical emitter.
 *
 * ```ts
 * import { canonicalizeText, standardRegistry, emit } from '@cavelang/canonical'
 *
 * const result = canonicalizeText('packages/api PART-OF monorepo', standardRegistry)
 * result.claims[0].claim // monorepo CONTAINS packages/api — one fact, two names
 * emit(result)           // canonical text, primary direction
 * ```
 */

export * as Registry from './registry.ts'
export { canonicalize, canonicalizeText } from './canonicalize.ts'
export type { Edge, EdgeRole, Entry, Problem, Result } from './canonicalize.ts'
export { emit, emitClaim, txComment, txOfLine } from './emit.ts'
export type { EmitOptions } from './emit.ts'
export { standardPrelude, standardRegistry } from './prelude.ts'
