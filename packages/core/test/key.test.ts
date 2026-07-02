import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key, Value } from '@cave/core'

const relation = (subject: string, verb: string, object: string, extra: Partial<Claim.Init> = {}) =>
  Claim.of({ subject: Claim.entity(subject), verb, payload: Claim.relation(Claim.entity(object)), ...extra })

test('same fact → same key; belief series shares it (spec §9.2)', () => {
  const a = relation('auth/middleware', 'USES', 'jwt', { conf: 0.5 })
  const b = relation('auth/middleware', 'USES', 'jwt', { conf: 0.9, importance: true })
  assert.equal(Key.of(a), Key.of(b))
})

test('confidence, tags, importance, comment never affect the key', () => {
  const bare = relation('a', 'USES', 'b')
  const decorated = relation('a', 'USES', 'b', {
    conf: 0.3,
    importance: true,
    tags: [{ key: 'security' }],
    comment: 'note'
  })
  assert.equal(Key.of(bare), Key.of(decorated))
})

test('negation is a key component (spec §9.2)', () => {
  assert.notEqual(
    Key.of(relation('server', 'IS', 'compromised')),
    Key.of(relation('server', 'IS', 'compromised', { negated: true }))
  )
})

test('contexts participate as sorted set (spec §9.2, §10.3)', () => {
  const ab = relation('app', 'CAUSE', 'crash', { contexts: ['a', 'b'] })
  const ba = relation('app', 'CAUSE', 'crash', { contexts: ['b', 'a', 'b'] })
  const hyp = relation('app', 'CAUSE', 'crash', { contexts: ['hyp:deadlock'] })
  assert.equal(Key.of(ab), Key.of(ba))
  assert.notEqual(Key.of(ab), Key.of(hyp))
})

test('attribute key excludes the value (spec §9.2: the value may change, the key stays)', () => {
  const at = (value: string, conf: number) =>
    Claim.of({
      subject: Claim.entity('Anthropic'),
      verb: 'HAS',
      payload: Claim.attribute('ipo-timing', Value.parse(value)),
      conf
    })
  assert.equal(Key.of(at('2026-H2', 0.4)), Key.of(at('2027-H1', 0.65)))
})

test('metric key excludes the value', () => {
  const latency = (value: string) =>
    Claim.of({ subject: Claim.entity('latency'), verb: 'IS', payload: Claim.metric(Value.parse(value)) })
  assert.equal(Key.of(latency('30ms')), Key.of(latency('800ms')))
})

test('object term kind distinguishes literals from entities', () => {
  const asEntity = relation('expiry-check', 'USES', '<')
  const asCode = Claim.of({
    subject: Claim.entity('expiry-check'),
    verb: 'USES',
    payload: Claim.relation(Claim.code('<'))
  })
  assert.notEqual(Key.of(asEntity), Key.of(asCode))
})

test('entity names mimicking kind prefixes never collide with literals', () => {
  const entityNamed = relation('expiry-check', 'USES', 'code:<=')
  const codeLiteral = Claim.of({
    subject: Claim.entity('expiry-check'),
    verb: 'USES',
    payload: Claim.relation(Claim.code('<='))
  })
  assert.notEqual(Key.of(entityNamed), Key.of(codeLiteral))
  const textAlias = relation('a', 'IS', 'text:x')
  const textLiteral = Claim.of({
    subject: Claim.entity('a'),
    verb: 'IS',
    payload: Claim.relation(Claim.text('x'))
  })
  assert.notEqual(Key.of(textAlias), Key.of(textLiteral))
})

test('different payload kinds never collide', () => {
  const rel = relation('x', 'HAS', 'max')
  const attr = Claim.of({
    subject: Claim.entity('x'),
    verb: 'HAS',
    payload: Claim.attribute('max', Value.parse('20 conn'))
  })
  assert.notEqual(Key.of(rel), Key.of(attr))
})
