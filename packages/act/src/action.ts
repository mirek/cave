/**
 * Action parsing (spec §25.1) — the §24.1 rule line put in the caller's
 * hands:
 *
 * ```cave
 * ?service, ?version, ?service IS service => ?service HAS deployed-version: ?version
 * ```
 *
 * The left side is a comma-separated list of **parameter declarations**
 * (a segment that is one bare `?name` token), §24.1 **premises** —
 * CAVE-Q patterns and `?var op value` constraints, verbatim — and may be
 * empty. The right side is a comma-separated list of one or more
 * **effect templates**: ordinary claim lines whose subject, object, or
 * value slots may be variables bound by a parameter or a pattern
 * premise. A parameter with no other mention is legal — it may
 * parameterize the action's hook (spec §25.4).
 *
 * Unlike a rule, an action is identified by *name*, not content digest:
 * `action/<name>` is the declaration subject and the body evolves as an
 * ordinary belief series under one claim key.
 */

import { Claim } from '@cavelang/core'
import { parseDocument, Token, type Ast } from '@cavelang/parser'
import { Rule } from '@cavelang/rules'

/** Attribute of action declaration claims: `action/<name> HAS action: …`. */
export const actionAttribute = 'action'

/** Attribute of hook reference claims: `action/<name> HAS hook: <name>` (§25.4). */
export const hookAttribute = 'hook'

/** Subject prefix of action declarations. */
export const subjectPrefix = 'action/'

/** Declaration subject of an action: its name under the `action/` scope. */
export const actionSubject = (name: string): string =>
  name.startsWith(subjectPrefix) ? name : `${subjectPrefix}${name}`

/** Action name of a declaration subject, `undefined` when out of scope. */
export const actionName = (subject: string): undefined | string =>
  subject.startsWith(subjectPrefix) && subject.length > subjectPrefix.length ?
    subject.slice(subjectPrefix.length) :
    undefined

/**
 * Parameter names become CLI `param=value` keys, MCP schema properties
 * and `{param}` hook placeholders, so they are restricted beyond CAVE-Q
 * variable syntax; `action` is reserved for the hook's `{action}`
 * placeholder.
 */
export const paramNameRe = /^[A-Za-z][A-Za-z0-9_-]*$/

export type Action = {
  readonly name: string
  /** Declaration subject, `action/<name>`. */
  readonly subject: string
  /** Normalized body text — single-spaced tokens, comment dropped. */
  readonly text: string
  /** Parameter names, in declaration order. */
  readonly params: readonly string[]
  readonly premises: readonly Rule.Premise[]
  /** Effect templates — ordinary claims whose terms may be `?var`s. */
  readonly effects: readonly Ast.Full[]
}

export type t = Action

export type Parsed =
  | { readonly ok: true, readonly action: Action }
  | { readonly ok: false, readonly problems: readonly string[] }

const isVariableToken = (token: Token.t): boolean =>
  token.kind === 'word' && token.text.startsWith('?') && token.text.length > 1

/** Variables an effect template references (subject/object/value slots). */
export const effectVariables = (effect: Ast.Full): string[] => {
  const names: string[] = []
  const term = (candidate: Claim.Term): void => {
    if (candidate.kind === 'entity' && candidate.text.startsWith('?') && candidate.text.length > 1) {
      names.push(candidate.text.slice(1))
    }
  }
  term(effect.subject)
  switch (effect.payload.kind) {
    case 'relation':
      term(effect.payload.object)
      break
    case 'attribute':
    case 'metric': {
      const value = effect.payload.value
      if (value.kind === 'atom' && value.raw.startsWith('?') && value.raw.length > 1) {
        names.push(value.raw.slice(1))
      }
      break
    }
    default:
      break
  }
  return names
}

