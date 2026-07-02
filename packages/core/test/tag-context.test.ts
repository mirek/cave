import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Tag, Context } from '@cave/core'

test('flat tag has undefined value (spec §6.2)', () => {
  assert.deepEqual(Tag.parse('security'), { key: 'security' })
})

test('scoped tag splits on first : (spec §6.2)', () => {
  assert.deepEqual(Tag.parse('topic:auth-security'), { key: 'topic', value: 'auth-security' })
  assert.deepEqual(Tag.parse('a:b:c'), { key: 'a', value: 'b:c' })
})

test('tag formats canonically', () => {
  assert.equal(Tag.format(Tag.of('security')), '#security')
  assert.equal(Tag.format(Tag.of('topic', 'auth-security')), '#topic:auth-security')
})

test('tag equality', () => {
  assert.ok(Tag.equals(Tag.of('a', 'b'), Tag.parse('a:b')))
  assert.ok(!Tag.equals(Tag.of('a'), Tag.of('a', 'b')))
})

test('context prefixes (spec §6.1)', () => {
  assert.equal(Context.prefix('src:annual-report'), 'src')
  assert.equal(Context.prefix('time:2026-04-06'), 'time')
  assert.equal(Context.prefix('loc:eu-west-1'), 'loc')
  assert.equal(Context.prefix('scope:production'), 'scope')
  assert.equal(Context.prefix('production'), undefined)
  assert.equal(Context.prefix('hyp:memory-leak'), undefined)
})

test('context formats and dedupes preserving order', () => {
  assert.equal(Context.format('production'), '@production')
  assert.deepEqual(Context.dedupe(['b', 'a', 'b']), ['b', 'a'])
})
