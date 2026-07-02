import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cave/core'

test('defaults: positive, certain, unimportant, no metadata (spec §6)', () => {
  const claim = Claim.of({
    subject: Claim.entity('jwt'),
    verb: 'IS',
    payload: Claim.relation(Claim.entity('token-format'))
  })
  assert.equal(claim.negated, false)
  assert.equal(claim.conf, 1)
  assert.equal(claim.importance, false)
  assert.deepEqual(claim.contexts, [])
  assert.deepEqual(claim.tags, [])
  assert.equal(claim.delta, undefined)
  assert.equal(claim.comment, undefined)
})

test('contexts are deduplicated preserving author order', () => {
  const claim = Claim.of({
    subject: Claim.entity('x'),
    verb: 'IS',
    payload: Claim.relation(Claim.entity('y')),
    contexts: ['production', 'eu', 'production']
  })
  assert.deepEqual(claim.contexts, ['production', 'eu'])
})

test('term constructors and formatting', () => {
  assert.equal(Claim.formatTerm(Claim.entity('auth/middleware')), 'auth/middleware')
  assert.equal(Claim.formatTerm(Claim.text('install dependencies')), '"install dependencies"')
  assert.equal(Claim.formatTerm(Claim.code('ECONNRESET')), '`ECONNRESET`')
})

test('payload constructors', () => {
  assert.deepEqual(Claim.relation(Claim.entity('jwt')), { kind: 'relation', object: { kind: 'entity', text: 'jwt' } })
  const attr = Claim.attribute('max', Value.parse('20 conn'))
  assert.equal(attr.kind, 'attribute')
  const metric = Claim.metric(Value.parse('30ms'))
  assert.equal(metric.kind, 'metric')
})
