import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { judgePrompt, parseJudgeReply, suggestAliases, suggestTag, writeSuggestions } from '@cavelang/shape'

test('segment containment suggests drifted names in the review band (spec §27.2)', () => {
  const store = open()
  store.ingest([
    'jan PARENT-OF maria',
    'maria PARENT-OF anna',
    'grandma-maria HAS age: 90 yr'
  ].join('\n'))
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  const [suggestion] = suggestions
  // maria carries more current rows, so it is the canonical side.
  assert.equal(suggestion!.entity, 'grandma-maria')
  assert.equal(suggestion!.canonical, 'maria')
  assert.ok(suggestion!.confidence >= 0.3 && suggestion!.confidence <= 0.5)
  assert.ok(suggestion!.signals.some(signal => signal.kind === 'tokens'))
  assert.match(suggestion!.line, /^grandma-maria ALIAS maria #suggested @ \d+% ; /)
  store.close()
})

test('suggested lines round-trip through ingest with the tag intact (spec §27.3)', () => {
  const store = open()
  store.ingest('jan PARENT-OF maria\ngrandma-maria HAS age: 90 yr')
  const suggestions = suggestAliases(store)
  const { appended } = writeSuggestions(store, suggestions)
  assert.equal(appended, 1)
  const rows = store.byTag(suggestTag)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.verb, 'ALIAS')
  const claim = store.toClaim(rows[0]!)
  assert.ok(claim.contexts.includes('src:suggest/alias'))
  assert.ok(claim.conf >= 0.3 && claim.conf <= 0.5)
  // The pair now has ALIAS history — a re-run suggests nothing (§27.1).
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('case and separator drift scores as normalized equality (spec §27.2)', () => {
  const store = open()
  store.ingest('Long-Street EXISTS\nlong_street EXISTS')
  const [suggestion] = suggestAliases(store)
  assert.ok(suggestion !== undefined)
  assert.equal(suggestion.score, 1)
  assert.equal(suggestion.confidence, 0.5)
  assert.ok(suggestion.signals.some(signal => signal.kind === 'equal'))
  store.close()
})

test('reordered segments score below equality, above containment (spec §27.2)', () => {
  const store = open()
  store.ingest('maria-grandma EXISTS\ngrandma-maria EXISTS')
  const [suggestion] = suggestAliases(store)
  assert.ok(suggestion !== undefined)
  assert.equal(suggestion.score, 0.9)
  store.close()
})

test('prefix similarity scores by length ratio (spec §27.2)', () => {
  const store = open()
  store.ingest('billing USES postgres\nanalytics USES postgresql')
  const suggestions = suggestAliases(store)
  const pair = suggestions.find(suggestion =>
    suggestion.entity === 'postgresql' || suggestion.canonical === 'postgresql')
  assert.ok(pair !== undefined)
  assert.ok(pair.signals.some(signal => signal.kind === 'prefix' && Math.abs(signal.score - 0.8) < 1e-9))
  store.close()
})

test('typos surface through edit similarity (spec §27.2)', () => {
  const store = open()
  store.ingest('analytics USES redis\nanlytics HAS owner: data-team')
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0]!.signals.some(signal => signal.kind === 'edit'))
  store.close()
})

test('a typo inside one segment is drift; a differing word is not (spec §27.2)', () => {
  const store = open()
  store.ingest('grandma-maria EXISTS\ngrandma-mria EXISTS')
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0]!.signals.some(signal => signal.kind === 'edit'))
  const siblings = open()
  siblings.ingest('north-tower EXISTS\nsouth-tower EXISTS')
  assert.equal(suggestAliases(siblings).length, 0)
  store.close()
  siblings.close()
})

