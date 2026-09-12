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

for (const [firstActor, secondActor] of [
  ['cli', 'agent/reviewer'],
  ['agent/extractor', 'ingest'],
  ['ingest', 'cli']
] as const) for (const lifecycle of [false, true]) {
  test(`scoring merges actor histories by latest transaction: ${firstActor}, ${secondActor}, lifecycle=${lifecycle}`, () => {
    const store = open()
    try {
      store.ingest('api HAS count: 10 @src:notes.md', { source: firstActor, lifecycle })
      store.ingest('api HAS count: 20 @src:notes.md', { source: secondActor, lifecycle })
      store.ingest('api HAS count: 30 @src:notes.md', { source: firstActor, lifecycle })
      store.ingest('api HAS count: 99 @src:other.md', { source: secondActor, lifecycle })
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const provenance = store.db.prepare('SELECT * FROM cave_provenance ORDER BY claim_id, dimension, value').all()
      assert.ok(provenance.length > 0)
      assert.equal(before.length, 4)
      assert.equal(store.currentBeliefs().length, lifecycle ? 3 : 2,
        'lifecycle stamps retain separate series; authored sources otherwise suppress compatibility stamps')

      const produced = Score.producedFacts(store)
      const expected = golden('api HAS count: 30 @src:notes.md\napi HAS count: 99 @src:other.md')
      assert.equal(produced.length, 2, 'actor histories merge while content sources stay distinct')
      const result = Score.compare(expected, produced)
      assert.equal(result.matched, 2)
      assert.equal(result.f1, 1)
      assert.deepEqual(produced.map(Score.lineOf).sort(), expected.map(Score.lineOf).sort())

      const stale = Score.compare(golden('api HAS count: 20 @src:notes.md'), produced)
      assert.equal(stale.matched, 0)
      assert.equal(stale.valueOff, 1, 'a superseded actor value cannot satisfy the golden')
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before,
        'scoring leaves stored claim history intact')
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_provenance ORDER BY claim_id, dimension, value').all(),
        provenance, 'scoring leaves structured provenance intact')
      assert.equal(Score.compare(expected, Score.producedFacts(store)).f1, 1)
    } finally {
      store.close()
    }
  })
}

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

test('numeric scoring rejects invalid tolerances even for empty comparisons', () => {
  const [fact] = golden('api HAS count: 10')
  for (const tolerance of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
    assert.throws(() => Score.valueAgrees(fact!.claim, fact!.claim, tolerance), /tolerance must be a finite number in \[0, 1\]/)
    assert.throws(() => Score.compare([], [], { tolerance }), /tolerance must be a finite number in \[0, 1\]/)
  }
  assert.equal(Score.valueAgrees(fact!.claim, golden('api HAS count: 20')[0]!.claim, 1), true)
})

test('comparison uses the validated tolerance for every fact', () => {
  const expected = golden('api HAS count: 100\nworker HAS count: 100')
  const produced = golden('api HAS count: 105\nworker HAS count: 105')
  let reads = 0
  const result = Score.compare(expected, produced, {
    get tolerance() { return ++reads === 1 ? 0.1 : 0 }
  })
  assert.equal(result.matched, 2)
  assert.equal(result.valueOff, 0)
  assert.equal(result.f1, 1)
  assert.equal(reads, 1)
  assert.equal(Score.compare(expected, produced, { tolerance: 0 }).matched, 0)
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
  ].join('\n'), { source: 'ingest' })
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

test('direct comparisons score each key once using its last supplied fact', () => {
  const [older] = golden('api HAS count: 1')
  const [latest] = golden('api HAS count: 2')
  assert.ok(older && latest)
  const expected = Score.compare([latest], [latest])
  for (const [left, right] of [
    [[latest, latest], [latest]],
    [[latest], [latest, latest]],
    [[older, latest], [older, latest]],
  ] as const) assert.deepEqual(Score.compare(left, right), expected)
  const changed = Score.compare([older, latest], [latest, older])
  assert.equal(changed.golden, 1)
  assert.equal(changed.produced, 1)
  assert.equal(changed.matched, 0)
  assert.equal(changed.valueOff, 1)
  assert.deepEqual(changed.misses, [latest])
  assert.deepEqual(changed.extras, [older])
})

test('relative tolerance stays accurate for subnormal numeric values', () => {
  const [template] = golden('api HAS count: 1')
  assert.ok(template)
  const fact = (num: number): Score.Fact => {
    const claim = structuredClone(template.claim)
    assert.equal(claim.payload.kind, 'attribute')
    if (claim.payload.kind !== 'attribute') throw new Error('expected attribute')
    return { key: template.key, claim: {
      ...claim, payload: { ...claim.payload, value: { ...claim.payload.value, num } }
    } }
  }
  for (const sign of [1, -1]) {
    const expected = fact(sign * Number.MIN_VALUE * 2)
    const produced = fact(sign * Number.MIN_VALUE)
    assert.equal(Score.compare([expected], [produced], { tolerance: 0.4 }).matched, 0)
    assert.equal(Score.compare([expected], [produced], { tolerance: 0.5 }).matched, 1)
    assert.equal(Score.compare([expected], [produced]).matched, 0)
  }
  assert.equal(Score.compare([fact(0)], [fact(Number.MIN_VALUE)], { tolerance: 1 }).matched, 0)
  assert.equal(Score.compare([fact(Number.MAX_VALUE)], [fact(-Number.MAX_VALUE)], { tolerance: 1 }).matched, 0)
})
