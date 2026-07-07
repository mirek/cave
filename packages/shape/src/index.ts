/**
 * `@cavelang/shape` — shape expectations and knowledge health (spec §20).
 *
 * ```ts
 * import { check, gatedIngest } from '@cavelang/shape'
 *
 * store.ingest('service EXPECTS owner\napi-gateway IS service')
 * check(store).violations
 * // → [{ entity: 'api-gateway', via: 'service', expectation: { …, name: 'owner' } }]
 *
 * gatedIngest(store, 'cache IS service', { source: 'cli' })
 * // → { ok: false, violations: […] } — rolled back, nothing appended
 * ```
 */

export { check, defaultStaleDays, evaluate, expectations } from './check.ts'
export type { Coverage, Disagreement, Evaluation, Expectation, Options, Report, Stale, Violation } from './check.ts'
export { gatedIngest } from './gate.ts'
export type { GateResult } from './gate.ts'
