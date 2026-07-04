import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Line, Token } from '@cavelang/parser'

const claim = (input: string) => {
  const { head, comment } = Token.splitComment(input)
  const result = Line.parseClaim(Token.tokenize(head), comment)
  assert.ok(result.ok, result.ok ? undefined : result.message)
  return result
}

test('bare triple (CAVE-Lite, spec §2.2)', () => {
  const { value } = claim('auth USES jwt')
  assert.deepEqual(value.subject, { kind: 'entity', text: 'auth' })
  assert.equal(value.verb, 'USES')
  assert.equal(value.negated, false)
  assert.deepEqual(value.payload, { kind: 'relation', object: { kind: 'entity', text: 'jwt' } })
})

test('full line anatomy (spec §3.2)', () => {
  const { value } = claim('auth USES jwt @production #security @ 90% ! ; because reasons')
  assert.deepEqual(value.meta.contexts, ['production'])
  assert.deepEqual(value.meta.tags, [{ key: 'security' }])
  assert.equal(value.meta.conf, 0.9)
  assert.equal(value.meta.importance, true)
  assert.equal(value.meta.comment, 'because reasons')
})

test('NOT negates any relation (spec §5.6)', () => {
  assert.equal(claim('server IS NOT production').value.negated, true)
  assert.equal(claim('deploy NEEDS NOT downtime').value.negated, true)
  const bare = claim('feature EXISTS NOT @production').value
  assert.equal(bare.negated, true)
  assert.equal(bare.payload.kind, 'none')
  assert.deepEqual(bare.meta.contexts, ['production'])
})

test('attribute/value colon binds in payload position (spec §3.4)', () => {
  const { value } = claim('OpenAI HAS revenue: 20B USD/yr')
  assert.equal(value.payload.kind, 'attribute')
  if (value.payload.kind === 'attribute') {
    assert.equal(value.payload.attribute, 'revenue')
    assert.equal(value.payload.value.num, 20_000_000_000)
    assert.equal(value.payload.value.unit, 'USD/yr')
  }
})

test('attribute value may be an atom', () => {
  const { value } = claim('auth/middleware HAS bug: token-expiry')
  assert.equal(value.payload.kind, 'attribute')
  if (value.payload.kind === 'attribute') {
    assert.equal(value.payload.attribute, 'bug')
    assert.equal(value.payload.value.raw, 'token-expiry')
    assert.equal(value.payload.value.kind, 'atom')
  }
})

test('attribute claims work with any verb (spec §21: NEEDS test: boundary-cases)', () => {
  const { value } = claim('auth/middleware NEEDS test: boundary-cases @ 70%')
  assert.equal(value.verb, 'NEEDS')
  assert.equal(value.payload.kind, 'attribute')
  assert.equal(value.meta.conf, 0.7)
})

test('legacy colonless HAS form accepted with a problem (spec §3.4)', () => {
  const result = claim('OpenAI HAS revenue 20B USD/yr')
  assert.equal(result.value.payload.kind, 'attribute')
  assert.equal(result.problems.length, 1)
  assert.match(result.problems[0]!, /legacy colonless/)
})

test('colonless HAS with atom object stays relational', () => {
  const { value, problems } = claim('pool HAS admin-ui')
  assert.equal(value.payload.kind, 'relation')
  assert.equal(problems.length, 0)
})

test('metric claim: IS + numeric value (spec §3.1)', () => {
  const latency = claim('latency IS 30ms').value
  assert.equal(latency.payload.kind, 'metric')
  if (latency.payload.kind === 'metric') {
    assert.equal(latency.payload.value.num, 30)
    assert.equal(latency.payload.value.unit, 'ms')
  }
  assert.equal(claim('free-user-rate IS 94.5%').value.payload.kind, 'metric')
})

test('IS + atom stays relational (spec §5.1: jwt IS token-format)', () => {
  assert.equal(claim('jwt IS token-format').value.payload.kind, 'relation')
  assert.equal(claim('server IS production').value.payload.kind, 'relation')
})

