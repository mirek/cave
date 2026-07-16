import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Key } from '@cavelang/core'
import { Registry, canonicalizeText, standardRegistry, standardPrelude } from '@cavelang/canonical'

test('inverse write normalizes to primary before keying (spec §5.5)', () => {
  const result = canonicalizeText('packages/api PART-OF monorepo', standardRegistry)
  assert.equal(result.problems.length, 0)
  const { claim } = result.claims[0]!
  assert.deepEqual(claim.subject, { kind: 'entity', text: 'monorepo' })
  assert.equal(claim.verb, 'CONTAINS')
  assert.deepEqual(claim.payload, { kind: 'relation', object: { kind: 'entity', text: 'packages/api' } })
  assert.equal(claim.raw, 'packages/api PART-OF monorepo')
})

test('forward and inverse readings share one claim key (spec §5.5)', () => {
  const inverse = canonicalizeText('packages/api PART-OF monorepo @ 50%', standardRegistry).claims[0]!.claim
  const forward = canonicalizeText('monorepo CONTAINS packages/api @ 90%', standardRegistry).claims[0]!.claim
  assert.equal(Key.of(inverse), Key.of(forward))
  assert.equal(inverse.conf, 0.5)
  assert.equal(forward.conf, 0.9)
})

test('in-band REVERSE declaration takes effect for subsequent lines (spec §5.5)', () => {
  const text = 'CONTAINS REVERSE PART-OF\npackages/api PART-OF monorepo'
  const result = canonicalizeText(text)
  assert.equal(result.problems.length, 0)
  const declaration = result.claims[0]!.claim
  assert.equal(declaration.verb, 'REVERSE')
  const flipped = result.claims[1]!.claim
  assert.equal(flipped.verb, 'CONTAINS')
  assert.deepEqual(flipped.subject, { kind: 'entity', text: 'monorepo' })
})

test('declaration order matters — inverse before declaration stays as written', () => {
  const text = 'packages/api PART-OF monorepo\nCONTAINS REVERSE PART-OF'
  const result = canonicalizeText(text)
  assert.equal(result.claims[0]!.claim.verb, 'PART-OF')
})

test('the standard prelude text builds the standard registry', () => {
  const result = canonicalizeText(standardPrelude)
  assert.equal(result.problems.length, 0)
  const flipped = canonicalizeText('a USED-BY b', result.registry).claims[0]!.claim
  assert.equal(flipped.verb, 'USES')
  assert.deepEqual(flipped.subject, { kind: 'entity', text: 'b' })
})

test('negation rides the single row through inversion (spec §5.5)', () => {
  const result = canonicalizeText('db/writes BLOCKED-BY NOT server', standardRegistry)
  const { claim } = result.claims[0]!
  assert.equal(claim.verb, 'BLOCKS')
  assert.equal(claim.negated, true)
  assert.deepEqual(claim.subject, { kind: 'entity', text: 'server' })
  assert.deepEqual(claim.payload, { kind: 'relation', object: { kind: 'entity', text: 'db/writes' } })
})

test('inverse verb without a relationalpayload keeps the line and reports (spec §5.5)', () => {
  const result = canonicalizeText('x PART-OF max: 3', standardRegistry)
  assert.equal(result.problems.length, 1)
  assert.equal(result.claims[0]!.claim.verb, 'PART-OF')
})

test('continuation inherits the parent subject as written (spec §8.3)', () => {
  const result = canonicalizeText([
    'monorepo CONTAINS packages/api',
    '  CONTAINS packages/web',
    '  CONTAINS packages/core',
    '  PART-OF org/monorepos'
  ].join('\n'), standardRegistry)
  assert.equal(result.problems.length, 0)
  const rows = result.claims.map(entry =>
    `${entry.claim.subject.text} ${entry.claim.verb} ${entry.claim.payload.kind === 'relation' ? entry.claim.payload.object.text : ''}`)
  assert.deepEqual(rows, [
    'monorepo CONTAINS packages/api',
    'monorepo CONTAINS packages/web',
    'monorepo CONTAINS packages/core',
    'org/monorepos CONTAINS monorepo'
  ])
  assert.equal(result.edges.length, 0, 'continuations are siblings, not qualifications (spec §8.3)')
  assert.equal(result.claims[3]!.claim.raw, '  PART-OF org/monorepos')
})

