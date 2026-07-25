/**
 * Canonical emitter.
 *
 * Emits canonical CAVE text from canonical claims: colon attribute form
 * (§3.4 — emitters MUST produce it), primary verb direction (§5.5),
 * `WHEN NOT` rather than `UNLESS` (§8.2), metadata in the §3.2 anatomy
 * order. Qualifier edges re-indent under their parent; grouped claims
 * (`QUALIFIES` edges) re-indent as full lines.
 */

import { Claim, Confidence, Tag, Value } from '@cavelang/core'
import { parseDocument, Token } from '@cavelang/parser'
import type * as Canonicalize from './canonicalize.ts'

const payloadText = (payload: Claim.Payload): undefined | string => {
  switch (payload.kind) {
    case 'relation':
      return Claim.formatTerm(payload.object)
    case 'attribute':
      return `${payload.attribute}: ${Value.format(payload.value)}`
    case 'metric':
      return Value.format(payload.value)
    case 'none':
      return undefined
  }
}

const metaText = (claim: Claim.t): string[] => {
  const parts: string[] = []
  if (claim.delta !== undefined) {
    parts.push(`+/- ${Value.format(claim.delta)}`)
  }
  if (claim.sigmaLevel !== undefined) {
    parts.push(`(${claim.sigmaLevel}σ)`)
  }
  for (const context of claim.contexts) {
    parts.push(`@${context}`)
  }
  for (const tag of claim.tags) {
    parts.push(Tag.format(tag))
  }
  if (claim.conf !== 1) {
    parts.push(`@ ${Confidence.format(claim.conf)}`)
  }
  if (claim.importance) {
    parts.push('!')
  }
  if (claim.comment !== undefined) {
    parts.push(`; ${claim.comment}`)
  }
  return parts
}

/** @returns one canonical line for a claim (no indentation). */
export const emitClaim = (claim: Claim.t): string => {
  const parts = [Claim.formatTerm(claim.subject), claim.verb]
  if (claim.negated) {
    parts.push('NOT')
  }
  const payload = payloadText(claim.payload)
  if (payload !== undefined) {
    parts.push(payload)
  }
  parts.push(...metaText(claim))
  return parts.join(' ')
}

/**
 * @returns the qualifier-payload text of a condition claim. Negation always
 * emits as a `NOT` *prefix* — the §8.2 canonical `WHEN NOT x` shape — never
 * as the claim-internal `VERB NOT` form: a postfix `NOT` after a symbolic
 * comparison verb (`WHEN cpu >= NOT 900`) would be unreadable to the
 * parser and silently invert the condition on round trip.
 */
const conditionText = (claim: Claim.t): string => {
  const body = claim.verb === 'EXISTS' && claim.payload.kind === 'none' ?
    [Claim.formatTerm(claim.subject), ...metaText(claim)].join(' ') :
    emitClaim({ ...claim, negated: false })
  return claim.negated ? `NOT ${body}` : body
}

/**
 * A transaction annotation (spec §28.4): the full-line comment placed
 * immediately above a claim line to carry its transaction id through
 * canonical text. Comment lines are transparent to the grammar (§8), so
 * annotated text reads unchanged everywhere; sync-aware readers pair each
 * annotation with the claim line below it.
 */
export const txComment = (tx: string): string =>
  `;@ ${tx}`

const txLineRe = /^\s*;@\s+(\S+)\s*$/

/**
 * @returns the transaction id carried by a raw line when it is a §28.4
 * annotation (`;@ <tx>`), `undefined` otherwise. Purely lexical — the
 * caller validates the id shape.
 */
export const txOfLine = (raw: string): undefined | string =>
  txLineRe.exec(raw)?.[1]

export type EmitOptions = {
  /**
   * Per-claim annotation lines (spec §28.4): when defined for a claim
   * index, the returned text is emitted verbatim as its own line directly
   * above that claim, at the claim's indentation. Used by tx-carrying
   * export ({@link txComment}); return `undefined` to annotate nothing.
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

const renderParts = (text: string): { tokens: readonly string[], comment?: string } => {
  const split = Token.splitComment(text)
  return {
    tokens: Token.tokenize(split.head).map(tokenText),
    ...split.comment === undefined ? {} : { comment: split.comment }
  }
}

const commonPrefixLength = (items: readonly RenderItem[]): number => {
  const shortest = Math.min(...items.map(item => item.tokens.length))
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
  let at = 0
  while (at < forest.length) {
    const firstToken = forest[at]!.tokens[0]
    let end = at + 1
    while (end < forest.length && forest[end]!.tokens[0] === firstToken) {
      end += 1
    }
    const run = forest.slice(at, end)
    if (run.length > 1) {
      const common = commonPrefixLength(run)
      const shortest = Math.min(...run.map(item => item.tokens.length))
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
        emitForest(
          run.map(item => ({ node: item.node, tokens: item.tokens.slice(safe) })),
          depth + 1,
          topLevel,
          [...inherited, ...prefix],
          lines
        )
        at = end
        continue
      }
    }

    const item = forest[at]!
    const indent = '  '.repeat(depth)
    if (item.node.annotation !== undefined) {
      lines.push(`${indent}${item.node.annotation}`)
    }
    lines.push(
      `${indent}${item.tokens.join(' ')}${item.node.comment === undefined ? '' : ` ; ${item.node.comment}`}`
    )
    emitForest(
      item.node.children.map(node => ({ node, tokens: node.tokens })),
      depth + 1,
      false,
      [],
      lines
    )
    at += 1
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
  const childEdges = new Map<number, Canonicalize.Edge[]>()
  const isChild = new Set<number>()
  for (const edge of result.edges) {
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
    const { claim } = result.claims[index]!
    const text = role === undefined || role === 'QUALIFIES' ?
      emitClaim(claim) :
      `${role} ${conditionText(claim)}`
    const parts = renderParts(text)
    const annotation = options.annotate?.(index)
    if (expanded.has(index)) {
      return {
        index,
        tokens: parts.tokens,
        ...parts.comment === undefined ? {} : { comment: parts.comment },
        ...annotation === undefined ? {} : { annotation },
        children: []
      }
    }
    expanded.add(index)
    return {
      index,
      tokens: parts.tokens,
      ...parts.comment === undefined ? {} : { comment: parts.comment },
      ...annotation === undefined ? {} : { annotation },
      children: (childEdges.get(index) ?? []).map(edge => nodeAt(edge.child, edge.role))
    }
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
