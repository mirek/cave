import assert from 'node:assert/strict'
import test from 'node:test'
import { ebnfSpans } from '../src/lib/ebnf-highlight.ts'

const tokens = (source: string) => ebnfSpans(source).map(span => [span.capture, source.slice(span.start, span.end)])

test('rule definitions, terminals, operators and grouping get their captures', () => {
  assert.deepEqual(tokens('claim_body = verb [space "NOT"] | "EXISTS" ;'), [
    ['keyword', 'claim_body'], ['operator', '='], ['punctuation', '['], ['string', '"NOT"'],
    ['punctuation', ']'], ['operator', '|'], ['string', '"EXISTS"'], ['operator', ';'],
  ])
})

test('only names that start a line before = are definitions', () => {
  const source = 'line = blank\n     | claim_line ;'
  assert.deepEqual(tokens(source).filter(([capture]) => capture === 'keyword'), [['keyword', 'line']])
})

test('multi-line comments swallow quotes and operators', () => {
  const source = "(* the line's block = x;\n   more *)\nfile = { line } ;"
  assert.deepEqual(tokens(source)[0], ['comment', "(* the line's block = x;\n   more *)"])
  assert.deepEqual(tokens(source)[1], ['keyword', 'file'])
})

test('single, double and backtick quoted terminals', () => {
  assert.deepEqual(tokens(`literal = '"' text '"' | "\`" ;`).filter(([capture]) => capture === 'string'),
    [['string', `'"'`], ['string', `'"'`], ['string', '"`"']])
})

test('unterminated input stays bounded', () => {
  assert.deepEqual(tokens('a = "open\nb = x ;')[2], ['string', '"open'])
  assert.deepEqual(tokens('(* never closed'), [['comment', '(* never closed']])
})
