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
 * query(store, '?x IS live', { asOf: '2026-01-15' }) // belief state at a past moment (§12.3)
 * query(store, '?x HAS owner: ?o', { resolve: true }) // §26 winners only — one row per contested fact
 * ```
 */

export * as Pattern from './pattern.ts'
export { match, query } from './bounded.ts'
export type { Match, Options } from './bounded.ts'
export { queryRecords } from './record.ts'
export * as Record from './record.ts'
export { defaultLimit, maxLimit, page } from './page.ts'
export type { Page, PageOptions } from './page.ts'
