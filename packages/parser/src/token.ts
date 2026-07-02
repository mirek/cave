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
 * Splits a line at the first `;` that sits outside quotes and backticks
 * (spec §6.4). @returns the head and the trimmed comment text, `undefined`
 * when there is no comment or it is empty.
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
      const comment = line.slice(i + 1).trim()
      return comment === '' ?
        { head: line.slice(0, i) } :
        { head: line.slice(0, i), comment }
    }
  }
  return { head: line }
}
