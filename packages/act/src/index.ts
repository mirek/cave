/**
 * `@cavelang/act` — action templates (spec §25): named, parameterized
 * governed writes over a CAVE store.
 *
 * ```ts
 * import { act, declareActions } from '@cavelang/act'
 *
 * declareActions(store, 'action/mark-deployed HAS action: ' +
 *   '`?service, ?version, ?service IS service => ' +
 *   '?service HAS deployed-version: ?version`')
 * act(store, 'mark-deployed', { service: 'api-gateway', version: '1.2.3' })
 * // appends `api-gateway HAS deployed-version: 1.2.3 @src:action/mark-deployed`,
 * // linked BECAUSE to the matched precondition row and VIA to the declaration
 * ```
 *
 * Preconditions are §24.1 premises evaluated against current beliefs with
 * the parameters pre-bound — a premise with no solution fails the action
 * and nothing is appended. Executions are atomic, idempotent, gated on
 * the store's `EXPECTS` declarations by default (§25.3), and may fire an
 * out-of-band, config-declared side-effect hook after commit (§25.4).
 */

export * as Action from './action.ts'
export { act, defaultHookTimeoutSeconds, shellQuote, substitute } from './engine.ts'
export type { ActFailure, ActOptions, ActReport, ActSuccess, EffectOutcome, HookOutcome } from './engine.ts'
export { currentHook, declareActions, listActions, loadAction, provenanceContext, retractAction } from './declare.ts'
export type { Declaration, ListedAction, ListedParam, Loaded, Retraction } from './declare.ts'
