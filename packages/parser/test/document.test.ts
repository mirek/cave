import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { parseDocument, parse, type Ast } from '@cavelang/parser'

const kinds = (input: string): string[] =>
  parseDocument(input).lines.map(line => line.kind)

test('blank and comment lines (spec §16)', () => {
  const { lines, diagnostics } = parseDocument('\n; a file comment\n\njwt IS token-format')
  assert.deepEqual(lines.map(line => line.kind), ['blank', 'comment', 'blank', 'claim'])
  assert.equal(diagnostics.length, 0)
})

test('no extractable content marker (spec §14.3)', () => {
  const { lines } = parseDocument('; no extractable content')
  assert.equal(lines[0]!.kind, 'comment')
})

test('qualifier composition (spec §3.3)', () => {
  const doc = parseDocument([
    'server CAUSE crash @ 80%',
    '  WHEN load > ~1000 req/s',
    '  WHEN NOT cache/enabled'
  ].join('\n'))
  assert.equal(doc.diagnostics.length, 0)
  assert.deepEqual(doc.lines.map(line => line.kind), ['claim', 'qualifier', 'qualifier'])
  const [, first, second] = doc.lines
  assert.equal((first as Ast.Line & { kind: 'qualifier' }).parent, 0)
  assert.equal((second as Ast.Line & { kind: 'qualifier' }).parent, 0)
})

test('UNLESS accepted (spec §8.2)', () => {
  const doc = parseDocument('server CAUSE crash\n  UNLESS cache/enabled')
  assert.equal(doc.diagnostics.length, 0)
  const qualifier = doc.lines[1]!
  assert.equal(qualifier.kind, 'qualifier')
  if (qualifier.kind === 'qualifier') {
    assert.equal(qualifier.qualifier, 'UNLESS')
  }
})

test('continuation block (spec §8.3)', () => {
  const doc = parseDocument([
    'monorepo CONTAINS packages/api',
    '  CONTAINS packages/web',
    '  CONTAINS packages/core',
    '  PART-OF org/monorepos'
  ].join('\n'))
  assert.equal(doc.diagnostics.length, 0)
  assert.deepEqual(doc.lines.map(line => line.kind), ['claim', 'continuation', 'continuation', 'continuation'])
  const partOf = doc.lines[3]!
  if (partOf.kind === 'continuation') {
    assert.equal(partOf.parent, 0)
    assert.equal(partOf.body.verb, 'PART-OF')
  }
})

test('grouped full claims stay independent (spec §8.4)', () => {
  const doc = parseDocument('deploy VIA github-actions\n  build PRECEDES deploy')
  assert.deepEqual(doc.lines.map(line => line.kind), ['claim', 'claim'])
  const grouped = doc.lines[1]!
  if (grouped.kind === 'claim') {
    assert.equal(grouped.parent, 0)
  }
})

test('deploy VIA github-actions is a claim, not a qualifier, at top level', () => {
  const doc = parseDocument('deploy VIA github-actions')
  assert.equal(doc.lines[0]!.kind, 'claim')
})

test('uppercase subject with uppercase verb is a full triple (tiebreak)', () => {
  const doc = parseDocument('parent CONTAINS x\n  API NEEDS auth')
  assert.equal(doc.lines[1]!.kind, 'claim')
})

test('REVERSE declaration indented is a grouped claim, not a continuation', () => {
  const doc = parseDocument('a CONTAINS b\n  CONTAINS REVERSE PART-OF')
  assert.equal(doc.lines[1]!.kind, 'claim')
})

test('continuation with NOT (tiebreak: NOT is a modifier, not a verb)', () => {
  const doc = parseDocument('deploy NEEDS docker\n  NEEDS NOT downtime')
  const continuation = doc.lines[1]!
  assert.equal(continuation.kind, 'continuation')
  if (continuation.kind === 'continuation') {
    assert.equal(continuation.body.negated, true)
  }
})

test('nested indentation attaches to nearest less-indented line (spec §8)', () => {
  const doc = parseDocument([
    'a CAUSE b',
    '  WHEN c',
    'x CAUSE y',
    '  WHEN z'
  ].join('\n'))
  const [, firstQ, , secondQ] = doc.lines
  if (firstQ!.kind === 'qualifier' && secondQ!.kind === 'qualifier') {
    assert.equal(firstQ!.parent, 0)
    assert.equal(secondQ!.parent, 2)
  } else {
    assert.fail('expected qualifiers')
  }
})

