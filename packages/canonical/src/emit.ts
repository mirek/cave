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
  const lines: string[] = []
  const expanded = new Set<number>()
  const emitAt = (index: number, depth: number, role: undefined | Canonicalize.EdgeRole): void => {
    const { claim } = result.claims[index]!
    const indent = '  '.repeat(depth)
    const annotation = options.annotate?.(index)
    if (annotation !== undefined) {
      lines.push(`${indent}${annotation}`)
    }
    if (role === undefined || role === 'QUALIFIES') {
      lines.push(`${indent}${emitClaim(claim)}`)
    } else {
      lines.push(`${indent}${role} ${conditionText(claim)}`)
    }
    if (expanded.has(index)) {
      return
    }
    expanded.add(index)
    for (const edge of childEdges.get(index) ?? []) {
      emitAt(edge.child, depth + 1, edge.role)
    }
  }
  result.claims.forEach((_, index) => {
    if (!isChild.has(index)) {
      emitAt(index, 0, undefined)
    }
  })
  result.claims.forEach((_, index) => {
    if (!expanded.has(index)) {
      emitAt(index, 0, undefined)
    }
  })
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
