/**
 * Canonical emitter.
 *
 * Emits canonical CAVE text from canonical claims: colon attribute form
 * (§3.4 — emitters MUST produce it), primary verb direction (§5.5),
 * `WHEN NOT` rather than `UNLESS` (§8.2), metadata in the §3.2 anatomy
 * order. Qualifier edges re-indent under their parent; grouped claims
 * (`QUALIFIES` edges) re-indent as full lines.
 */

import { Claim, Confidence, Entity, Tag, Uncertainty, Value, Verb } from '@cavelang/core'
import { parseDocument, Token, Line } from '@cavelang/parser'
import type * as Canonicalize from './canonicalize.ts'

const checkLiteral = (kind: string, text: string): void => {
  if (typeof text !== 'string') throw new TypeError('CAVE term and value text must be a string')
  const delimiter = kind === 'text' ? '"' : kind === 'code' ? '`' : undefined
  if (delimiter !== undefined && text.includes(delimiter)) {
    throw new TypeError(`CAVE ${kind} literal cannot contain its own delimiter`)
  }
}

const termText = (term: Claim.Term): string => {
  if (term.kind !== 'entity' && term.kind !== 'text' && term.kind !== 'code') {
    throw new TypeError('CAVE term kind must be entity, text or code')
  }
  checkLiteral(term.kind, term.text)
  return Claim.formatTerm(term)
}

// Letter/underscore-led names exclude numeric/date prefixes and payload syntax.
// The separate NOT check retains the only bare negation token in this subset.
const simpleObject = /^[A-Za-z_][A-Za-z0-9_./-]*(?![\s\S])/

// This subset cannot contain token separators, literal delimiters, comments or metadata.
const simpleSubject = /^[A-Za-z0-9_][A-Za-z0-9_./:-]*(?![\s\S])/

const subjectText = (subject: Claim.Term): string => {
  if (subject.kind === 'entity') {
    if (typeof subject.text !== 'string') throw new TypeError('CAVE entity subject must be one non-metadata atom')
    if (!simpleSubject.test(subject.text)) {
      const head = Token.splitComment(subject.text).head
      const tokens = Token.tokenize(head)
      const token = tokens[0]
      if (head !== subject.text || tokens.length !== 1 || token?.kind !== 'word' ||
          token.text !== subject.text || Line.isMetaStart(token)) {
        throw new TypeError('CAVE entity subject must be one non-metadata atom; use a text or code literal')
      }
    }
  }
  return termText(subject)
}

const valueText = (value: Value.t): string => {
  checkLiteral(value.kind, value.raw)
  const parsed = value.kind === 'text' ? Value.ofText(value.raw) :
    value.kind === 'code' ? Value.ofCode(value.raw) : Value.parse(value.raw)
  if (value.kind !== parsed.kind || value.approx !== parsed.approx ||
      value.num !== parsed.num || value.from !== parsed.from || value.to !== parsed.to || value.unit !== parsed.unit) {
    throw new TypeError('CAVE value fields must agree with their emitted raw text')
  }
  if (value.kind !== 'text' && value.kind !== 'code') {
    const tokens = Token.tokenize(value.raw)
    if (tokens.length === 0 || tokens.some(token => token.kind !== 'word' || Line.isMetaStart(token)) ||
        tokens.map(token => token.text).join(' ') !== value.raw) {
      throw new TypeError('CAVE unquoted value must retain its text and remain outside metadata; use a text or code literal')
    }
  }
  return Value.format(value)
}

const attributeText = (attribute: string): string => {
  const text = `${attribute}:`
  const head = Token.splitComment(text).head
  const tokens = Token.tokenize(head), token = tokens[0]
  if (typeof attribute !== 'string' || attribute.length === 0 || head !== text ||
      tokens.length !== 1 || token?.kind !== 'word' || token.text !== text || Line.isMetaStart(token)) {
    throw new TypeError('CAVE attribute name must retain one non-metadata word before its value')
  }
  return text
}

