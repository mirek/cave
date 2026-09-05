import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Key } from '@cavelang/core'
import { canonicalizeText, emit, emitClaim, standardRegistry } from '@cavelang/canonical'

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

test('emit factors adjacent claims through recursive incomplete prefixes (spec §8.5)', () => {
  const result = canonicalizeText([
    'foo HAS a: A ; first',
    'foo HAS a: B',
    'foo HAS b: C',
    'bar HAS c: D'
  ].join('\n'), standardRegistry)
  assert.equal(
    emit(result),
    [
      'foo HAS',
      '  a:',
      '    A ; first',
      '    B',
      '  b: C',
      'bar HAS c: D',
      ''
    ].join('\n')
  )
  const again = canonicalizeText(emit(result), standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(
    again.claims.map(entry => Key.of(entry.claim)),
    result.claims.map(entry => Key.of(entry.claim))
  )
})

test('emit factors qualifier siblings without changing their parent edges (spec §8.5)', () => {
  const result = canonicalizeText([
    'server CAUSE crash',
    '  WHEN high-load',
    '  WHEN cache-miss'
  ].join('\n'), standardRegistry)
  const text = emit(result)
  assert.equal(text, 'server CAUSE crash\n  WHEN\n    high-load\n    cache-miss\n')
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(again.edges, result.edges)
})

test('factoring stops before a prefix becomes a complete claim', () => {
  const result = canonicalizeText([
    'foo HAS revenue: 20B USD/yr @2025',
    'foo HAS revenue: 20B USD/mo @2026'
  ].join('\n'), standardRegistry)
  assert.equal(
    emit(result),
    'foo HAS revenue:\n  20B USD/yr @2025\n  20B USD/mo @2026\n'
  )
})

test('transaction annotations stay directly above factored claim leaves', () => {
  const result = canonicalizeText('foo HAS a: A\nfoo HAS b: B', standardRegistry)
  const text = emit(result, { annotate: index => `;@ tx-${index}` })
  assert.equal(
    text,
    'foo HAS\n  ;@ tx-0\n  a: A\n  ;@ tx-1\n  b: B\n'
  )
  const lines = text.trimEnd().split('\n')
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(
    again.claims.map(entry => lines[entry.line - 2]!.trim()),
    [';@ tx-0', ';@ tx-1']
  )
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

test('all comparison conditions and isolated stored rows round-trip as valid CAVE', () => {
  const cases = [
    ['>', 'EXCEEDS'],
    ['<', 'IS-BELOW'],
    ['>=', 'IS-AT-LEAST'],
    ['<=', 'IS-AT-MOST'],
    ['=', 'EQUALS'],
    ['!=', 'DIFFERS-FROM']
  ] as const
  for (const [operator, verb] of cases) {
    const result = canonicalizeText(`server CAUSE crash\n  WHEN load ${operator} 100 req/s`, standardRegistry)
    const text = emit(result)
    assert.equal(text, `server CAUSE crash\n  WHEN load ${verb} 100 req/s\n`, operator)
    const again = canonicalizeText(text, standardRegistry)
    assert.deepEqual(again.problems, [], operator)
    assert.equal(Key.of(again.claims[1]!.claim), Key.of(result.claims[1]!.claim), operator)

    const isolated = `${emitClaim(result.claims[1]!.claim)}\n`
    const isolatedAgain = canonicalizeText(isolated, standardRegistry)
    assert.deepEqual(isolatedAgain.problems, [], `isolated ${operator}`)
    assert.equal(Key.of(isolatedAgain.claims[0]!.claim), Key.of(result.claims[1]!.claim), operator)
  }
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
  assert.equal(text, 'server CAUSE crash\n  WHEN NOT cpu IS-AT-LEAST 900\n')
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

test('a child cited by several parents is re-stated — children render once (spec §28.4)', () => {
  const base = canonicalizeText('a CAUSE b\nc CAUSE d\npremise EXISTS\n  WHEN deep EXISTS', standardRegistry)
  const result = {
    claims: base.claims,
    edges: [...base.edges, { parent: 0, role: 'BECAUSE', child: 2 }, { parent: 1, role: 'BECAUSE', child: 2 }] as const
  }
  assert.equal(
    emit(result),
    'a CAUSE b\n  BECAUSE premise\n    WHEN deep\nc CAUSE d\n  BECAUSE premise\n',
    "the re-statement is the line alone; the child's own children rode its first appearance"
  )
})

test('a support cycle with no top-level member still emits every claim once (spec §24.5, §28.4)', () => {
  const base = canonicalizeText('a CAUSE b\nb CAUSE a', standardRegistry)
  const result = {
    claims: base.claims,
    edges: [{ parent: 0, role: 'BECAUSE', child: 1 }, { parent: 1, role: 'BECAUSE', child: 0 }] as const
  }
  assert.equal(
    emit(result),
    'a CAUSE b\n  BECAUSE b CAUSE a\n    BECAUSE a CAUSE b\n',
    'the cycle breaks at the re-statement instead of dropping rows'
  )
})

test('multi-line comments open above the claim line, trailing last, and round-trip (spec §6.4)', () => {
  const source = [
    '; rotated quarterly',
    '; per security policy',
    'auth/key HAS expiry: 3600s ! ; confirmed by ops',
    'auth USES jwt',
    '  ; reviewed in june',
    '  BECAUSE security-review',
    'foo HAS a: A',
    '; second leaf',
    '; keeps its block',
    'foo HAS b: B'
  ].join('\n')
  const result = canonicalizeText(source, standardRegistry)
  assert.deepEqual(result.problems, [])
  assert.equal(result.claims[0]!.claim.comment, 'rotated quarterly\nper security policy\nconfirmed by ops')
  assert.equal(
    emitClaim(result.claims[0]!.claim),
    '; rotated quarterly\n; per security policy\nauth/key HAS expiry: 3600s ! ; confirmed by ops'
  )
  const text = emit(result, { annotate: index => `;@ tx-${index}` })
  assert.equal(text, [
    '; rotated quarterly',
    '; per security policy',
    ';@ tx-0',
    'auth/key HAS expiry: 3600s ! ; confirmed by ops',
    ';@ tx-1',
    'auth USES jwt',
    '  ;@ tx-2',
    '  BECAUSE security-review ; reviewed in june',
    'foo HAS',
    '  ;@ tx-3',
    '  a: A',
    '  ; second leaf',
    '  ;@ tx-4',
    '  b: B ; keeps its block',
    ''
  ].join('\n'))
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(again.claims.map(entry => entry.claim.comment), result.claims.map(entry => entry.claim.comment))
  assert.equal(emit(again), emit(result))
})
