/**
 * `@cavelang/shape` — shape expectations, knowledge health (spec §20) and
 * alias discovery (spec §27).
 *
 * ```ts
 * import { check, gatedIngest, suggestAliases } from '@cavelang/shape'
 *
 * store.ingest('service EXPECTS owner\napi-gateway IS service')
 * check(store).violations
 * // → [{ entity: 'api-gateway', via: 'service', expectation: { …, name: 'owner' } }]
 *
 * gatedIngest(store, 'cache IS service', { source: 'cli' })
 * // → { ok: false, violations: […] } — rolled back, nothing appended
 *
 * suggestAliases(store).map(suggestion => suggestion.line)
 * // → ['maria ALIAS grandma-maria #suggested @ 35% ; segments of maria within grandma-maria']
 * ```
 */

export { check, defaultStaleDays, evaluate, expectations } from './check.ts'
export type { Coverage, Disagreement, Evaluation, Expectation, Options, Report, Stale, Violation } from './check.ts'
export { gatedIngest, violationKey } from './gate.ts'
export type { GateResult } from './gate.ts'
export {
  defaultMinScore, judgePrompt, parseJudgeReply, suggestAliases, suggestSource, suggestTag, writeSuggestions
} from './suggest.ts'
export type { Signal, Suggestion, Options as SuggestOptions } from './suggest.ts'