test('IS + quoted literal is a relation to a text term (spec §4.2)', () => {
  const { value } = claim('step/1 IS "install dependencies"')
  assert.deepEqual(value.payload, {
    kind: 'relation',
    object: { kind: 'text', text: 'install dependencies' }
  })
})

test('code literal subject and context with colon (spec §3.3)', () => {
  const { value } = claim('`<=` FIX token-expiry @auth.ts:42')
  assert.deepEqual(value.subject, { kind: 'code', text: '<=' })
  assert.deepEqual(value.meta.contexts, ['auth.ts:42'])
})

test('value uncertainty and sigma override (spec §7.2)', () => {
  const { value } = claim('OpenAI HAS revenue: 20B USD/yr +/- 2B USD/yr (1σ) @2026-Q1 @ 90%')
  assert.equal(value.meta.delta?.num, 2_000_000_000)
  assert.equal(value.meta.delta?.unit, 'USD/yr')
  assert.equal(value.meta.sigmaLevel, 1)
  assert.deepEqual(value.meta.contexts, ['2026-Q1'])
  assert.equal(value.meta.conf, 0.9)
})

test('approximate value with uncertainty (spec §7.3)', () => {
  const { value } = claim('OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @ 95%')
  assert.equal(value.payload.kind, 'attribute')
  if (value.payload.kind === 'attribute') {
    assert.equal(value.payload.value.approx, true)
  }
  assert.equal(value.meta.delta?.num, 2_000_000_000)
})

test('scoped and flat tags together (spec §6.2)', () => {
  const { value } = claim('deploy NEEDS docker #env:prod #team:platform #urgent')
  assert.deepEqual(value.meta.tags, [
    { key: 'env', value: 'prod' },
    { key: 'team', value: 'platform' },
    { key: 'urgent' }
  ])
})

test('multiple contexts (spec §6.1)', () => {
  const { value } = claim('memory-leak EXISTS @production @loc:eu-west-1')
  assert.deepEqual(value.meta.contexts, ['production', 'loc:eu-west-1'])
})

test('@ with space is confidence, without is context (spec §6.3)', () => {
  const conf = claim('memory-leak CAUSE oom @ 70%').value
  assert.equal(conf.meta.conf, 0.7)
  assert.deepEqual(conf.meta.contexts, [])
  const ctx = claim('memory-leak EXISTS @production').value
  assert.equal(ctx.meta.conf, undefined)
  assert.deepEqual(ctx.meta.contexts, ['production'])
})

test('REVERSE declaration parses as an ordinary claim (spec §5.5)', () => {
  const { value } = claim('CONTAINS REVERSE PART-OF')
  assert.deepEqual(value.subject, { kind: 'entity', text: 'CONTAINS' })
  assert.equal(value.verb, 'REVERSE')
  assert.deepEqual(value.payload, { kind: 'relation', object: { kind: 'entity', text: 'PART-OF' } })
})

test('extension verb declarations (spec §5.4)', () => {
  const is = claim('MIGRATES IS verb ; X moves data from old to new platform').value
  assert.equal(is.verb, 'IS')
  assert.equal(is.payload.kind, 'relation')
  assert.equal(is.meta.comment, 'X moves data from old to new platform')
  const arity = claim('REVERSE HAS arity: 2').value
  assert.equal(arity.payload.kind, 'attribute')
})

test('missing object fails except for EXISTS', () => {
  const result = Line.parseClaim(Token.tokenize('deploy NEEDS'))
  assert.ok(!result.ok)
  const exists = Line.parseClaim(Token.tokenize('memory-leak EXISTS'))
  assert.ok(exists.ok)
})

test('lowercase verb fails', () => {
  const result = Line.parseClaim(Token.tokenize('a uses b'))
  assert.ok(!result.ok)
})

test('unexpected metadata tokens are problems, not failures (spec §1.6)', () => {
  const result = claim('a USES b @production stray-token')
  assert.equal(result.problems.length, 1)
  assert.match(result.problems[0]!, /unexpected token/)
})

