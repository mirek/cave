/**
 * Rule parsing (spec §24.1) — the Draft §17.4 `=>` line, proven out:
 *
 * ```cave
 * ?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z
 * ?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian
 * ?x PRECEDES ?e, ?x CONTAINS ?c => ?c CAUSE ?e @ 50%
 * ```
 *
 * The left side is a comma-separated conjunction of **premises**: CAVE-Q
 * patterns (spec §12.1 — the same parser, so inverse verbs, `VERB+`
 * transitive hops, `NOT`, `@ctx` and `#tag` filters all work) and value
 * **constraints** (`?a < 18`). The right side is one ordinary CAVE claim
 * line whose `?var` slots must be bound by pattern premises; its own
 * metadata rides along, and its `@ N%` is the rule's confidence factor.
 *
 * `=>` is the only rule-specific token. A rule's identity is the first 12
 * hex chars of SHA-256 over its *normalized* text (tokens single-spaced,
 * comment dropped) — whitespace variants of one rule share a digest.
 */

import { createHash } from 'node:crypto'
import { Claim, Value } from '@cavelang/core'
import { parseDocument, Token, type Ast } from '@cavelang/parser'
import { Pattern } from '@cavelang/query'

export type ConstraintOp = '=' | '!=' | '>' | '>=' | '<' | '<='

const constraintOps: readonly ConstraintOp[] = ['>=', '<=', '!=', '=', '>', '<']

export type Premise =
  | { readonly kind: 'pattern', readonly pattern: Pattern.t, readonly text: string }
  | { readonly kind: 'constraint', readonly variable: string, readonly op: ConstraintOp, readonly value: Value.t, readonly text: string }

export type Rule = {
  /** Normalized rule text — single-spaced tokens, comment dropped. */
  readonly text: string
  /** First 12 hex chars of SHA-256 over `text` — the rule's identity. */
  readonly digest: string
  readonly premises: readonly Premise[]
  /** Conclusion template — an ordinary claim whose terms may be `?var`s. */
  readonly conclusion: Ast.Full
  /** The conclusion's own `@ N%` — the rule confidence factor (§24.2). */
  readonly conf: number
  /** Trailing `; comment` — a human label for reports and `--list`. */
  readonly label?: string
}

export type t = Rule

export type Parsed =
  | { readonly ok: true, readonly rule: Rule }
  | { readonly ok: false, readonly problems: readonly string[] }

/** First 12 hex chars of SHA-256 — the digest convention of §9.5 sources. */
export const digestOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 12)

/**
 * Positions of `needle` occurrences that sit outside `"…"` and `` `…` ``
 * literals — `=>` or `,` inside a quoted term never split the rule.
 */
const topLevel = (text: string, needle: string): number[] => {
  const positions: number[] = []
  let quote: undefined | string
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === '`') {
      quote = char
      continue
    }
    if (text.startsWith(needle, i)) {
      positions.push(i)
      i += needle.length - 1
    }
  }
  return positions
}

/** @returns `true` when the line contains a top-level `=>` — a rule line. */
export const isRuleLine = (line: string): boolean =>
  topLevel(Token.splitComment(line).head, '=>').length > 0

const formatToken = (token: Token.t): string => {
  switch (token.kind) {
    case 'text':
      return `"${token.text}"`
    case 'code':
      return `\`${token.text}\``
    default:
      return token.text
  }
}

/** Single-spaced token text of one rule segment — the normalization unit. */
const normalizeSegment = (segment: string): string =>
  Token.tokenize(segment).map(formatToken).join(' ')

const isVariableToken = (text: string): boolean =>
  text.startsWith('?') && text.length > 1

/** Variables a pattern binds — the names its slots introduce. */
const patternVariables = (pattern: Pattern.t): string[] => {
  const names: string[] = []
  if (pattern.subject.kind === 'var') {
    names.push(pattern.subject.name)
  }
  if (pattern.verb.kind === 'var') {
    names.push(pattern.verb.name)
  }
  if (pattern.payload.kind === 'object' && pattern.payload.object.kind === 'var') {
    names.push(pattern.payload.object.name)
  }
  if (pattern.payload.kind === 'attribute' && pattern.payload.value.kind === 'var') {
    names.push(pattern.payload.value.name)
  }
  return names
}