test('each continuation is an independent claim with its own metadata (spec §8.3)', () => {
  const result = canonicalizeText([
    'monorepo CONTAINS packages/api',
    '  CONTAINS packages/web @ 70% #infra'
  ].join('\n'), standardRegistry)
  const second = result.claims[1]!.claim
  assert.equal(second.conf, 0.7)
  assert.deepEqual(second.tags, [{ key: 'infra' }])
})

test('qualifier lines become condition claims joined by edges (spec §8.1, §8.2)', () => {
  const result = canonicalizeText([
    'server CAUSE crash @ 80%',
    '  WHEN load > ~1000 req/s',
    '  WHEN NOT cache/enabled'
  ].join('\n'), standardRegistry)
  assert.equal(result.problems.length, 0)
  assert.equal(result.claims.length, 3)
  assert.deepEqual(result.edges, [
    { parent: 0, role: 'WHEN', child: 1 },
    { parent: 0, role: 'WHEN', child: 2 }
  ])
  const comparison = result.claims[1]!.claim
  assert.equal(comparison.verb, 'EXCEEDS')
  assert.equal(comparison.payload.kind, 'metric')
  if (comparison.payload.kind === 'metric') {
    assert.equal(comparison.payload.value.num, 1000)
    assert.equal(comparison.payload.value.approx, true)
  }
  const negated = result.claims[2]!.claim
  assert.equal(negated.verb, 'EXISTS')
  assert.equal(negated.negated, true)
  assert.deepEqual(negated.subject, { kind: 'entity', text: 'cache/enabled' })
})

test('UNLESS normalizes to WHEN + negated condition (spec §8.2)', () => {
  const whenNot = canonicalizeText('server CAUSE crash\n  WHEN NOT cache/enabled', standardRegistry)
  const unless = canonicalizeText('server CAUSE crash\n  UNLESS cache/enabled', standardRegistry)
  assert.deepEqual(unless.edges, whenNot.edges)
  assert.equal(unless.edges[0]!.role, 'WHEN')
  assert.equal(
    Key.of(unless.claims[1]!.claim),
    Key.of(whenNot.claims[1]!.claim)
  )
})

test('qualifier with a full inner claim keeps its own confidence (spec §10.2)', () => {
  const result = canonicalizeText([
    'server CAUSE crash @ 80%',
    '  WHEN memory-leak EXISTS @ 60%'
  ].join('\n'), standardRegistry)
  const condition = result.claims[1]!.claim
  assert.equal(condition.verb, 'EXISTS')
  assert.equal(condition.conf, 0.6)
})

test('grouped full claims link with QUALIFIES role (spec §8.4, §13.2)', () => {
  const result = canonicalizeText('deploy VIA github-actions\n  build PRECEDES deploy', standardRegistry)
  assert.equal(result.claims.length, 2)
  assert.deepEqual(result.edges, [{ parent: 0, role: 'QUALIFIES', child: 1 }])
})

test('entity whitespace normalizes to - in object phrases (spec §13.4 step 4)', () => {
  const result = canonicalizeText('x YIELDS big bundle file')
  const { claim } = result.claims[0]!
  assert.deepEqual(claim.payload, { kind: 'relation', object: { kind: 'entity', text: 'big-bundle-file' } })
})

test('extension verb declaration is tracked (spec §5.4)', () => {
  const result = canonicalizeText('MIGRATES IS verb ; moves data\nlegacy-db MIGRATES postgres')
  assert.equal(result.claims.length, 2)
  assert.ok(result.registry.declared.has('MIGRATES'))
})

test('old and new verb spellings canonicalize to one stable history (spec §5.8)', () => {
  const result = canonicalizeText([
    'WORKS-AT IS verb',
    'alice WORKS-AT acme @ 60%',
    'WORKS-AT RENAMED-TO EMPLOYED-BY',
    'alice EMPLOYED-BY acme @ 90%'
  ].join('\n'), standardRegistry)
  assert.deepEqual(result.problems, [])
  const oldClaim = result.claims[1]!.claim
  const newClaim = result.claims[3]!.claim
  assert.equal(newClaim.verb, 'WORKS-AT', 'oldest spelling remains the storage identity')
  assert.equal(Key.of(newClaim), Key.of(oldClaim))
  assert.equal(Registry.preferredOf(result.registry, 'WORKS-AT'), 'EMPLOYED-BY')
  assert.ok(Registry.isDeprecated(result.registry, 'WORKS-AT'))
})

