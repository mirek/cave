/** Stable source-line provenance carried by `src:` contexts (spec §9.8). */

import type { Context } from './context.ts'

export type LineSpan = {
  /** One-based first source line. */
  readonly startLine: number
  /** One-based inclusive last source line. */
  readonly endLine: number
}

export type Reference = {
  /** Canonical stored context, without the leading `@`. */
  readonly context: Context
  /** Decoded underlying source identity, without the line fragment. */
  readonly source: string
  readonly span?: LineSpan
  /** Human-facing source plus line fragment. */
  readonly location: string
  /** Navigable location when the source is an HTTP(S) URL. */
  readonly href?: string
}

const lineFragment = (span: LineSpan): string =>
  span.startLine === span.endLine ? `L${span.startLine}` : `L${span.startLine}-L${span.endLine}`

const validSpan = (span: LineSpan): boolean =>
  Number.isInteger(span.startLine) && Number.isInteger(span.endLine) &&
  span.startLine >= 1 && span.endLine >= span.startLine

/** Percent-escape a source while keeping readable path and URL separators. */
export const escape = (source: string): string =>
  encodeURIComponent(source)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replaceAll('%2F', '/')
    .replaceAll('%3A', ':')

/** Reverse {@link escape}; malformed percent encodings are rejected. */
export const unescape = (source: string): undefined | string => {
  try {
    return decodeURIComponent(source)
  } catch {
    return undefined
  }
}

/** Build a canonical `src:` context from a source and optional line span. */
export const context = (source: string, span?: LineSpan): Context => {
  if (source === '') {
    throw new Error('source must not be empty')
  }
  if (span !== undefined && !validSpan(span)) {
    throw new Error(`invalid source line span ${JSON.stringify(span)}`)
  }
  return `src:${escape(source)}${span === undefined ? '' : `#${lineFragment(span)}`}`
}

/** Parse one canonical source context, preserving an unspanned source too. */
export const parse = (value: Context): undefined | Reference => {
  if (!value.startsWith('src:')) {
    return undefined
  }
  const payload = value.slice(4)
  const hashAt = payload.indexOf('#')
  const encodedSource = hashAt === -1 ? payload : payload.slice(0, hashAt)
  const fragment = hashAt === -1 ? undefined : payload.slice(hashAt + 1)
  const match = fragment === undefined ? undefined : /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(fragment)
  if (encodedSource === '' || (fragment !== undefined && match === null)) {
    return undefined
  }
  const source = unescape(encodedSource)
  if (source === undefined || escape(source) !== encodedSource) {
    return undefined
  }
  const start = match == null ? undefined : Number(match[1])
  const end = start === undefined || match == null ? undefined : Number(match[2] ?? match[1])
  const span = start === undefined ? undefined : { startLine: start, endLine: end! }
  if (span !== undefined && !validSpan(span)) {
    return undefined
  }
  const location = `${source}${span === undefined ? '' : `#${lineFragment(span)}`}`
  const href = /^https?:\/\//i.test(source) && !source.includes('#') ?
    `${encodeURI(source)}${span === undefined ? '' : `#${lineFragment(span)}`}` : undefined
  return {
    context: value,
    source,
    ...span === undefined ? {} : { span },
    location,
    ...href === undefined ? {} : { href }
  }
}

/** Parse every valid `src:` context, in authored order. */
export const ofContexts = (contexts: readonly Context[]): Reference[] =>
  contexts.flatMap(value => {
    const reference = parse(value)
    return reference === undefined ? [] : [reference]
  })