/** Variables the conclusion template references (subject/object/value slots). */
const conclusionVariables = (conclusion: Ast.Full): string[] => {
  const names: string[] = []
  const term = (candidate: Claim.Term): void => {
    if (candidate.kind === 'entity' && isVariableToken(candidate.text)) {
      names.push(candidate.text.slice(1))
    }
  }
  term(conclusion.subject)
  switch (conclusion.payload.kind) {
    case 'relation':
      term(conclusion.payload.object)
      break
    case 'attribute':
    case 'metric': {
      const value = conclusion.payload.value
      if (value.kind === 'atom' && isVariableToken(value.raw)) {
        names.push(value.raw.slice(1))
      }
      break
    }
    default:
      break
  }
  return names
}

const parsePremise = (segment: string, bound: ReadonlySet<string>): { premise?: Premise, problem?: string } => {
  const text = normalizeSegment(segment)
  if (text === '') {
    return { problem: 'empty premise — remove the extra comma' }
  }
  const tokens = Token.tokenize(segment)
  const [first, second, ...rest] = tokens
  // A constraint is `?var op value` — no CAVE-Q pattern puts an operator
  // symbol in verb position, so the shapes never collide.
  if (
    first?.kind === 'word' && isVariableToken(first.text) &&
    second?.kind === 'word' && constraintOps.includes(second.text as ConstraintOp)
  ) {
    if (rest.length === 0) {
      return { problem: `constraint ${JSON.stringify(text)} is missing a value` }
    }
    const variable = first.text.slice(1)
    if (!bound.has(variable)) {
      return { problem: `constraint on ?${variable} before any pattern premise binds it — reorder the premises` }
    }
    const value = Value.parse(rest.map(token => token.text).join(' '))
    return { premise: { kind: 'constraint', variable, op: second.text as ConstraintOp, value, text } }
  }
  try {
    return { premise: { kind: 'pattern', pattern: Pattern.parse(segment), text } }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Parses one rule line. Problems are returned, never thrown — a stored
 * rule that fails to parse is reported and skipped, mirroring the lenient
 * ingest surfaces (spec §1.6).
 */
export const parse = (line: string): Parsed => {
  const problems: string[] = []
  const { head, comment } = Token.splitComment(line)
  const arrows = topLevel(head, '=>')
  if (arrows.length === 0) {
    return { ok: false, problems: ['not a rule — no top-level "=>" (spec §24.1)'] }
  }
  if (arrows.length > 1) {
    return { ok: false, problems: ['a rule has exactly one "=>" (spec §24.1)'] }
  }
  const leftText = head.slice(0, arrows[0]!)
  const rightText = head.slice(arrows[0]! + 2)

  const premises: Premise[] = []
  const bound = new Set<string>()
  let cursor = 0
  const segments: string[] = []
  for (const at of topLevel(leftText, ',')) {
    segments.push(leftText.slice(cursor, at))
    cursor = at + 1
  }
  segments.push(leftText.slice(cursor))
  for (const segment of segments) {
    const { premise, problem } = parsePremise(segment, bound)
    if (problem !== undefined) {
      problems.push(problem)
      continue
    }
    premises.push(premise!)
    if (premise!.kind === 'pattern') {
      patternVariables(premise!.pattern).forEach(name => bound.add(name))
    }
  }
  if (!premises.some(premise => premise.kind === 'pattern')) {
    problems.push('a rule needs at least one pattern premise (spec §24.1)')
  }

  const conclusionText = normalizeSegment(rightText)
  const document = parseDocument(conclusionText)
  const claimLine = document.lines.find(entry => entry.kind === 'claim')
  if (document.diagnostics.length > 0 || claimLine === undefined || claimLine.kind !== 'claim') {
    problems.push(`cannot parse conclusion ${JSON.stringify(conclusionText)} as a claim` +
      document.diagnostics.map(diagnostic => ` — ${diagnostic.message}`).join(''))
    return { ok: false, problems }
  }
  const conclusion = claimLine.claim
  if (Token.tokenize(rightText).some(token => token.kind === 'word' && token.text === '_')) {
    problems.push('conclusion slots must be bound — "_" is not allowed on the right side (spec §24.1)')
  }
  for (const name of conclusionVariables(conclusion)) {
    if (!bound.has(name)) {
      problems.push(`conclusion variable ?${name} is not bound by any pattern premise (spec §24.1)`)
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems }
  }

  const text = `${premises.map(premise => premise.text).join(', ')} => ${conclusionText}`
  return {
    ok: true,
    rule: {
      text,
      digest: digestOf(text),
      premises,
      conclusion,
      conf: conclusion.meta.conf ?? 1,
      ...comment === undefined ? {} : { label: comment }
    }
  }
}
