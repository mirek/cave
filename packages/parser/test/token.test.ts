import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Token } from '@cavelang/parser'

test('words split on whitespace', () => {
  assert.deepEqual(Token.tokenize('auth/middleware USES jwt'), [
    Token.word('auth/middleware'),
    Token.word('USES'),
    Token.word('jwt')
  ])
})

test('backticks capture exact code literals (spec §4.2)', () => {
  assert.deepEqual(Token.tokenize('expiry-check USES `<`'), [
    Token.word('expiry-check'),
    Token.word('USES'),
    Token.code('<')
  ])
  assert.deepEqual(Token.tokenize('server LOGS `ECONNRESET`'), [
    Token.word('server'),
    Token.word('LOGS'),
    Token.code('ECONNRESET')
  ])
})

test('double quotes capture natural-language literals (spec §4.2)', () => {
  assert.deepEqual(Token.tokenize('step/1 IS "install dependencies"'), [
    Token.word('step/1'),
    Token.word('IS'),
    Token.text('install dependencies')
  ])
})

test('code literal with spaces and reserved characters stays one token', () => {
  assert.deepEqual(Token.tokenize('`a; @b #c` FIX bug'), [
    Token.code('a; @b #c'),
    Token.word('FIX'),
    Token.word('bug')
  ])
})

test('multiple spaces collapse; leading/trailing whitespace ignored', () => {
  assert.deepEqual(Token.tokenize('  a   B  c  '), [
    Token.word('a'),
    Token.word('B'),
    Token.word('c')
  ])
})

test('unterminated delimiter degrades to a word', () => {
  assert.deepEqual(Token.tokenize('oops "unterminated'), [
    Token.word('oops'),
    Token.word('"unterminated')
  ])
})

test('empty line tokenizes to nothing', () => {
  assert.deepEqual(Token.tokenize(''), [])
  assert.deepEqual(Token.tokenize('   '), [])
})

test('splitComment: first unquoted ; wins (spec §6.4)', () => {
  assert.deepEqual(
    Token.splitComment('auth/key HAS expiry: 3600s ; rotated quarterly per security policy'),
    { head: 'auth/key HAS expiry: 3600s ', comment: 'rotated quarterly per security policy' }
  )
})

test('splitComment ignores ; inside quotes and backticks', () => {
  assert.deepEqual(Token.splitComment('server LOGS `a;b` ; real comment'), {
    head: 'server LOGS `a;b` ',
    comment: 'real comment'
  })
  assert.deepEqual(Token.splitComment('x IS "a;b"'), { head: 'x IS "a;b"' })
})

test('splitComment drops empty comments', () => {
  assert.deepEqual(Token.splitComment('x IS y ;'), { head: 'x IS y ' })
  assert.deepEqual(Token.splitComment('x IS y ;   '), { head: 'x IS y ' })
})
