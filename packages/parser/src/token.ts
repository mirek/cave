/**
 * Line tokenizer (spec §4).
 *
 * Splits one line (indentation and comment already removed) into tokens:
 * backticked code literals, double-quoted text literals, and whitespace
 * separated words. Built on `@prelude/parser` combinators.
 *
 * Literals contain no escape sequences (the spec defines none) — a quoted
 * token runs to the next matching delimiter. An unterminated delimiter
 * degrades gracefully: the raw text is consumed as an ordinary word.
 */

import * as P from '@prelude/parser'

export type Token =
  | { readonly kind: 'word', readonly text: string }
  | { readonly kind: 'text', readonly text: string }
  | { readonly kind: 'code', readonly text: string }

export type t = Token

export const word = (text: string): Token =>
  ({ kind: 'word', text })

export const text = (value: string): Token =>
  ({ kind: 'text', text: value })

export const code = (value: string): Token =>
  ({ kind: 'code', text: value })

const codeToken: P.Parser<Token> =
  P.map(P.seq(P.lit('`'), P.whileNotChars('`'), P.lit('`')), ([, body]) => code(body))

const textToken: P.Parser<Token> =
  P.map(P.seq(P.lit('"'), P.whileNotChars('"'), P.lit('"')), ([, body]) => text(body))

const wordToken: P.Parser<Token> =
  P.map(P.whileNotChars(' \t', 1), word)

const anyToken: P.Parser<Token> =
  P.first(codeToken, textToken, wordToken)

const lineTokens: P.Parser<Token[]> =
  P.map(
    P.seq(P.star(P.map(P.seq(P.ws0, anyToken), ([, token]) => token)), P.ws0),
    ([tokens]) => tokens
  )

/** @returns tokens of a single line. Total — any input tokenizes. */
export const tokenize = (line: string): Token[] =>
  P.parse(lineTokens, line)

/**
 * The text of a comment after its `;` (spec §6.4): exactly one following
 * space is dropped and trailing whitespace is trimmed, so the rest of the
 * line — including any indentation the author wrote — survives verbatim.
 * That is what lets a comment carry indented text such as code.
 */
export const commentText = (afterSemicolon: string): string =>
  (afterSemicolon.startsWith(' ') ? afterSemicolon.slice(1) : afterSemicolon).trimEnd()

/**
 * Splits a line at the first `;` that sits outside quotes and backticks
 * (spec §6.4). @returns the head and the comment text ({@link commentText}),
 * `undefined` when there is no comment or it is empty.
 */
export const splitComment = (line: string): { head: string, comment?: string } => {
  let quote: undefined | string
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === ';') {
      const comment = commentText(line.slice(i + 1))
      return comment === '' ?
        { head: line.slice(0, i) } :
        { head: line.slice(0, i), comment }
    }
  }
  return { head: line }
}

/**
 * Inverse of {@link splitComment} for a persisted comment (spec §6.4): a
 * comment is one or more lines, and every line but the last is rendered as a
 * full-line `;` comment directly above the claim while the last rides on the
 * claim line itself. Each line is written as `; ` plus its text, so the
 * text's own indentation survives a round trip; an empty line renders as a
 * bare `;`.
 */
export const joinComment = (head: string, comment?: string): string => {
  if (comment === undefined) {
    return head
  }
  const lines = comment.split('\n')
  const last = lines.pop()!
  return [...lines.map(line => line === '' ? ';' : `; ${line}`), `${head} ; ${last}`].join('\n')
}

const txLineRe = /^\s*;@[^\S\r\n]+(\S+)(?:[^\S\r\n]+(\{[^\r\n]*?))?[^\S\r\n]*$/

/**
 * @returns the transaction id carried by a physical line when it is a spec
 * §28.4 annotation (`;@ <tx>`), `undefined` otherwise. Purely lexical — the
 * caller validates the id shape. An annotation is never comment prose: it
 * neither joins nor interrupts the comment block above a claim (§6.4).
 */
export const txOfLine = (raw: string): undefined | string =>
  txLineRe.exec(raw)?.[1]

/** Optional opaque JSON payload on a transaction annotation; sync validates its schema. */
export const txDataOfLine = (raw: string): undefined | string =>
  txLineRe.exec(raw)?.[2] || undefined


/**
 * Positions of `needle` occurrences outside `"…"` and `` `…` `` literals —
 * where a rule line splits on `=>` and `,` (spec §24.1), an action body on
 * `,` (§25.1), and an inline mapping on `,` (§23.1): a separator inside a
 * quoted term never splits.
 */
export const topLevel = (text: string, needle: string): number[] => {
  if (needle === '') {
    throw new Error('topLevel: the separator must not be empty')
  }
  const positions: number[] = []
  let quote: undefined | string
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === '`') {
      quote = char
      continue
    }
    if (text.startsWith(needle, i)) {
      positions.push(i)
      i += needle.length - 1
    }
  }
  return positions
}

/** Splits `text` at every top-level `needle`, trimming the parts. */
export const splitTopLevel = (text: string, needle: string): string[] => {
  const parts: string[] = []
  let start = 0
  for (const at of topLevel(text, needle)) {
    parts.push(text.slice(start, at).trim())
    start = at + needle.length
  }
  parts.push(text.slice(start).trim())
  return parts
}