const payloadText = (payload: Claim.Payload): undefined | string => {
  switch (payload.kind) {
    case 'relation':
      return termText(payload.object)
    case 'attribute':
      return `${attributeText(payload.attribute)} ${valueText(payload.value)}`
    case 'metric':
      return valueText(payload.value)
    case 'none':
      return undefined
    default:
      throw new TypeError('CAVE payload kind must be relation, attribute, metric or none')
  }
}

const metadataWord = (text: string): string => {
  const head = Token.splitComment(text).head
  const tokens = Token.tokenize(head), token = tokens[0]
  if (head !== text || tokens.length !== 1 || token?.kind !== 'word' || token.text !== text || text === '@' || text === '#') {
    throw new TypeError('CAVE metadata must retain one nonempty context or tag token')
  }
  return text
}

const metaText = (claim: Claim.t): string[] => {
  for (const name of ['contexts', 'tags'] as const) {
    if (!Array.isArray(claim[name])) throw new TypeError(`CAVE claim ${name} must be an array`)
  }
  const parts: string[] = []
  if (claim.delta !== undefined) {
    Uncertainty.validateDelta(claim.delta.num)
    parts.push(`+/- ${valueText(claim.delta)}`)
  }
  if (claim.sigmaLevel !== undefined) {
    parts.push(`(${Value.formatNumber(Uncertainty.validateSigmaLevel(claim.sigmaLevel))}σ)`)
  }
  for (const context of claim.contexts) {
    if (typeof context !== 'string') throw new TypeError('CAVE context metadata must be a string')
    parts.push(metadataWord(`@${context}`))
  }
  for (const tag of claim.tags) {
    const text = metadataWord(Tag.format(tag))
    if (!Tag.equals(Tag.parse(text.slice(1)), tag)) throw new TypeError('CAVE tag must retain its key and value through emission')
    parts.push(text)
  }
  if (claim.conf !== 1) {
    parts.push(`@ ${Confidence.formatExact(claim.conf)}`)
  }
  if (claim.importance) {
    parts.push('!')
  }
  return parts
}

