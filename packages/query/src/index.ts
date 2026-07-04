/**
 * `@cavelang/query` — CAVE-Q, the graph-pattern query layer (spec §12).
 *
 * ```ts
 * import { query } from '@cavelang/query'
 *
 * query(store, '?x USES jwt')                    // [{ bindings: { x: 'auth/middleware' }, row }]
 * query(store, '?x HAS bug: ?bug #security')
 * query(store, '?x PART-OF monorepo')            // inverse verbs compile to canonical rows
 * query(store, 'terrier EXTENDS+ animal')        // transitive
 * ```
 */

export * as Pattern from './pattern.ts'
export { query } from './compile.ts'
export type { Match, Options } from './compile.ts'
