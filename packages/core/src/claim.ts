/**
 * Claims — the CAVE model (spec §2.1).
 *
 * Every CAVE line denotes a claim c = ⟨s, v, o, n, m⟩: subject, verb,
 * object-or-attribute/value, negated, metadata (confidence, contexts, tags,
 * value uncertainty, importance, comment, transaction identity). Claims are
 * immutable — belief changes by appending (spec §9).
 *
 * This module defines the *canonical* claim shape: subject/verb/object are in
 * primary direction (inverse forms are normalized before keying, spec §5.5),
 * with the author's original text preserved in `raw`.
 */

import * as Value from './value.ts'
import * as Tag from './tag.ts'
import * as Context from './context.ts'
import * as Confidence from './confidence.ts'
import * as Uncertainty from './uncertainty.ts'

/** Subject or object term (spec §16: atom, literal or code literal). */
export type TermKind = 'entity' | 'text' | 'code'

export type Term = {
  readonly kind: TermKind
  readonly text: string
}

/** @returns entity term. */
export const entity = (text: string): Term =>
  ({ kind: 'entity', text })

/** @returns double-quoted natural-language literal term. */
export const text = (value: string): Term =>
  ({ kind: 'text', text: value })

/** @returns backticked code literal term. */
export const code = (value: string): Term =>
  ({ kind: 'code', text: value })

/** @returns canonical text of a term with its delimiters. */
export const formatTerm = (term: Term): string => {
  switch (term.kind) {
    case 'text':
      return `"${term.text}"`
    case 'code':
      return `\`${term.text}\``
    default:
      return term.text
  }
}

/**
 * Claim payload — the canonical line shapes (spec §3.1) plus the object-less
 * form used by bare existence assertions (spec §5.2 `EXISTS`):
 *
 * - `relation`:  `subject VERB object`
 * - `attribute`: `subject HAS attribute: value`
 * - `metric`:    `metric IS value`
 * - `none`:      `memory-leak EXISTS @production`
 */
export type Payload =
  | { readonly kind: 'relation', readonly object: Term }
  | { readonly kind: 'attribute', readonly attribute: string, readonly value: Value.t }
  | { readonly kind: 'metric', readonly value: Value.t }
  | { readonly kind: 'none' }

/** Canonical (primary-direction) claim. */
export type Claim = {
  readonly subject: Term
  /** Canonical primary verb, uppercase (spec §13.4 steps 1–2). */
  readonly verb: string
  /** `VERB NOT` logical negation (spec §5.6). */
  readonly negated: boolean
  readonly payload: Payload
  /** Contexts in author order, deduplicated. */
  readonly contexts: readonly Context.t[]
  readonly tags: readonly Tag.t[]
  /** Epistemic confidence in [0, 1]; 1 when omitted (spec §6.3). */
  readonly conf: Confidence.t
  /** `!` marker (spec §6). */
  readonly importance: boolean
  /** `+/-` value uncertainty (spec §7.2). */
  readonly delta?: Value.t
  /** `(Nσ)` σ-level override; semantic default is 2 (spec §7.2). */
  readonly sigmaLevel?: number
  /** `;` persisted prose (spec §6.4). */
  readonly comment?: string
  /** The line exactly as written, including inverse form (spec §5.5). */
  readonly raw: string
}

export type t = Claim

export type Init = {
  subject: Term
  verb: string
  payload: Payload
  negated?: boolean
  contexts?: readonly Context.t[]
  tags?: readonly Tag.t[]
  conf?: Confidence.t
  importance?: boolean
  delta?: Value.t
  sigmaLevel?: number
  comment?: string
  raw?: string
}

/** @returns claim with defaults applied (spec §6: all suffixes optional). */
export const of = (init: Init): Claim => {
  if (init.delta !== undefined) Uncertainty.validateDelta(init.delta.num)
  if (init.sigmaLevel !== undefined) Uncertainty.validateSigmaLevel(init.sigmaLevel)
  return {
    subject: init.subject,
    verb: init.verb,
    negated: init.negated ?? false,
    payload: init.payload,
    contexts: Context.dedupe(init.contexts ?? []),
    tags: init.tags ?? [],
    conf: init.conf ?? Confidence.defaultConfidence,
    importance: init.importance ?? false,
    ...init.delta !== undefined ? { delta: init.delta } : {},
    ...init.sigmaLevel !== undefined ? { sigmaLevel: init.sigmaLevel } : {},
    ...init.comment !== undefined ? { comment: init.comment } : {},
    raw: init.raw ?? ''
  }
}

/** @returns relational claim payload. */
export const relation = (object: Term): Payload =>
  ({ kind: 'relation', object })

/** @returns attribute/value claim payload. */
export const attribute = (attribute: string, value: Value.t): Payload =>
  ({ kind: 'attribute', attribute, value })

/** @returns metric claim payload. */
export const metric = (value: Value.t): Payload =>
  ({ kind: 'metric', value })

/** Object-less payload — bare existence assertion (spec §5.2 `EXISTS`). */
export const none: Payload =
  { kind: 'none' }

/**
 * σ derived from the claim's `+/- Δ (kσ)` metadata: σ = Δ / k with k
 * defaulting to 2 (spec §7.2). `undefined` when the claim carries no numeric
 * uncertainty.
 */
export const sigmaOf = (claim: Claim): undefined | number =>
  claim.delta?.num === undefined ?
    undefined :
    Uncertainty.sigma(claim.delta.num, claim.sigmaLevel)
