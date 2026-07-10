/**
 * `@cavelang/sync` — store merge (spec §28).
 *
 * Merge append-only CAVE stores by row identity: rows absent by id copy
 * verbatim, present ids skip — idempotent, transitive, conflict-free by
 * construction (§9.4 coexistence). Sources are store files (`syncDb`) or
 * §28.4 transaction-annotated canonical text (`syncText`,
 * `cave export --tx`); effective merges append a `SYNCED-INTO` record
 * claim, and merged transaction ids feed the §28.2 receive rule.
 *
 * ```ts
 * import { open } from '@cavelang/store'
 * import { syncDb } from '@cavelang/sync'
 *
 * const store = open('main.db')
 * syncDb(store, 'laptop.db', { from: 'laptop', into: 'main' })
 * // → { merged: 42, skipped: 108, edges: 17, record: 'store/laptop SYNCED-INTO store/main ; …' }
 * ```
 */

export { isStoreFile, labelOf, sanitizeLabel, syncDb, syncFile, syncText } from './sync.ts'
export type { SyncOptions, SyncProblem, SyncReport } from './sync.ts'
