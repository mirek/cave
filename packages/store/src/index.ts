/**
 * `@cavelang/store` — CAVE persistence on the Node.js builtin `node:sqlite`
 * (spec §13).
 *
 * ```ts
 * import { open } from '@cavelang/store'
 *
 * const store = open('knowledge.db')
 * store.ingest('monorepo CONTAINS packages/api')
 * store.reverse('packages/api')
 * // → [{ verb: 'CONTAINS', rel: 'PART-OF', source: 'monorepo', … }]
 * ```
 */

export * as Resolve from './resolve.ts'
export * as Row from './row.ts'
export * as Schema from './schema.ts'
export * as Sensitivity from './sensitivity.ts'
export { open } from './open.ts'
export type { Store } from './open.ts'
export { defaultDbPath } from './store.ts'
export type { AppendOptions, ForwardFact, IngestResult, ReverseFact, TraverseOptions } from './store.ts'
export type { Level as SensitivityLevel } from './sensitivity.ts'
