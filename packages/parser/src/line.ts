/**
 * Token-stream line parser (spec §3.2, §16).
 *
 * Parses the token list of one line into claim/continuation/qualifier
 * bodies. The payload/metadata boundary is decided lexically: metadata items
 * are unambiguous at their first token (spec §4.3 reserved characters), so
 * everything before the first metadata token is payload.
 */

import { Claim, Confidence, Tag, Value, Verb } from '@cave/core'
import type * as Ast from './ast.ts'
import type { Token } from './token.ts'

export type Result<T> =
  | { readonly ok: true, readonly value: T, readonly problems: readonly string[] }
  | { readonly ok: false, readonly message: string }

const ok = <T>(value: T, problems: readonly string[] = []): Result<T> =>
  ({ ok: true, value, problems })

const fail = (message: string): Result<never> =>
  ({ ok: false, message })

const sigmaRe = /^\((\d+(?:\.\d+)?)σ\)$/u

/** @returns `true` if `token` starts a metadata item (spec §4.3). */
export const isMetaStart = (token: Token): boolean =>
  token.kind === 'word' && (
    token.text.startsWith('@') ||
    token.text.startsWith('#') ||
    token.text.startsWith('+/-') ||
    token.text === '!' ||
    sigmaRe.test(token.text)
  )

/** @returns term from a single token (spec §16: atom, literal or code literal). */
const term = (token: Token): Claim.Term => {
  switch (token.kind) {
    case 'text':
      return Claim.text(token.text)
    case 'code':
      return Claim.code(token.text)
    default:
      return Claim.entity(token.text)
  }
}

/** @returns value from payload value tokens (attribute value or metric). */
const valueOf = (tokens: readonly Token[]): undefined | Value.t => {
  if (tokens.length === 0) {
    return undefined
  }
  const [head] = tokens
  if (tokens.length === 1 && head!.kind === 'text') {
    return Value.ofText(head!.text)
  }
  if (tokens.length === 1 && head!.kind === 'code') {
    return Value.ofCode(head!.text)
  }
  if (tokens.some(token => token.kind !== 'word')) {
    return undefined
  }
  return Value.parse(tokens.map(token => token.text).join(' '))
}

/**
 * Parses metadata tokens (spec §6). Never fails — unrecognized tokens are
 * reported as problems and skipped, honoring the robust-extraction goal
 * (spec §1.6).
 */
export const parseMeta = (tokens: readonly Token[], comment?: string): { meta: Ast.Meta, problems: string[] } => {
  const contexts: string[] = []
  const tags: Tag.t[] = []
  const problems: string[] = []
  let conf: undefined | number
  let importance = false
  let delta: undefined | Value.t
  let sigmaLevel: undefined | number
  let i = 0
  const collectValueTokens = (): Token[] => {
    const collected: Token[] = []
    while (i < tokens.length && !isMetaStart(tokens[i]!) && tokens[i]!.kind === 'word') {
      collected.push(tokens[i]!)
      i += 1
    }
    return collected
  }
  while (i < tokens.length) {
    const token = tokens[i]!
    i += 1
    if (token.kind !== 'word') {
      problems.push(`unexpected literal ${JSON.stringify(token.text)} in metadata position`)
      continue
    }
    const word = token.text
    if (word === '@') {
      const next = tokens[i]
      const parsed = next?.kind === 'word' ? Confidence.parse(next.text) : undefined
      if (parsed === undefined) {
        problems.push('expected percentage after "@ " (spec §6.3)')
        continue
      }
      conf = parsed
      i += 1
      continue
    }
    if (word.startsWith('@')) {
      contexts.push(word.slice(1))
      continue
    }
    if (word === '#') {
      problems.push('empty tag')
      continue
    }
    if (word.startsWith('#')) {
      tags.push(Tag.parse(word.slice(1)))
      continue
    }
    if (word.startsWith('+/-')) {
      const glued = word.slice('+/-'.length)
      const collected = collectValueTokens().map(token_ => token_.text)
      const raw = [...glued === '' ? [] : [glued], ...collected].join(' ')
      if (raw === '') {
        problems.push('expected value after +/- (spec §7.2)')
        continue
      }
      delta = Value.parse(raw)
      continue
    }
    const sigma = sigmaRe.exec(word)
    if (sigma) {
      sigmaLevel = Number(sigma[1])
      continue
    }
    if (word === '!') {
      importance = true
      continue
    }
    problems.push(`unexpected token ${JSON.stringify(word)} after payload`)
  }
  return {
    meta: {
      contexts,
      tags,
      importance,
      ...conf !== undefined ? { conf } : {},
      ...delta !== undefined ? { delta } : {},
      ...sigmaLevel !== undefined ? { sigmaLevel } : {},
      ...comment !== undefined ? { comment } : {}
    },
    problems
  }
}

/** Splits tokens at the first metadata token. */
const splitAtMeta = (tokens: readonly Token[]): { payload: readonly Token[], meta: readonly Token[] } => {
  const at = tokens.findIndex(isMetaStart)
  return at === -1 ?
    { payload: tokens, meta: [] } :
    { payload: tokens.slice(0, at), meta: tokens.slice(at) }
}

/**
 * Parses payload tokens (spec §16 `payload`):
 *
 * - `attr: value` — attribute claim; the colon is canonical (spec §3.4)
 * - legacy colonless `HAS attr value` when the value is numeric/date-like
 * - `IS` + numeric/date value — metric claim
 * - empty — bare existence, `EXISTS` only
 * - otherwise — relational object (single term or multi-word phrase)
 */
