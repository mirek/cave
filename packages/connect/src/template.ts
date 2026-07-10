/**
 * Mapping templates (spec §23.1) — an ordinary CAVE document whose `?field`
 * variables stand for record fields.
 *
 * Top-level blocks (a line plus its indented children) split by whether they
 * contain a variable: variable-free blocks form the **prelude** (verb
 * declarations, static claims — appended once per run), blocks with
 * variables are **record templates**, instantiated once per record.
 *
 * A variable is a whole whitespace-delimited token beginning with `?`;
 * tokens inside `"…"` and `` `…` `` literals are never substituted. A claim
 * line whose record lacks a referenced field is dropped together with its
 * indented children — optional fields simply yield fewer claims.
 */

import { Value, Verb } from '@cavelang/core'
import { parseDocument, Token } from '@cavelang/parser'

export type Mapping = {
  /** Variable-free blocks plus leading comments, joined — appended once per run. */
  readonly prelude: string
  /** Record templates: raw lines of each variable-bearing top-level block. */
  readonly templates: readonly (readonly string[])[]
  /** Distinct variable names referenced by the templates, sorted. */
  readonly variables: readonly string[]
}

export type t = Mapping

/** A field value substituted into one template slot. */
export type Formatted =
  | { readonly kind: 'ok', readonly text: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'problem', readonly message: string }

/** One record's instantiation of every template block. */
export type Instantiation = {
  /** Ready-to-ingest CAVE text; empty when every line dropped. */
  readonly text: string
  /** Claim lines dropped because a referenced field was missing/empty. */
  readonly dropped: number
  /** Formatting errors — a non-empty list fails the whole record (spec §23.2). */
  readonly problems: readonly string[]
}

const isVariable = (token: Token.t): boolean =>
  token.kind === 'word' && token.text.startsWith('?') && token.text.length > 1

const indentOf = (line: string): number =>
  line.length - line.trimStart().length

const isStructural = (line: string): boolean => {
  const body = line.trim()
  return body !== '' && !body.startsWith(';')
}

const lineVariables = (line: string): string[] =>
  Token.tokenize(Token.splitComment(line).head)
    .filter(isVariable)
    .map(token => token.text.slice(1))

/**
 * Parses a mapping document: lints it (variables parse as ordinary terms, so
 * diagnostics are real syntax problems), rejects variables in attribute
 * position (`?attr: …` would silently name an attribute `?attr`), and splits
 * top-level blocks into prelude and record templates.
 */
export const parse = (text: string): { mapping?: Mapping, problems: readonly string[] } => {
  const problems: string[] = []
  const document = parseDocument(text)
  for (const diagnostic of document.diagnostics) {
    problems.push(`mapping line ${diagnostic.line}: ${diagnostic.message}`)
  }
  const rawLines = text.split(/\r?\n/)
  rawLines.forEach((line, at) => {
    for (const token of Token.tokenize(Token.splitComment(line).head)) {
      if (token.kind === 'word' && /^\?.+:$/.test(token.text)) {
        problems.push(`mapping line ${at + 1}: variables cannot name attributes (${token.text})`)
      }
    }
  })
  if (problems.length > 0) {
    return { problems }
  }
  const blocks: string[][] = []
  const preamble: string[] = []
  for (const line of rawLines) {
    if (isStructural(line) && indentOf(line) === 0) {
      blocks.push([line])
    } else if (blocks.length === 0) {
      preamble.push(line)
    } else {
      blocks[blocks.length - 1]!.push(line)
    }
  }
  const preludeParts: string[] = [...preamble]
  const templates: string[][] = []
  const variables = new Set<string>()
  for (const block of blocks) {
    const names = block.flatMap(lineVariables)
    if (names.length === 0) {
      preludeParts.push(...block)
    } else {
      names.forEach(name => variables.add(name))
      templates.push(block)
    }
  }
  return {
    mapping: {
      prelude: preludeParts.join('\n').trim() === '' ? '' : `${preludeParts.join('\n').trimEnd()}\n`,
      templates,
      variables: [...variables].sort()
    },
    problems
  }
}

const safeAtomRe = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/