const singleLine = (line: string): string => {
  if (line.includes('\n')) throw new TypeError('CAVE claim fields cannot contain a newline; use comment lines for multiline commentary')
  if (/["`;]/.test(line) && Token.splitComment(`${line};`).head !== line) {
    throw new TypeError('CAVE claim fields must not open a comment or leave an unmatched literal delimiter')
  }
  return line
}

const validateFlags = (claim: Claim.t): void => {
  for (const name of ['negated', 'importance'] as const) {
    if (typeof claim[name] !== 'boolean') throw new TypeError(`CAVE claim ${name} must be a boolean`)
  }
}

/** @returns the canonical claim line without its comment. */
const claimLine = (claim: Claim.t): string => {
  validateFlags(claim)
  if (typeof claim.verb !== 'string' || !Verb.isVerbToken(claim.verb)) throw new TypeError('CAVE claim verb must be an uppercase atom')
  if (claim.payload.kind === 'none' && claim.verb !== 'EXISTS') throw new TypeError('CAVE claim requires an object or value payload unless its verb is EXISTS')
  const parts = [subjectText(claim.subject), claim.verb]
  if (claim.negated) {
    parts.push('NOT')
  }
  const payload = payloadText(claim.payload)
  if (payload !== undefined) {
    parts.push(payload)
  }
  for (const metadata of metaText(claim)) parts.push(metadata)
  const line = singleLine(parts.join(' '))
  if (claim.payload.kind === 'metric' && !['number', 'date', 'trajectory'].includes(claim.payload.value.kind)) {
    throw new TypeError('CAVE metric payload requires a number, date or trajectory; use a relation or attribute for other values')
  }
  if (claim.payload.kind === 'relation' && claim.payload.object.kind === 'entity' &&
      (claim.payload.object.text === 'NOT' || !simpleObject.test(claim.payload.object.text))) {
    const parsed = Line.parseBody(Token.tokenize(`${claim.verb} ${payload}`))
    if (!parsed.ok || parsed.problems.length > 0 || parsed.value.negated ||
        parsed.value.payload.kind !== 'relation' || parsed.value.payload.object.kind !== 'entity' ||
        Entity.normalize(parsed.value.payload.object.text) !== Entity.normalize(claim.payload.object.text)) {
      throw new TypeError('CAVE entity relation object must retain its payload identity; use an explicit value or literal when needed')
    }
  }
  return line
}

const fullClaimLine = (claim: Claim.t): string => {
  const line = claimLine(claim)
  if (claim.subject.kind === 'entity' && Verb.isVerbToken(claim.subject.text) &&
      parseDocument(line).lines[0]?.kind !== 'claim') return `@claim ${line}`
  return line
}

/**
 * @returns the canonical text of one claim (no indentation): a single line,
 * or — when the comment spans several lines (§6.4) — its leading comment
 * lines above the claim line, the last comment line riding on the claim.
 */
export const emitClaim = (claim: Claim.t): string =>
  Token.joinComment(fullClaimLine(claim), claim.comment)

/**
 * @returns the qualifier-payload text of a condition claim. Negation
 * normally emits as a `NOT` *prefix* — the §8.2 canonical `WHEN NOT x` shape —
 * rather than the claim-internal `VERB NOT` form: a postfix `NOT` after a symbolic
 * comparison verb (`WHEN cpu >= NOT 900`) would be unreadable to the
 * parser and silently invert the condition on round trip. The reserved entity
 * name NOT uses an explicit claim marker for an affirmative condition, as does
 * a condition whose verb is NOT.
 */
const conditionText = (claim: Claim.t): string => {
  validateFlags(claim)
  // A leading entity named NOT would be consumed as qualifier negation.
  // An explicit full claim preserves its affirmative reading and also allows
  // NOT in the verb position, which unmarked qualifier parsing excludes.
  if (claim.verb === 'NOT' || (claim.subject.kind === 'entity' && claim.subject.text === 'NOT' && !claim.negated)) {
    const body = `@claim ${claimLine({ ...claim, negated: false })}`
    return claim.negated ? `NOT ${body}` : body
  }
  const body = claim.verb === 'EXISTS' && claim.payload.kind === 'none' ?
    singleLine([subjectText(claim.subject), ...metaText(claim)].join(' ')) :
    claimLine({ ...claim, negated: false })
  return claim.negated ? `NOT ${body}` : body
}

/**
 * A transaction annotation (spec §28.4): the full-line comment placed
 * immediately above a claim line to carry its transaction id through
 * canonical text. Annotation lines are transparent to the grammar (§8) and
 * to the comment block above a claim (§6.4), so annotated text reads
 * unchanged everywhere; sync-aware readers pair each annotation with the
 * claim line below it.
 */
export const txComment = (tx: string): string =>
  `;@ ${tx}`

/**
 * @returns the transaction id carried by a raw line when it is a §28.4
 * annotation (`;@ <tx>`), `undefined` otherwise. Purely lexical — the
 * caller validates the id shape.
 */
export const txOfLine = Token.txOfLine

/** Optional annotation payload, interpreted by the interchange reader. */
export const txDataOfLine = Token.txDataOfLine

export type EmitOptions = {
  /**
   * Per-claim annotation lines (spec §28.4): when defined for a claim
   * index, the returned text is emitted verbatim as its own line directly
   * above that claim, at the claim's indentation. Used by tx-carrying
   * export ({@link txComment}); return `undefined` to annotate nothing.
   * Called in depth-first appearance order, including every re-statement
   * of a shared or cyclic claim. Repeated appearances use the same index;
   * return a stable transaction identity for that index when enabling replay.
   */
  readonly annotate?: (index: number) => undefined | string
}

type RenderNode = {
  readonly index: number
  readonly tokens: readonly string[]
  readonly comment?: string
  readonly annotation?: string
  readonly children: readonly RenderNode[]
}

type RenderItem = {
  readonly node: RenderNode
  readonly tokens: readonly string[]
}

const tokenText = (token: Token.t): string => {
  switch (token.kind) {
    case 'text':
      return `"${token.text}"`
    case 'code':
      return `\`${token.text}\``
    case 'word':
      return token.text
  }
}

const commonPrefixLength = (items: readonly RenderItem[]): number => {
  const shortest = items.reduce((minimum, item) => Math.min(minimum, item.tokens.length), Infinity)
  let length = 0
  while (
    length < shortest &&
    items.every(item => item.tokens[length] === items[0]!.tokens[length])
  ) {
    length += 1
  }
  return length
}

/**
 * A factored header is safe only while the accumulated text is not itself a
 * materialized claim. This is the compatibility boundary with §8's existing
 * indentation: complete lines keep qualifier/continuation/grouping meaning;
 * incomplete lines may be shorthand prefixes (§8.5).
 */
const isIncomplete = (tokens: readonly string[], topLevel: boolean): boolean => {
  const text = tokens.join(' ')
  const document = parseDocument(topLevel ? text : `cave-root IS claim\n  ${text}`)
  return document.lines[document.lines.length - 1]!.kind === 'invalid'
}

const emitForest = (
  forest: readonly RenderItem[],
  depth: number,
  topLevel: boolean,
  inherited: readonly string[],
  lines: string[]
): void => {
  const stack = [{ forest, depth, topLevel, inherited, at: 0, runEnd: 0, canFactor: undefined as boolean | undefined }]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!
    const { forest, depth, topLevel, inherited, at } = frame
    if (at >= forest.length) {
      stack.pop()
      continue
    }
    const firstToken = forest[at]!.tokens[0]
    if (at >= frame.runEnd) {
      frame.canFactor = undefined
      frame.runEnd = at + 1
      while (frame.runEnd < forest.length && forest[frame.runEnd]!.tokens[0] === firstToken) {
        frame.runEnd += 1
      }
    }
    const end = frame.runEnd
    // A one-token line cannot lose a prefix and still retain a leaf token.
    // Every suffix shares this first token. If it already completes a claim,
    // none can form a safe header, so avoid copying and scanning each suffix.
    if (end - at > 1 && forest[at]!.tokens.length > 1 &&
        (frame.canFactor ??= isIncomplete([...inherited, firstToken!], topLevel))) {
      const run = forest.slice(at, end)
      const common = commonPrefixLength(run)
      const shortest = run.reduce((minimum, item) => Math.min(minimum, item.tokens.length), Infinity)
      const maximum = Math.min(common, shortest - 1)
      let safe = 0
      for (let length = 1; length <= maximum; length += 1) {
        const candidate = [...inherited, ...run[0]!.tokens.slice(0, length)]
        if (!isIncomplete(candidate, topLevel)) {
          break
        }
        safe = length
      }
      if (safe > 0) {
        const prefix = run[0]!.tokens.slice(0, safe)
        lines.push(`${'  '.repeat(depth)}${prefix.join(' ')}`)
        frame.at = end
        stack.push({
          forest: run.map(item => ({ node: item.node, tokens: item.tokens.slice(safe) })),
          depth: depth + 1,
          topLevel,
          inherited: [...inherited, ...prefix],
          at: 0,
          runEnd: 0,
          canFactor: undefined
        })
        continue
      }
    }

    const item = forest[at]!
    const indent = '  '.repeat(depth)
    // A multi-line comment (§6.4) opens above the claim line; the §28.4
    // annotation stays the line directly above the claim.
    const rendered = Token.joinComment(item.tokens.join(' '), item.node.comment).split('\n')
    const last = rendered.pop()!
    for (const line of rendered) lines.push(`${indent}${line}`)
    if (item.node.annotation !== undefined) {
      lines.push(`${indent}${item.node.annotation}`)
    }
    lines.push(`${indent}${last}`)
    frame.at += 1
    if (item.node.children.length > 0) {
      stack.push({
        forest: item.node.children.map(node => ({ node, tokens: node.tokens })),
        depth: depth + 1,
        topLevel: false,
        inherited: [],
        at: 0,
        runEnd: 0,
        canFactor: undefined
      })
    }
  }
}