const parsePayload = (verb: string, tokens: readonly Token[]): Result<Claim.Payload> => {
  if (tokens.length === 0) {
    return verb === 'EXISTS' ?
      ok(Claim.none) :
      fail(`missing object after ${verb} (the minimum line is "entity VERB object", spec §2.2)`)
  }
  const [head, ...rest] = tokens
  if (head!.kind === 'word' && head!.text.endsWith(':') && head!.text.length > 1) {
    const attribute = head!.text.slice(0, -1)
    const value = valueOf(rest)
    if (value === undefined) {
      return fail(`missing or mixed value after attribute ${JSON.stringify(attribute)} (spec §3.4)`)
    }
    return ok(Claim.attribute(attribute, value))
  }
  if (verb === 'HAS' && rest.length > 0 && head!.kind === 'word') {
    const value = valueOf(rest)
    if (value !== undefined && (value.kind === 'number' || value.kind === 'date')) {
      return ok(
        Claim.attribute(head!.text, value),
        [`legacy colonless attribute form; canonical is "${head!.text}: ${value.raw}" (spec §3.4)`]
      )
    }
  }
  if (verb === 'IS') {
    const value = valueOf(tokens)
    if (value !== undefined && (value.kind === 'number' || value.kind === 'date')) {
      return ok(Claim.metric(value))
    }
  }
  if (tokens.length === 1) {
    return ok(Claim.relation(term(head!)))
  }
  if (tokens.every(token => token.kind === 'word')) {
    return ok(Claim.relation(Claim.entity(tokens.map(token => token.text).join(' '))))
  }
  return fail('object phrase mixes words and literals — quote the whole object (spec §4.3)')
}

/** Parses `verb [NOT] payload metadata` — a continuation body (spec §8.3). */
export const parseBody = (tokens: readonly Token[], comment?: string): Result<Ast.Body> => {
  const [head, ...rest] = tokens
  if (head === undefined || head.kind !== 'word' || !Verb.isVerbToken(head.text)) {
    return fail(`expected an UPPERCASE verb, got ${JSON.stringify(head?.text ?? 'end of line')}`)
  }
  const verb = head.text
  const negated = rest[0]?.kind === 'word' && rest[0].text === 'NOT'
  const afterNot = negated ? rest.slice(1) : rest
  const { payload, meta } = splitAtMeta(afterNot)
  const payloadResult = parsePayload(verb, payload)
  if (!payloadResult.ok) {
    return payloadResult
  }
  const parsedMeta = parseMeta(meta, comment)
  return ok(
    { verb, negated, payload: payloadResult.value, meta: parsedMeta.meta },
    [...payloadResult.problems, ...parsedMeta.problems]
  )
}

/** Parses `subject verb [NOT] payload metadata` — a full claim line (spec §16). */
export const parseClaim = (tokens: readonly Token[], comment?: string): Result<Ast.Full> => {
  const [head, ...rest] = tokens
  if (head === undefined) {
    return fail('empty claim line')
  }
  if (isMetaStart(head)) {
    return fail(`expected a subject, got ${JSON.stringify(head.text)}`)
  }
  const body = parseBody(rest, comment)
  if (!body.ok) {
    return body
  }
  return ok({ subject: term(head), ...body.value }, body.problems)
}

const isComparisonOp = (text: string): text is Ast.ComparisonOp =>
  (['>', '<', '>=', '<=', '=', '!='] as const).includes(text as Ast.ComparisonOp)

/**
 * Parses a qualifier payload (spec §8.2): a full claim, a comparison, or a
 * bare entity — tried in that order.
 */
export const parseQualifierPayload = (tokens: readonly Token[], comment?: string): Result<Ast.QualifierPayload> => {
  const negated = tokens[0]?.kind === 'word' && tokens[0].text === 'NOT'
  const rest = negated ? tokens.slice(1) : tokens
  const [head, second] = rest
  if (head === undefined) {
    return fail('empty qualifier payload')
  }
  if (
    second?.kind === 'word' &&
    Verb.isVerbToken(second.text) &&
    second.text !== 'NOT' &&
    !isMetaStart(head)
  ) {
    const claim = parseClaim(rest, comment)
    if (!claim.ok) {
      return claim
    }
    return ok({ kind: 'claim', negated, claim: claim.value }, claim.problems)
  }
  if (second?.kind === 'word' && isComparisonOp(second.text)) {
    const { payload, meta } = splitAtMeta(rest.slice(2))
    const value = valueOf(payload)
    if (value === undefined) {
      return fail(`missing value after comparison operator ${second.text}`)
    }
    const parsedMeta = parseMeta(meta, comment)
    return ok(
      { kind: 'comparison', negated, left: term(head), op: second.text, value, meta: parsedMeta.meta },
      parsedMeta.problems
    )
  }
  if (isMetaStart(head)) {
    return fail(`expected qualifier payload, got ${JSON.stringify(head.text)}`)
  }
  const parsedMeta = parseMeta(rest.slice(1), comment)
  if (rest.length > 1 && !isMetaStart(rest[1]!)) {
    return fail('cannot parse qualifier payload as claim, comparison or entity')
  }
  return ok(
    { kind: 'entity', negated, term: term(head), meta: parsedMeta.meta },
    parsedMeta.problems
  )
}