test('worked example parses without diagnostics (spec §21)', () => {
  const doc = parseDocument([
    'auth/middleware HAS bug: token-expiry #security #topic:auth-hardening',
    '  token-expiry CAUSE reject-valid-tokens',
    '  expiry-check USES `<`',
    '  expiry-check NEEDS `<=`',
    '  `<=` FIX token-expiry @auth.ts:42',
    'auth/middleware NEEDS test: boundary-cases @ 70% ; suggested, not committed',
    'auth/keys VS asymmetric-keys @ 50% ; Sarah proposed, no decision yet',
    '  asymmetric-keys HAS advocate: Sarah',
    'topic/auth-hardening CONTAINS token-expiry'
  ].join('\n'))
  assert.deepEqual(doc.diagnostics, [])
  assert.deepEqual(doc.lines.map(line => line.kind), [
    'claim', 'claim', 'claim', 'claim', 'claim', 'claim', 'claim', 'claim', 'claim'
  ])
})

test('persistence block parses (spec §9.1)', () => {
  const doc = parseDocument([
    'Anthropic HAS ipo-timing: 2026-H2 @ 65% ; updated after CFO statement',
    '  BECAUSE cfo-statement'
  ].join('\n'))
  assert.deepEqual(doc.diagnostics, [])
  const qualifier = doc.lines[1]!
  assert.equal(qualifier.kind, 'qualifier')
})

test('qualifier at top level is invalid', () => {
  assert.deepEqual(kinds('WHEN cache-miss'), ['invalid'])
})

test('continuation at top level is invalid', () => {
  assert.deepEqual(kinds('CONTAINS packages/web'), ['invalid'])
})

test('indented orphan continuation is invalid', () => {
  const doc = parseDocument('; only a comment\n  CONTAINS x')
  assert.equal(doc.lines[1]!.kind, 'invalid')
  assert.equal(doc.diagnostics.length, 1)
})

test('broken lines become invalid entries; the rest of the document survives', () => {
  const doc = parseDocument('a uses b\njwt IS token-format')
  assert.deepEqual(doc.lines.map(line => line.kind), ['invalid', 'claim'])
  assert.equal(doc.diagnostics.length, 1)
})

test('strict parse throws with line numbers', () => {
  assert.throws(() => parse('a uses b'), /line 1/)
  assert.doesNotThrow(() => parse('a USES b'))
})

test('raw preserved exactly as written', () => {
  const raw = '  PART-OF org/monorepos ; note'
  const doc = parseDocument(`monorepo CONTAINS packages/api\n${raw}`)
  assert.equal(doc.lines[1]!.raw, raw)
})

test('tabs in indentation produce a diagnostic but still parse', () => {
  const doc = parseDocument('a CAUSE b\n\tWHEN c')
  assert.equal(doc.lines[1]!.kind, 'qualifier')
  assert.equal(doc.diagnostics.length, 1)
  assert.match(doc.diagnostics[0]!.message, /tab/)
})

test('windows line endings', () => {
  const doc = parseDocument('a USES b\r\nc USES d\r\n')
  assert.deepEqual(doc.lines.map(line => line.kind), ['claim', 'claim', 'blank'])
})

test('continuation with ALL-CAPS object stays a continuation (tiebreak via known vocabulary)', () => {
  const two = parseDocument('auth USES tokens\n  USES JWT')
  assert.equal(two.diagnostics.length, 0)
  const jwt = two.lines[1]!
  assert.equal(jwt.kind, 'continuation')
  if (jwt.kind === 'continuation') {
    assert.equal(jwt.body.verb, 'USES')
    assert.deepEqual(jwt.body.payload, { kind: 'relation', object: { kind: 'entity', text: 'JWT' } })
  }
  const three = parseDocument('team USES tooling\n  USES GPU cluster')
  assert.equal(three.lines[1]!.kind, 'continuation')
  const inverse = parseDocument('monorepo CONTAINS packages/api\n  PART-OF ORG')
  assert.equal(inverse.lines[1]!.kind, 'continuation')
})

test('unknown-verb triples with uppercase subjects stay claims (tiebreak)', () => {
  const doc = parseDocument('MIGRATES IS verb\nparent CONTAINS x\n  API MIGRATES postgres')
  const grouped = doc.lines[2]!
  assert.equal(grouped.kind, 'claim')
  if (grouped.kind === 'claim') {
    assert.equal(grouped.claim.subject.text, 'API')
    assert.equal(grouped.claim.verb, 'MIGRATES')
  }
})