const parseEffect = (segment: string, bound: ReadonlySet<string>): { effect?: Ast.Full, problems: string[] } => {
  const problems: string[] = []
  const text = Rule.normalizeSegment(segment)
  if (text === '') {
    return { problems: ['empty effect — remove the extra comma'] }
  }
  const tokens = Token.tokenize(segment)
  if (tokens.some(token => token.kind === 'word' && token.text === '_')) {
    problems.push('effect slots must be bound — "_" is not allowed on the right side (spec §25.1)')
  }
  for (const token of tokens) {
    if (token.kind === 'word' && /^\?.+:$/.test(token.text)) {
      problems.push(`variables cannot name attributes (${token.text})`)
    }
  }
  const document = parseDocument(text)
  const claimLine = document.lines.find(entry => entry.kind === 'claim')
  if (document.diagnostics.length > 0 || claimLine === undefined || claimLine.kind !== 'claim') {
    problems.push(`cannot parse effect ${JSON.stringify(text)} as a claim` +
      document.diagnostics.map(diagnostic => ` — ${diagnostic.message}`).join(''))
    return { problems }
  }
  const effect = claimLine.claim
  for (const context of effect.meta.contexts) {
    if (context.includes('?')) {
      problems.push(`variables cannot appear in effect contexts (@${context})`)
    }
  }
  for (const tag of effect.meta.tags) {
    if (tag.key.includes('?') || tag.value?.includes('?') === true) {
      problems.push(`variables cannot appear in effect tags (#${tag.key}${tag.value === undefined ? '' : `:${tag.value}`})`)
    }
  }
  for (const name of effectVariables(effect)) {
    if (!bound.has(name)) {
      problems.push(`effect variable ?${name} is neither a parameter nor bound by a pattern premise (spec §25.1)`)
    }
  }
  return problems.length > 0 ? { problems } : { effect, problems: [] }
}

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

/**
 * Parses one action body. Problems are returned, never thrown — a stored
 * declaration that fails to parse is reported and skipped, mirroring
 * rules (§24.1) and the lenient ingest surfaces (spec §1.6).
 */
export const parse = (subject: string, body: string): Parsed => {
  const problems: string[] = []
  const name = actionName(subject)
  if (name === undefined) {
    return { ok: false, problems: [`declaration subject ${JSON.stringify(subject)} is not under ${subjectPrefix} (spec §25.1)`] }
  }
  const { head } = Token.splitComment(body)
  const arrows = Rule.topLevel(head, '=>')
  if (arrows.length === 0) {
    return { ok: false, problems: ['not an action — no top-level "=>" (spec §25.1)'] }
  }
  if (arrows.length > 1) {
    return { ok: false, problems: ['an action has exactly one "=>" (spec §25.1)'] }
  }
  const leftText = head.slice(0, arrows[0]!)
  const rightText = head.slice(arrows[0]! + 2)

  const params: string[] = []
  const premises: Rule.Premise[] = []
  const bound = new Set<string>()
  if (leftText.trim() !== '') {
    for (const segment of splitSegments(leftText)) {
      const tokens = Token.tokenize(segment)
      if (tokens.length === 1 && isVariableToken(tokens[0]!)) {
        const param = tokens[0]!.text.slice(1)
        if (!paramNameRe.test(param)) {
          problems.push(`parameter ?${param} — names are letters, digits, _ and - and start with a letter (spec §25.1)`)
          continue
        }
        if (param === 'action') {
          problems.push('parameter ?action — the name is reserved for the {action} hook placeholder (spec §25.4)')
          continue
        }
        if (params.includes(param)) {
          problems.push(`parameter ?${param} is declared twice`)
          continue
        }
        params.push(param)
        bound.add(param)
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
  }

  const effects: Ast.Full[] = []
  const effectTexts: string[] = []
  for (const segment of splitSegments(rightText)) {
    const { effect, problems: effectProblems } = parseEffect(segment, bound)
    problems.push(...effectProblems)
    if (effect !== undefined) {
      effects.push(effect)
      effectTexts.push(Rule.normalizeSegment(segment))
    }
  }
  if (effects.length === 0 && problems.length === 0) {
    problems.push('an action needs at least one effect (spec §25.1)')
  }
  if (problems.length > 0) {
    return { ok: false, problems }
  }

  const left = [
    ...params.map(param => `?${param}`),
    ...premises.map(premise => premise.text)
  ].join(', ')
  const text = `${left === '' ? '' : `${left} `}=> ${effectTexts.join(', ')}`
  return { ok: true, action: { name, subject, text, params, premises, effects } }
}
