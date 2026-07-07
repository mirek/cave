/**
 * Contexts — `@ctx` (spec §6.1).
 *
 * A context scopes a claim by time, place, source or logical scope:
 * `@production`, `@2026-Q1`, `@auth.ts:42`, `@src:filing`. No space after
 * `@` (with a space it is confidence, spec §6.3). Multiple contexts per
 * claim are allowed and are part of the claim key (spec §9.2).
 */

export type Context = string

export type t = Context

/** Recommended context prefixes (spec §6.1). */
export const prefixes = ['src', 'time', 'loc', 'scope'] as const

export type Prefix = (typeof prefixes)[number]

const prefixSet = new Set<string>(prefixes)

/**
 * @returns the recommended prefix of a context, when it has one:
 * `src:filing` → `src`, `production` → `undefined`.
 */
export const prefix = (context: Context): undefined | Prefix => {
  const colonAt = context.indexOf(':')
  if (colonAt === -1) {
    return undefined
  }
  const head = context.slice(0, colonAt)
  return prefixSet.has(head) ? head as Prefix : undefined
}

/** @returns canonical `@ctx` text. */
export const format = (context: Context): string =>
  `@${context}`

/** @returns `src:`-prefixed source context for an actor: `cli` → `src:cli`. */
export const source = (actor: string): Context =>
  `src:${actor}`

/** @returns whether any context is a `src:` source context (spec §9.5). */
export const hasSource = (contexts: readonly Context[]): boolean =>
  contexts.some(context => prefix(context) === 'src')

/**
 * @returns deduplicated contexts in original order. Claim keys use the
 * sorted form (see `Key`); emission preserves author order.
 */
export const dedupe = (contexts: readonly Context[]): Context[] =>
  [...new Set(contexts)]