/**
 * Formats one field value for one template slot (spec §23.1). Deterministic
 * and exact — values insert verbatim when already token-safe, or as quoted
 * literals; formatting never invents names (no slugification).
 */
export const formatValue = (value: unknown, position: 'subject' | 'payload'): Formatted => {
  if (value === undefined || value === null) {
    return { kind: 'missing' }
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ?
      { kind: 'ok', text: String(value) } :
      { kind: 'problem', message: 'non-finite number' }
  }
  if (typeof value === 'boolean') {
    return { kind: 'ok', text: value ? 'true' : 'false' }
  }
  if (typeof value !== 'string') {
    return { kind: 'problem', message: `unsupported field type (${Array.isArray(value) ? 'array' : typeof value})` }
  }
  const text = value.replace(/[\r\n]+/g, ' ').trim()
  if (text === '') {
    return { kind: 'missing' }
  }
  if (safeAtomRe.test(text) && !Verb.isVerbToken(text)) {
    return { kind: 'ok', text }
  }
  if (position === 'payload') {
    const parsed = Value.parse(text)
    if (parsed.kind === 'number' || parsed.kind === 'date' || parsed.kind === 'trajectory') {
      return { kind: 'ok', text }
    }
  }
  if (!text.includes('"')) {
    return { kind: 'ok', text: `"${text}"` }
  }
  if (!text.includes('`')) {
    return { kind: 'ok', text: `\`${text}\`` }
  }
  return { kind: 'problem', message: 'value contains both " and ` — cannot quote' }
}

/**
 * Resolves a field by name: exact key first, then a dot path into nested
 * JSON (`address.city`, `items.0.sku`).
 */
export const fieldOf = (record: unknown, name: string): unknown => {
  if (record !== null && typeof record === 'object' && name in (record as object)) {
    return (record as Record<string, unknown>)[name]
  }
  let current: unknown = record
  for (const part of name.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

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

type SubstitutedLine =
  | { readonly kind: 'ok', readonly line: string }
  | { readonly kind: 'dropped' }
  | { readonly kind: 'problem', readonly message: string }

const substituteLine = (line: string, lookup: (name: string) => unknown): SubstitutedLine => {
  const indent = line.slice(0, indentOf(line))
  const { head, comment } = Token.splitComment(line)
  const tokens = Token.tokenize(head)
  const parts: string[] = []
  for (const [at, token] of tokens.entries()) {
    if (!isVariable(token)) {
      parts.push(formatToken(token))
      continue
    }
    const name = token.text.slice(1)
    const formatted = formatValue(lookup(name), at === 0 ? 'subject' : 'payload')
    switch (formatted.kind) {
      case 'missing':
        return { kind: 'dropped' }
      case 'problem':
        return { kind: 'problem', message: `?${name}: ${formatted.message}` }
      default:
        parts.push(formatted.text)
    }
  }
  return { kind: 'ok', line: `${indent}${parts.join(' ')}${comment === undefined ? '' : ` ; ${comment}`}` }
}

/**
 * Instantiates every template block for one record. Lines without variables
 * pass through verbatim; a dropped line takes its indented children with it.
 */
export const instantiate = (
  templates: readonly (readonly string[])[],
  lookup: (name: string) => unknown
): Instantiation => {
  const out: string[] = []
  const problems: string[] = []
  let dropped = 0
  for (const block of templates) {
    let skipDeeperThan: undefined | number
    for (const line of block) {
      if (!isStructural(line)) {
        out.push(line)
        continue
      }
      const indent = indentOf(line)
      if (skipDeeperThan !== undefined && indent > skipDeeperThan) {
        dropped += 1
        continue
      }
      skipDeeperThan = undefined
      if (lineVariables(line).length === 0) {
        out.push(line)
        continue
      }
      const substituted = substituteLine(line, lookup)
      switch (substituted.kind) {
        case 'dropped':
          dropped += 1
          skipDeeperThan = indent
          break
        case 'problem':
          problems.push(substituted.message)
          skipDeeperThan = indent
          break
        default:
          out.push(substituted.line)
      }
    }
  }
  const body = out.join('\n').trim()
  return { text: body === '' ? '' : `${out.join('\n').trimEnd()}\n`, dropped, problems }
}
