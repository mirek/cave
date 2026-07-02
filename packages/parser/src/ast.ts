/**
 * CAVE abstract syntax (spec §16).
 *
 * The parser turns text into `Line` values — pure syntax, before
 * canonicalization. Inverse verbs are *not* resolved here (`packages/api
 * PART-OF monorepo` parses with verb `PART-OF`); continuation lines keep
 * their missing endpoint; qualifier payloads keep their surface shape.
 * `@cave/canonical` applies the spec §13.4 pipeline on top of this AST.
 */

import type { Claim, Value, Tag, Context, Verb } from '@cave/core'

/** Line metadata suffixes (spec §6), all optional. */
export type Meta = {
  readonly contexts: readonly Context.t[]
  readonly tags: readonly Tag.t[]
  /** `@ N%` as decimal; `undefined` means the default 100%. */
  readonly conf?: number
  readonly importance: boolean
  /** `+/- delta` (spec §7.2). */
  readonly delta?: Value.t
  /** `(Nσ)` override (spec §7.2). */
  readonly sigmaLevel?: number
  /** `; comment` (spec §6.4). */
  readonly comment?: string
}

/** Empty metadata. */
export const emptyMeta: Meta =
  { contexts: [], tags: [], importance: false }

/** Claim body without a subject — what a continuation line carries (spec §8.3). */
export type Body = {
  readonly verb: string
  readonly negated: boolean
  readonly payload: Claim.Payload
  readonly meta: Meta
}

/** Full claim: subject + body. */
export type Full = Body & {
  readonly subject: Claim.Term
}

/** Comparison operators accepted in qualifier payloads (`WHEN load > ~1000 req/s`). */
export type ComparisonOp = '>' | '<' | '>=' | '<=' | '=' | '!='

export const comparisonOps: readonly ComparisonOp[] =
  ['>', '<', '>=', '<=', '=', '!=']

/**
 * Qualifier payload (spec §8.2). The grammar leaves `qualifier_payload`
 * loose; three surface shapes cover the spec's examples:
 *
 * - full claim:  `WHEN memory-leak EXISTS @ 60%`
 * - bare entity: `WHEN cache-miss`, `WHEN NOT cache/enabled`
 * - comparison:  `WHEN load > ~1000 req/s`
 *
 * `negated` records a `NOT` immediately after the qualifier verb.
 */
export type QualifierPayload =
  | { readonly kind: 'claim', readonly negated: boolean, readonly claim: Full }
  | { readonly kind: 'entity', readonly negated: boolean, readonly term: Claim.Term, readonly meta: Meta }
  | { readonly kind: 'comparison', readonly negated: boolean, readonly left: Claim.Term, readonly op: ComparisonOp, readonly value: Value.t, readonly meta: Meta }

/**
 * A parsed line. `depth` is the indentation width in characters; `parent` is
 * the index (into the document's `lines`) of the nearest less-indented
 * structural line above (spec §8). `raw` is the line exactly as written.
 */
export type Line =
  | { readonly kind: 'blank', readonly line: number, readonly raw: string }
  | { readonly kind: 'comment', readonly line: number, readonly raw: string, readonly text: string }
  | { readonly kind: 'claim', readonly line: number, readonly raw: string, readonly depth: number, readonly parent?: number, readonly claim: Full }
  | { readonly kind: 'continuation', readonly line: number, readonly raw: string, readonly depth: number, readonly parent?: number, readonly body: Body }
  | { readonly kind: 'qualifier', readonly line: number, readonly raw: string, readonly depth: number, readonly parent?: number, readonly qualifier: Verb.Qualifier, readonly payload: QualifierPayload }
  | { readonly kind: 'invalid', readonly line: number, readonly raw: string, readonly message: string }

export type t = Line

/** Parser problem tied to a 1-based line number. */
export type Diagnostic = {
  readonly line: number
  readonly message: string
  readonly raw: string
}

/** Parsed document: every input line classified, plus collected problems. */
export type Document = {
  readonly lines: readonly Line[]
  readonly diagnostics: readonly Diagnostic[]
}