test('names differing only in digits are versions, not drift (spec §27.2)', () => {
  const store = open()
  store.ingest('api-v1 EXISTS\napi-v2 EXISTS')
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('a rare shared textual value identifies; common and numeric values do not (spec §27.2)', () => {
  const store = open()
  store.ingest([
    'mrusin HAS orcid: 0000-0002-1825',
    'mirek-rusin HAS orcid: 0000-0002-1825',
    // Common category value — three carriers, never identifying.
    'mrusin HAS status: active',
    'mirek-rusin HAS status: active',
    'other HAS status: active',
    // Numeric value — two towers with the same height are not one tower;
    // and north/south is sibling naming, not spelling drift (§27.2).
    'north-tower HAS floors: 12',
    'south-tower HAS floors: 12'
  ].join('\n'))
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  const [suggestion] = suggestions
  assert.deepEqual([suggestion!.entity, suggestion!.canonical].sort(), ['mirek-rusin', 'mrusin'])
  assert.ok(suggestion!.signals.some(signal => signal.kind === 'value'))
  store.close()
})

test('shared neighbors boost but never generate (spec §27.2)', () => {
  const store = open()
  // Siblings share both parents — two shared inbound edges, no name or
  // value evidence: never suggested.
  store.ingest([
    'jan PARENT-OF maria',
    'helena PARENT-OF maria',
    'jan PARENT-OF piotr',
    'helena PARENT-OF piotr'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 0)
  // A borderline prefix pair (ratio 5/12 < 0.6) crosses the threshold
  // only with shared relations behind it.
  const drifted = open()
  drifted.ingest('auth-x USES redis\nauth-x IS service\nauth-xtra-line EXISTS')
  assert.equal(suggestAliases(drifted).length, 0)
  drifted.ingest('auth-xtra-line USES redis\nauth-xtra-line IS service')
  const suggestions = suggestAliases(drifted)
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0]!.signals.filter(signal => signal.kind === 'neighbor').length === 2)
  store.close()
  drifted.close()
})

test('any recorded ALIAS history excludes the pair (spec §27.1)', () => {
  const merged = open()
  merged.ingest('maria EXISTS\ngrandma-maria EXISTS\ngrandma-maria ALIAS maria')
  assert.equal(suggestAliases(merged).length, 0)
  const rejected = open()
  rejected.ingest('maria EXISTS\ngrandma-maria EXISTS\ngrandma-maria ALIAS NOT maria')
  assert.equal(suggestAliases(rejected).length, 0)
  const unmerged = open()
  unmerged.ingest('maria EXISTS\ngrandma-maria EXISTS\ngrandma-maria ALIAS maria\ngrandma-maria ALIAS maria @ 0%')
  assert.equal(suggestAliases(unmerged).length, 0)
  merged.close()
  rejected.close()
  unmerged.close()
})

test('one closure group is one entity — members are never suggested (spec §27.1)', () => {
  const store = open()
  // maria–grandma-maria linked through babcia transitively, no direct row.
  store.ingest([
    'maria ALIAS babcia',
    'grandma-maria ALIAS babcia',
    'maria EXISTS',
    'grandma-maria EXISTS'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('related entities are distinct entities (spec §27.1)', () => {
  const store = open()
  store.ingest('auth-service CALLS auth-service-v2 ; deliberate split')
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('scope parents, system entities and literals are never candidates (spec §27.1)', () => {
  const store = open()
  store.ingest([
    'auth EXISTS',
    'auth/middleware EXISTS',
    'rule/ecf351a4f3e7 HAS rule: `?a PARENT-OF ?b => ?a ANCESTOR-OF ?b`',
    'rule/ecf351a4f3f8 HAS note: near-identical digest',
    'source/ingest HAS reliability: 80%',
    'source/ingest2 HAS reliability: 70%',
    'docs/readme.md HAS ingest-digest: 93a01c626b3f',
    'docs/readme2.md HAS ingest-digest: 93a01c626b40',
    'thing HAS quote: "some words"'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('minScore and limit narrow the result (spec §27.2)', () => {
  const store = open()
  store.ingest([
    'maria EXISTS',
    'grandma-maria EXISTS ; containment 0.7',
    'long-street EXISTS',
    'Long_Street EXISTS ; equality 1.0'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 2)
  const strong = suggestAliases(store, { minScore: 0.8 })
  assert.equal(strong.length, 1)
  assert.equal(strong[0]!.score, 1)
  assert.equal(suggestAliases(store, { limit: 1 }).length, 1)
  // Strongest first.
  assert.equal(suggestAliases(store)[0]!.score, 1)
  store.close()
})

test('judge prompt carries each side of the evidence (spec §27.4)', () => {
  const store = open()
  store.ingest('jan PARENT-OF maria\ngrandma-maria HAS age: 90 yr')
  const suggestions = suggestAliases(store)
  const prompt = judgePrompt(store, suggestions)
  assert.match(prompt, /S1: grandma-maria ALIAS maria #suggested/)
  assert.match(prompt, /jan PARENT-OF maria/)
  assert.match(prompt, /grandma-maria HAS age: 90 yr/)
  assert.match(prompt, /JSON array/)
  store.close()
})

test('judge replies parse leniently (spec §27.4)', () => {
  assert.deepEqual(parseJudgeReply('[1, 3]', 3), [0, 2])
  assert.deepEqual(parseJudgeReply('Looking at [the evidence] carefully... final answer: [2]', 3), [1])
  assert.deepEqual(parseJudgeReply('[]', 3), [])
  assert.deepEqual(parseJudgeReply('none of them match', 3), [])
  // Out-of-range, duplicate and non-integer entries drop.
  assert.deepEqual(parseJudgeReply('[0, 1, 1, 2.5, 9]', 3), [0])
})