test('qualifier payload: bare entity and NOT (spec §8.2)', () => {
  const bare = Line.parseQualifierPayload(Token.tokenize('cache-miss'))
  assert.ok(bare.ok)
  assert.deepEqual(bare.value, {
    kind: 'entity',
    negated: false,
    term: { kind: 'entity', text: 'cache-miss' },
    meta: { contexts: [], tags: [], importance: false }
  })
  const negated = Line.parseQualifierPayload(Token.tokenize('NOT cache/enabled'))
  assert.ok(negated.ok)
  assert.equal(negated.value.negated, true)
})

test('qualifier payload: comparison (spec §8.2: WHEN load > ~1000 req/s)', () => {
  const result = Line.parseQualifierPayload(Token.tokenize('load > ~1000 req/s'))
  assert.ok(result.ok)
  assert.equal(result.value.kind, 'comparison')
  if (result.value.kind === 'comparison') {
    assert.deepEqual(result.value.left, { kind: 'entity', text: 'load' })
    assert.equal(result.value.op, '>')
    assert.equal(result.value.value.num, 1000)
    assert.equal(result.value.value.unit, 'req/s')
    assert.equal(result.value.value.approx, true)
  }
})

test('qualifier payload: full claim with own confidence (spec §10.2)', () => {
  const result = Line.parseQualifierPayload(Token.tokenize('memory-leak EXISTS @ 60%'))
  assert.ok(result.ok)
  assert.equal(result.value.kind, 'claim')
  if (result.value.kind === 'claim') {
    assert.equal(result.value.claim.verb, 'EXISTS')
    assert.equal(result.value.claim.meta.conf, 0.6)
  }
})

test('qualifier payload: full claim triple (spec §9.1: BECAUSE market/conditions BECOMES bearish)', () => {
  const result = Line.parseQualifierPayload(Token.tokenize('market/conditions BECOMES bearish'))
  assert.ok(result.ok)
  assert.equal(result.value.kind, 'claim')
})

test('percent-less and out-of-range confidence are diagnosed (spec §6.3)', () => {
  const percentless = claim('a USES b @ 90')
  assert.equal(percentless.value.meta.conf, undefined)
  assert.equal(percentless.problems.length, 1)
  assert.match(percentless.problems[0]!, /percentage/)
  const typo = claim('x HAS due: 5d @ 2026')
  assert.equal(typo.value.meta.conf, undefined)
  assert.equal(typo.problems.length, 1)
  const overflow = claim('a USES b @ 250%')
  assert.equal(overflow.value.meta.conf, 1)
  assert.match(overflow.problems[0]!, /above 100%/)
})

test('repeated non-repeatable metadata is diagnosed, last wins (spec §3.2)', () => {
  const conf = claim('a USES b @ 90% @ 80%')
  assert.equal(conf.value.meta.conf, 0.8)
  assert.equal(conf.problems.length, 1)
  assert.match(conf.problems[0]!, /repeated confidence/)
  const rest = claim('x IS 5 +/- 1 +/- 2 (1σ) (3σ) ! !')
  assert.equal(rest.value.meta.delta?.raw, '2')
  assert.equal(rest.value.meta.sigmaLevel, 3)
  assert.deepEqual(
    rest.problems.map(problem => problem.split(' ')[1]),
    ['+/-', '(Nσ)', '!']
  )
})

test('glued attribute colon splits with a diagnostic (spec §3.4, §4.3)', () => {
  const result = claim('auth/key HAS expiry:3600s')
  assert.equal(result.value.payload.kind, 'attribute')
  if (result.value.payload.kind === 'attribute') {
    assert.equal(result.value.payload.attribute, 'expiry')
    assert.equal(result.value.payload.value.num, 3600)
  }
  assert.equal(result.problems.length, 1)
  assert.match(result.problems[0]!, /glued attribute colon/)
})
