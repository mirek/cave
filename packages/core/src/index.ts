/**
 * `@cavelang/core` — the CAVE domain model (spec §2, §6, §7, §9).
 *
 * Dependency-free foundation of the CAVE monorepo: canonical claim shapes,
 * values/units/multipliers, uncertainty and confidence semantics, claim keys
 * and UUIDv7 transaction identifiers. Higher packages (parser, canonical,
 * store, query, fusion, loop, cli) build on these types.
 *
 * Modules follow the `@prelude` convention: `import * as Claim from ...`,
 * with each module exporting its principal type as `t`.
 */

export * as Claim from './claim.ts'
export * as Confidence from './confidence.ts'
export * as Context from './context.ts'
export * as Entity from './entity.ts'
export * as Key from './key.ts'
export * as Multiplier from './multiplier.ts'
export * as Tag from './tag.ts'
export * as Uncertainty from './uncertainty.ts'
export * as Uuidv7 from './uuidv7.ts'
export * as Value from './value.ts'
export * as Verb from './verb.ts'