test('renamed inverse spellings still normalize direction (spec §5.5, §5.8)', () => {
  const result = canonicalizeText([
    'WORKS-AT REVERSE EMPLOYS',
    'EMPLOYS RENAMED-TO EMPLOYER-OF',
    'acme EMPLOYER-OF alice'
  ].join('\n'), standardRegistry)
  assert.deepEqual(result.problems, [])
  const claim = result.claims[2]!.claim
  assert.equal(claim.verb, 'WORKS-AT')
  assert.deepEqual(claim.subject, { kind: 'entity', text: 'alice' })
  assert.deepEqual(claim.payload, { kind: 'relation', object: { kind: 'entity', text: 'acme' } })
})

test('worked example (spec §21) canonicalizes cleanly', () => {
  const result = canonicalizeText([
    'auth/middleware HAS bug: token-expiry #security #topic:auth-hardening',
    '  token-expiry CAUSE reject-valid-tokens',
    '  expiry-check USES `<`',
    '  expiry-check NEEDS `<=`',
    '  `<=` FIX token-expiry @auth.ts:42',
    'auth/middleware NEEDS test: boundary-cases @ 70% ; suggested, not committed',
    'auth/keys VS asymmetric-keys @ 50% ; Sarah proposed, no decision yet',
    '  asymmetric-keys HAS advocate: Sarah',
    'topic/auth-hardening CONTAINS token-expiry'
  ].join('\n'), standardRegistry)
  assert.equal(result.problems.length, 0)
  assert.equal(result.claims.length, 9)
  const inverseRead = canonicalizeText('token-expiry PART-OF topic/auth-hardening', standardRegistry)
  assert.equal(
    Key.of(inverseRead.claims[0]!.claim),
    Key.of(result.claims[8]!.claim),
    'the §21 inverse read is the same fact'
  )
  const causedBy = canonicalizeText('reject-valid-tokens CAUSED-BY token-expiry', standardRegistry)
  assert.equal(
    Key.of(causedBy.claims[0]!.claim),
    Key.of(result.claims[1]!.claim)
  )
})

test('parser diagnostics surface as problems', () => {
  const result = canonicalizeText('a uses b')
  assert.equal(result.claims.length, 0)
  assert.equal(result.problems.length, 1)
})

test('inverse writes with date/number endpoints share the forward key (spec §5.5)', () => {
  const forward = canonicalizeText('deploy PRECEDES 2026-01-01', standardRegistry)
  const inverse = canonicalizeText('2026-01-01 FOLLOWS deploy', standardRegistry)
  assert.deepEqual(inverse.problems, [])
  assert.equal(Key.of(inverse.claims[0]!.claim), Key.of(forward.claims[0]!.claim))
  const metricSide = canonicalizeText('deploy FOLLOWS 2026-01-01', standardRegistry)
  assert.deepEqual(metricSide.problems, [])
  const claim = metricSide.claims[0]!.claim
  assert.equal(claim.verb, 'PRECEDES')
  assert.deepEqual(claim.subject, { kind: 'entity', text: '2026-01-01' })
  assert.equal(
    Key.of(claim),
    Key.of(canonicalizeText('2026-01-01 PRECEDES deploy', standardRegistry).claims[0]!.claim)
  )
})

test('declarations written as continuations update the registry (spec §5.4, §8.3)', () => {
  const result = canonicalizeText('MIGRATES HAS domain: data-platform\n  IS verb')
  assert.ok(result.registry.declared.has('MIGRATES'))
})

test('the standard prelude declares lifecycle and EXPECTS meta-verbs (spec §5.8, §20.1)', () => {
  const result = canonicalizeText(standardPrelude)
  assert.equal(result.problems.length, 0)
  const declared = canonicalizeText('service EXPECTS owner', result.registry).claims[0]!.claim
  assert.equal(declared.verb, 'EXPECTS')
  assert.deepEqual(declared.payload, { kind: 'relation', object: { kind: 'entity', text: 'owner' } })
  assert.ok(result.registry.declared.has('RENAMED-TO'))
})
