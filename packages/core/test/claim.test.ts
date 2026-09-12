import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cavelang/core'

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

test('programmatic claims reject non-finite numeric payloads and invalid confidence', () => {
  const base = { subject: Claim.entity('metric'), verb: 'IS', payload: Claim.metric(Value.parse('1')) }
  for (const conf of [NaN, Infinity, -Infinity, -0.1, 1.1]) assert.throws(() => Claim.of({ ...base, conf }), RangeError)
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (const value of [
      { ...Value.parse('1'), num: bad },
      { ...Value.parse('1 -> 2'), from: bad },
      { ...Value.parse('1 -> 2'), to: bad }
    ]) {
      assert.throws(() => Claim.of({ ...base, payload: Claim.metric(value) }), RangeError)
      assert.throws(() => Claim.of({ ...base, payload: Claim.attribute('amount', value) }), RangeError)
    }
  }
  for (const conf of [0, 1]) assert.equal(Claim.of({ ...base, conf }).conf, conf)
  const value = Value.parse(`${Value.formatNumber(-Number.MAX_VALUE)} -> ${Value.formatNumber(Number.MAX_VALUE)}`)
  assert.equal(Claim.of({ ...base, payload: Claim.metric(value) }).payload.kind, 'metric')
})

test('sigma extraction reads the delta magnitude once', () => {
  let deltaReads = 0, magnitudeReads = 0
  const delta = { ...Value.parse('4'), get num() { return ++magnitudeReads === 1 ? 4 : NaN } }
  const claim = { ...Claim.of({ subject: Claim.entity('sensor'), verb: 'IS', payload: Claim.metric(Value.parse('10')) }),
    get delta() { ++deltaReads; return delta }
  }
  assert.equal(Claim.sigmaOf(claim), 2)
  assert.equal(deltaReads, 1)
  assert.equal(magnitudeReads, 1)
})

test('claim construction retains the top-level metadata it validated', () => {
  const reads = { conf: 0, sigmaLevel: 0, delta: 0, payload: 0 }
  const payload = Claim.metric(Value.parse('10'))
  const delta = Value.parse('4')
  const claim = Claim.of({
    subject: Claim.entity('sensor'), verb: 'IS',
    get payload() { ++reads.payload; return payload },
    get conf() { return ++reads.conf === 1 ? 0.8 : NaN },
    get sigmaLevel() { return ++reads.sigmaLevel === 1 ? 2 : NaN },
    get delta() { ++reads.delta; return delta }
  })
  assert.equal(claim.conf, 0.8)
  assert.equal(claim.sigmaLevel, 2)
  assert.equal(claim.payload, payload)
  assert.equal(claim.delta, delta)
  assert.deepEqual(reads, { conf: 1, sigmaLevel: 1, delta: 1, payload: 1 })
})

test('claim construction rejects malformed negation and importance flags', () => {
  for (const flag of ['negated', 'importance'] as const) {
    for (const value of [null, 'true', 'false', 0, 1, {}, []]) {
      assert.throws(() => Claim.of({ subject: Claim.entity('sample'), verb: 'EXISTS',
        payload: Claim.none, [flag]: value } as Claim.Init), new RegExp(`${flag} must be a boolean`))
    }
  }
})

test('claim metadata collections require arrays when supplied', () => {
  for (const field of ['contexts', 'tags'] as const) {
    for (const value of [null, '', 'manual', 0, {}, new Set(), { length: 0 }]) {
      assert.throws(() => Claim.of({ subject: Claim.entity('sample'), verb: 'EXISTS',
        payload: Claim.none, [field]: value } as Claim.Init), new RegExp(`${field} must be an array`))
    }
  }
})
