/**
 * Automation parsing (spec §29.1) — the §24.1 rule line pointed at the
 * store's own change feed:
 *
 * ```cave
 * automation/page-on-spike HAS automation: `?svc IS service, ?svc HAS error-rate: ?r, ?r > 0.05 => action/open-incident, hook/page, "error rate reached ?r on ?svc"` ; page and investigate error-rate spikes
 * ```
 *
 * The left side is the **trigger** — §24.1 premises verbatim: CAVE-Q
 * patterns and `?var op value` constraints, at least one pattern. Unlike
 * an action (§25.1) a bare-variable segment is an error — an automation
 * has no caller, so every binding comes from the trigger. The right side
 * is a comma-separated list of **steps**:
 *
 * - `action/<name>` — execute the §25 action, its parameters bound from
 *   same-named trigger variables;
 * - `hook/<name>` — fire the out-of-band hook from the §25.4
 *   configuration actions use;
 * - a `"…"` or `` `…` `` literal — an agent prompt template, fired
 *   through the out-of-band `--agent` shell command (spec §29.3).
 *
 * Like an action, an automation is identified by *name*: the declaration
 * subject is `automation/<name>` and the body evolves as an ordinary
 * belief series under one claim key (§25.1's rule). The body is pure
 * data — patterns, names and prose, never commands (§19.5).
 */

import { Token } from '@cavelang/parser'
import { Rule } from '@cavelang/rules'

/** Attribute of automation declaration claims: `automation/<name> HAS automation: …`. */
export const automationAttribute = 'automation'

/** Subject prefix of automation declarations. */
export const subjectPrefix = 'automation/'

/** Prefix of `action/<name>` steps — the §25 declaration scope. */
export const actionStepPrefix = 'action/'

/** Prefix of `hook/<name>` steps — hooks live out-of-band, the name in-band (§25.4). */
export const hookStepPrefix = 'hook/'

/** Declaration subject of an automation: its name under the `automation/` scope. */
export const automationSubject = (name: string): string =>
  name.startsWith(subjectPrefix) ? name : `${subjectPrefix}${name}`

/** Automation name of a declaration subject, `undefined` when out of scope. */
export const automationName = (subject: string): undefined | string =>
  subject.startsWith(subjectPrefix) && subject.length > subjectPrefix.length ?
    subject.slice(subjectPrefix.length) :
    undefined

export type Step =
  | { readonly kind: 'action', readonly name: string, readonly text: string }
  | { readonly kind: 'hook', readonly name: string, readonly text: string }
  | { readonly kind: 'prompt', readonly template: string, readonly text: string }

export type Automation = {
  readonly name: string
  /** Declaration subject, `automation/<name>`. */
  readonly subject: string
  /** Normalized body text — single-spaced tokens, comment dropped. */
  readonly text: string
  /** Trigger premises — §24.1 patterns and constraints (spec §29.2). */
  readonly premises: readonly Rule.Premise[]
  /** Steps, in declaration (= execution) order. */
  readonly steps: readonly Step[]
}

export type t = Automation

export type Parsed =
  | { readonly ok: true, readonly automation: Automation }
  | { readonly ok: false, readonly problems: readonly string[] }

const isVariableToken = (token: Token.t): boolean =>
  token.kind === 'word' && token.text.startsWith('?') && token.text.length > 1

/** Splits `text` at its top-level commas — literal-protected, like §24.1. */
const splitSegments = (text: string): string[] => {
  const segments: string[] = []
  let cursor = 0
  for (const at of Rule.topLevel(text, ',')) {
    segments.push(text.slice(cursor, at))
    cursor = at + 1
  }
  segments.push(text.slice(cursor))
  return segments
}

const parseStep = (segment: string): { step?: Step, problem?: string } => {
  const text = Rule.normalizeSegment(segment)
  if (text === '') {
    return { problem: 'empty step — remove the extra comma' }
  }
  const tokens = Token.tokenize(segment)
  if (tokens.length === 1) {
    const token = tokens[0]!
    if (token.kind === 'text' || token.kind === 'code') {
      return { step: { kind: 'prompt', template: token.text, text } }
    }
    if (token.kind === 'word' && token.text.startsWith(actionStepPrefix) && token.text.length > actionStepPrefix.length) {
      return { step: { kind: 'action', name: token.text.slice(actionStepPrefix.length), text } }
    }
    if (token.kind === 'word' && token.text.startsWith(hookStepPrefix) && token.text.length > hookStepPrefix.length) {
      return { step: { kind: 'hook', name: token.text.slice(hookStepPrefix.length), text } }
    }
  }
  return { problem: `step ${JSON.stringify(text)} is not action/<name>, hook/<name> or a prompt literal (spec §29.1)` }
}

/**
 * Parses one automation body. Problems are returned, never thrown — a
 * stored declaration that fails to parse is reported and skipped,
 * mirroring rules (§24.1) and actions (§25.1).
 */
export const parse = (subject: string, body: string): Parsed => {
  const problems: string[] = []
  const name = automationName(subject)
  if (name === undefined) {
    return { ok: false, problems: [`declaration subject ${JSON.stringify(subject)} is not under ${subjectPrefix} (spec §29.1)`] }
  }
  const { head } = Token.splitComment(body)
  const arrows = Rule.topLevel(head, '=>')
  if (arrows.length === 0) {
    return { ok: false, problems: ['not an automation — no top-level "=>" (spec §29.1)'] }
  }
  if (arrows.length > 1) {
    return { ok: false, problems: ['an automation has exactly one "=>" (spec §29.1)'] }
  }
  const leftText = head.slice(0, arrows[0]!)
  const rightText = head.slice(arrows[0]! + 2)

  const premises: Rule.Premise[] = []
  const bound = new Set<string>()
  for (const segment of splitSegments(leftText)) {
    const tokens = Token.tokenize(segment)
    if (tokens.length === 1 && isVariableToken(tokens[0]!)) {
      problems.push(`bare ${tokens[0]!.text} — an automation has no caller, so it takes no parameters; bind variables in trigger patterns (spec §29.1)`)
      continue
    }
    const { premise, problem } = Rule.parsePremise(segment, bound)
    if (problem !== undefined) {
      problems.push(problem)
      continue
    }
    premises.push(premise!)
    if (premise!.kind === 'pattern') {
      Rule.patternVariables(premise!.pattern).forEach(variable => bound.add(variable))
    }
  }
  if (!premises.some(premise => premise.kind === 'pattern')) {
    problems.push('an automation needs at least one pattern premise — the trigger (spec §29.1)')
  }

  const steps: Step[] = []
  for (const segment of splitSegments(rightText)) {
    const { step, problem } = parseStep(segment)
    if (problem !== undefined) {
      problems.push(problem)
      continue
    }
    steps.push(step!)
  }
  if (steps.length === 0 && problems.length === 0) {
    problems.push('an automation needs at least one step (spec §29.1)')
  }
  if (problems.length > 0) {
    return { ok: false, problems }
  }

  const text = `${premises.map(premise => premise.text).join(', ')} => ${steps.map(step => step.text).join(', ')}`
  return { ok: true, automation: { name, subject, text, premises, steps } }
}
