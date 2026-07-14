/**
 * `@cavelang/automate` — CAVE automations (spec §29): the event-driven
 * loop. In-band declarations pair a trigger pattern with named steps, and
 * `settle` evaluates them whenever belief changes — new claims matching
 * patterns fire rules, actions, out-of-band hooks, or an agent prompt.
 *
 * ```ts
 * import { declareAutomations, settle } from '@cavelang/automate'
 *
 * declareAutomations(store, 'automation/ack HAS automation: ' +
 *   '`?svc HAS error-rate: ?r, ?r > 0.05 => action/open-incident`')
 * await settle(store, { hooks })
 * // new error-rate claims execute action/open-incident with ?svc bound
 * ```
 *
 * Triggers join like rules (§24.2); a solution fires only when it cites a
 * row newer than the automation's watermark — an automation is armed at
 * its declaration, never wakes itself, and chains with others because
 * every write path is idempotent (§29.2–§29.4). Hook commands and the
 * agent command stay out-of-band (§19.5); the store only ever names them.
 */

export * as Automation from './automation.ts'
export { declareAutomations, listAutomations, loadAutomations, provenanceContext, retractAutomation } from './declare.ts'
export type { Declaration, ListedAutomation, LoadProblem, Loaded, Retraction } from './declare.ts'
export {
  appendReply, buildPrompt, defaultAgentTimeoutSeconds, defaultMaxPasses, settle, settled,
  substituteHook, substitutePrompt, watermarkAttribute
} from './engine.ts'
export type { AutomationOutcome, DeriveTotals, FiringOutcome, SettleOptions, SettleReport, StepOutcome } from './engine.ts'
export { runAutomate, watchCycle } from './main.ts'
