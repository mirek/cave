import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { Score } from '@cavelang/eval'

const golden = (text: string): readonly Score.Fact[] => {
  const { facts, problems } = Score.goldenFacts(text)
  assert.deepEqual(problems, [])
  return facts
}

test('actor stamps are ignored in scoring; content sources are identity (spec §9.5)', () => {
  const goldenFacts = golden([
    'helena PARENT-OF jan',
    'jan HAS birthplace: Kraków @src:maria'
  ].join('\n'))

  const store = open()
  // The engine stamps the actor — a different one per surface — but the
  // fact is the same; the fixture's @src:maria must stay significant.
  store.ingest('helena PARENT-OF jan', { source: 'agent/claude-code' })
  store.ingest('jan HAS birthplace: Kraków @src:maria', { source: 'agent/claude-code' })
  const produced = Score.producedFacts(store)
  const comparison = Score.compare(goldenFacts, produced)
  assert.equal(comparison.matched, 2)
  assert.equal(comparison.f1, 1)

  const wrongSource = open()
  wrongSource.ingest('helena PARENT-OF jan', { source: 'cli' })
  wrongSource.ingest('jan HAS birthplace: Kraków @src:grandma', { source: 'cli' })
  const off = Score.compare(goldenFacts, Score.producedFacts(wrongSource))
  assert.equal(off.matched, 1, 'a differing content source is a different fact')
  assert.equal(off.misses.length, 1)
  assert.equal(off.extras.length, 1)
  store.close()
  wrongSource.close()
})

test('ingest-digest provenance claims are not extraction output', () => {
  const store = open()
  store.ingest('a IS b')
  store.ingest('notes.md HAS ingest-digest: 93a01c626b3f @src:cave-ingest')
  assert.deepEqual(Score.producedFacts(store).map(fact => fact.claim.subject.text), ['a'])
  store.close()
})

test('the golden is a belief series — the last claim per key wins', () => {
  const facts = golden([
    'server IS compromised @ 90%',
    'server IS compromised @ 5%'
  ].join('\n'))
  assert.equal(facts.length, 1)
  assert.equal(facts[0]!.claim.conf, 0.05)
})

test('value agreement: exact by default, relative tolerance, units, text values', () => {
  const [estimate] = golden('openai HAS revenue: ~20B USD/yr')
  const near = (text: string): Score.Fact =>
    ({ key: estimate!.key, claim: golden(text)[0]!.claim })

  assert.equal(Score.valueAgrees(estimate!.claim, near('openai HAS revenue: 20B USD/yr').claim), true,
    '~ approximation is metadata')
  assert.equal(Score.valueAgrees(estimate!.claim, near('openai HAS revenue: 21B USD/yr').claim), false)
  assert.equal(Score.valueAgrees(estimate!.claim, near('openai HAS revenue: 21B USD/yr').claim, 0.05), true)
  assert.equal(Score.valueAgrees(estimate!.claim, near('openai HAS revenue: 20B USD/mo').claim, 0.05), false,
    'units never blur')

  const [baker] = golden('helena HAS occupation: baker')
  assert.equal(Score.valueAgrees(baker!.claim, golden('helena HAS occupation: baker')[0]!.claim), true)
  assert.equal(Score.valueAgrees(baker!.claim, golden('helena HAS occupation: bakery-owner')[0]!.claim), false)
})

test('compare: matched, value-off, misses, extras, precision/recall/F1', () => {
  const goldenFacts = golden([
    'PARENT-OF IS verb',
    'helena PARENT-OF jan',
    'jan HAS birth-year: 1932 @src:maria @ 70%',
    'helena HAS occupation: baker'
  ].join('\n'))
  const store = open()
  store.ingest([
    'PARENT-OF IS verb',
    'helena PARENT-OF jan',
    'jan HAS birth-year: 1931 @src:maria', // right fact, wrong value
    'piotr IS related-family'              // extra
  ].join('\n'), { source: 'ingest/abc' })
  const comparison = Score.compare(goldenFacts, Score.producedFacts(store))
  assert.equal(comparison.golden, 4)
  assert.equal(comparison.produced, 4)
  assert.equal(comparison.matched, 2)
  assert.equal(comparison.valueOff, 1)
  assert.deepEqual(comparison.misses.map(Score.lineOf).sort(), [
    'helena HAS occupation: baker',
    'jan HAS birth-year: 1932 @src:maria @ 70%'
  ])
  assert.deepEqual(comparison.extras.map(Score.lineOf).sort(), [
    'jan HAS birth-year: 1931 @src:maria',
    'piotr IS related-family'
  ])
  assert.equal(comparison.precision, 0.5)
  assert.equal(comparison.recall, 0.5)
  assert.equal(comparison.f1, 0.5)
  store.close()
})

test('inverse writes score against primary-direction goldens (spec §5.5)', () => {
  const goldenFacts = golden([
    'PARENT-OF IS verb',
    'PARENT-OF REVERSE CHILD-OF',
    'helena PARENT-OF jan'
  ].join('\n'))
  const store = open()
  // The agent wrote the inverse direction — same fact, same key.
  store.ingest('PARENT-OF IS verb\nPARENT-OF REVERSE CHILD-OF\njan CHILD-OF helena', { source: 'cli' })
  const comparison = Score.compare(goldenFacts, Score.producedFacts(store))
  assert.equal(comparison.matched, 3)
  assert.equal(comparison.f1, 1)
  store.close()
})

test('empty sides stay defined: zero produced, zero golden', () => {
  const goldenFacts = golden('a IS b')
  const empty = Score.compare(goldenFacts, [])
  assert.equal(empty.precision, 0)
  assert.equal(empty.recall, 0)
  assert.equal(empty.f1, 0)
  const nothingExpected = Score.compare([], [])
  assert.equal(nothingExpected.f1, 0)
})
