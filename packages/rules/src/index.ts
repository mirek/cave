/**
 * `@cavelang/rules` — the CAVE rules engine (spec §24): forward-chaining
 * `premises => conclusion` rules over current beliefs.
 *
 * ```ts
 * import { declareRules, derive } from '@cavelang/rules'
 *
 * declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
 * derive(store)
 * // appends e.g. `a NEEDS c @src:rule/9f30ac9be4dd`, linked BECAUSE to the
 * // two premise rows and VIA to the rule's declaration row
 * ```
 *
 * Derived confidence is noisy-AND (`@cavelang/fusion`, independence
 * explicit); re-runs are idempotent and incremental by tx watermark;
 * premise retraction retracts dependents (§24.4–§24.5).
 */

export * as Rule from './rule.ts'
export { derive, defaultMinConf, defaultMaxPasses, provenanceContext, ruleAttribute, ruleSubject, watermarkAttribute } from './engine.ts'
export type { DeriveOptions, DeriveReport, RuleOutcome, RuleProblem } from './engine.ts'
export { declareRules, listRules, retractRule } from './declare.ts'
export type { Declaration, ListedRule, Retraction } from './declare.ts'