/**
 * Emits a whole canonicalization result as canonical CAVE text: top-level
 * claims in claim order, children indented two spaces per level.
 *
 * Edges form a graph, text forms a tree, and the reconciliation is the
 * *re-statement*: a claim's own children render exactly once — at its
 * first appearance — and every later appearance (a row cited by several
 * parents, §24.3 shared premises and `VIA` rules; or a §24.5 support
 * cycle) is the claim line alone, restating the row to carry that one
 * edge. With annotations the repeats share one id, so replay unions them
 * back into a single row (§28.4); a component with no top-level member
 * (a pure cycle) is emitted from its first claim, the cycle breaking at
 * the re-statement.
 */
export const emit = (result: Pick<Canonicalize.Result, 'claims' | 'edges'>, options: EmitOptions = {}): string => {
  if (!Array.isArray(result.claims)) throw new TypeError('CAVE claims must be a dense array')
  for (let index = 0; index < result.claims.length; index++) {
    if (!Object.hasOwn(result.claims, index)) throw new TypeError('CAVE claims must be a dense array')
  }
  const childEdges = new Map<number, Canonicalize.Edge[]>()
  const isChild = new Set<number>()
  for (const { parent, child, role } of result.edges) {
    for (const [field, index] of [['parent', parent], ['child', child]] as const) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= result.claims.length) {
        throw new TypeError(`CAVE edge ${field} must index an existing claim`)
      }
    }
    if (role !== 'WHEN' && role !== 'VIA' && role !== 'BECAUSE' && role !== 'QUALIFIES') {
      throw new TypeError('CAVE edge role must be WHEN, VIA, BECAUSE or QUALIFIES')
    }
    const edge = { parent, child, role }
    isChild.add(edge.child)
    const existing = childEdges.get(edge.parent)
    if (existing === undefined) {
      childEdges.set(edge.parent, [edge])
    } else {
      existing.push(edge)
    }
  }
  const expanded = new Set<number>()
  const nodeAt = (index: number, role: undefined | Canonicalize.EdgeRole): RenderNode => {
    const roots: RenderNode[] = []
    const pending: { index: number, role: undefined | Canonicalize.EdgeRole, target: RenderNode[] }[] =
      [{ index, role, target: roots }]
    while (pending.length > 0) {
      const { index, role, target } = pending.pop()!
      const { claim } = result.claims[index]!
      const text = role === undefined || role === 'QUALIFIES' ?
        fullClaimLine(claim) : `${role} ${conditionText(claim)}`
      const tokens = Token.tokenize(text).map(tokenText)
      const annotation = options.annotate?.(index)
      const children: RenderNode[] = []
      target.push({
        index,
        tokens,
        ...claim.comment === undefined ? {} : { comment: claim.comment },
        ...annotation === undefined ? {} : { annotation },
        children
      })
      if (expanded.has(index)) continue
      expanded.add(index)
      const edges = childEdges.get(index) ?? []
      for (let at = edges.length - 1; at >= 0; at--) {
        const edge = edges[at]!
        pending.push({ index: edge.child, role: edge.role, target: children })
      }
    }
    return roots[0]!
  }
  const forest: RenderNode[] = []
  result.claims.forEach((_, index) => {
    if (!isChild.has(index)) {
      forest.push(nodeAt(index, undefined))
    }
  })
  result.claims.forEach((_, index) => {
    if (!expanded.has(index)) {
      forest.push(nodeAt(index, undefined))
    }
  })
  const lines: string[] = []
  emitForest(forest.map(node => ({ node, tokens: node.tokens })), 0, true, [], lines)
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
