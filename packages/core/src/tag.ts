/**
 * Tags — flat `#tag` and scoped `#key:value` (spec §6.2).
 *
 * A flat `#security` is `key=security, value=undefined`; a scoped
 * `#topic:auth-security` splits on the first `:`. Scoped tags subsume flat
 * tags — a flat `#tag` is simply a tag with null value.
 *
 * Tags classify the claim, not the entity, and carry no independent belief
 * history (the two-lane rule, spec §11.1).
 */

export type Tag = {
  readonly key: string
  /** `undefined` for flat tags; spec stores NULL (spec §13.2). */
  readonly value?: string
}

export type t = Tag

/** @returns tag from key and optional scoped value. */
export const of = (key: string, value?: string): Tag =>
  value === undefined ? { key } : { key, value }

/**
 * Splits a tag body (without the leading `#`) on the first `:`
 * (spec §6.2 disambiguation): `topic:auth-security` → scoped,
 * `security` → flat.
 */
export const parse = (body: string): Tag => {
  const colonAt = body.indexOf(':')
  return colonAt === -1 ?
    { key: body } :
    { key: body.slice(0, colonAt), value: body.slice(colonAt + 1) }
}

/** @returns canonical `#key[:value]` text. */
export const format = (tag: Tag): string =>
  tag.value === undefined ? `#${tag.key}` : `#${tag.key}:${tag.value}`

/** @returns `true` when both tags have the same key and value. */
export const equals = (a: Tag, b: Tag): boolean =>
  a.key === b.key && a.value === b.value
