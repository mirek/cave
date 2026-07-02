import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Key } from '@cave/core'
import { canonicalizeText, emit, emitClaim, standardRegistry } from '@cave/canonical'

const roundTrip = (text: string): { first: string, second: string } => {
  const result = canonicalizeText(text, standardRegistry)
  assert.deepEqual(result.problems, [], `problems for ${JSON.stringify(text)}`)
  const first = emit(result)
  const again = canonicalizeText(first, standardRegistry)
  assert.deepEqual(again.problems, [], `round-trip problems for ${JSON.stringify(first)}`)
  const second = emit(again)
  return { first, second }
}

test('emit produces canonical primary direction (spec §5.5)', () => {
  const result = canonicalizeText('packages/api PART-OF monorepo', standardRegistry)
  assert.equal(emit(result), 'monorepo CONTAINS packages/api\n')
})

test('emitters MUST produce the colon attribute form (spec §3.4)', () => {
  const result = canonicalizeText('OpenAI HAS revenue 20B USD/yr', standardRegistry)
  assert.equal(emit(result), 'OpenAI HAS revenue: 20B USD/yr\n')
})

test('emit is stable — second pass equals first', () => {
  const { first, second } = roundTrip([
    'auth/middleware HAS bug: token-expiry #security #topic:auth-hardening',
    'server IS NOT compromised @ 90%',
    'OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr (1σ) @2026-Q1 @ 90%',
    'auth/key HAS expiry: 3600s ! ; rotated quarterly',
    'memory-leak EXISTS @production',
    'feature EXISTS NOT @production',
    'latency IS 30ms',
    'step/1 IS "install dependencies"',
    'expiry-check USES `<`'
  ].join('\n'))
  assert.equal(second, first)
})

test('claim keys survive the round trip', () => {
  const text = [
    'server CAUSE crash @ 80%',
    '  WHEN load > ~1000 req/s',
    '  WHEN NOT cache/enabled',
    'monorepo CONTAINS packages/api',
    '  PART-OF org/monorepos'
  ].join('\n')
  const before = canonicalizeText(text, standardRegistry)
  const after = canonicalizeText(emit(before), standardRegistry)
  assert.deepEqual(
    after.claims.map(entry => Key.of(entry.claim)).sort(),
    before.claims.map(entry => Key.of(entry.claim)).sort()
  )
  assert.deepEqual(after.edges, before.edges)
})

test('UNLESS emits as WHEN NOT (spec §8.2 canonical preference)', () => {
  const result = canonicalizeText('server CAUSE crash\n  UNLESS cache/enabled', standardRegistry)
  assert.equal(emit(result), 'server CAUSE crash\n  WHEN NOT cache/enabled\n')
})

test('comparison condition emits as standard-verb claim', () => {
  const result = canonicalizeText('server CAUSE crash\n  WHEN load > ~1000 req/s', standardRegistry)
  assert.equal(emit(result), 'server CAUSE crash\n  WHEN load EXCEEDS ~1000 req/s\n')
})

test('grouped claims re-indent under their parent (spec §8.4)', () => {
  const result = canonicalizeText('deploy VIA github-actions\n  build PRECEDES deploy', standardRegistry)
  assert.equal(emit(result), 'deploy VIA github-actions\n  build PRECEDES deploy\n')
})

test('emitClaim renders every metadata item in §3.2 anatomy order', () => {
  const result = canonicalizeText(
    'OpenAI HAS projected-loss: 14B USD/yr +/- 3B USD/yr @2026 #finance @ 70% ! ; heavy capex',
    standardRegistry
  )
  assert.equal(
    emitClaim(result.claims[0]!.claim),
    'OpenAI HAS projected-loss: 14B USD/yr +/- 3B USD/yr @2026 #finance @ 70% ! ; heavy capex'
  )
})

test('empty result emits empty text', () => {
  assert.equal(emit({ claims: [], edges: [] }), '')
})

test('negated comparison conditions emit as WHEN NOT and round-trip keys (spec §8.2)', () => {
  const result = canonicalizeText('server CAUSE crash\n  UNLESS cpu >= 900', standardRegistry)
  const text = emit(result)
  assert.equal(text, 'server CAUSE crash\n  WHEN NOT cpu >= 900\n')
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.equal(Key.of(again.claims[1]!.claim), Key.of(result.claims[1]!.claim))
  assert.equal(again.claims[1]!.claim.negated, true)
  const exceeds = canonicalizeText('server CAUSE crash\n  WHEN NOT load > 1000 req/s', standardRegistry)
  const exceedsText = emit(exceeds)
  assert.equal(exceedsText, 'server CAUSE crash\n  WHEN NOT load EXCEEDS 1000 req/s\n')
  const exceedsAgain = canonicalizeText(exceedsText, standardRegistry)
  assert.equal(Key.of(exceedsAgain.claims[1]!.claim), Key.of(exceeds.claims[1]!.claim))
})

test('negated full-claim conditions round-trip (spec §8.2)', () => {
  const result = canonicalizeText('server CAUSE crash\n  WHEN NOT memory-leak EXISTS @production', standardRegistry)
  const text = emit(result)
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.equal(Key.of(again.claims[1]!.claim), Key.of(result.claims[1]!.claim))
})
