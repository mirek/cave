import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Entity } from '@cave/core'

test('normalizes whitespace to - (spec §13.4 step 4)', () => {
  assert.equal(Entity.normalize('token expiry'), 'token-expiry')
  assert.equal(Entity.normalize('  a  b   c '), 'a-b-c')
})

test('preserves proper-noun casing (spec §4.1)', () => {
  assert.equal(Entity.normalize('PostgreSQL'), 'PostgreSQL')
  assert.equal(Entity.normalize('OpenAI'), 'OpenAI')
})

test('segments split on /', () => {
  assert.deepEqual(Entity.segments('auth/middleware/token-check'), ['auth', 'middleware', 'token-check'])
  assert.deepEqual(Entity.segments('Sarah'), ['Sarah'])
})

test('check flags over-deep scopes and empty segments', () => {
  assert.deepEqual(Entity.check('auth/middleware'), [])
  assert.equal(Entity.check('a/b/c/d').length, 1)
  assert.equal(Entity.check('a//b').length, 1)
  assert.equal(Entity.check('').length, 1)
})
