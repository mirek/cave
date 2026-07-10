import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'

test('at filters claims by valid-time coverage (spec §32.4)', () => {
  const store = open()
  store.ingest([
    'alice WORKS-AT acme @2020..2023',
    'alice WORKS-AT initech @2024..',
    'alice IS engineer'
  ].join('\n'))
  const at2021 = query(store, 'alice WORKS-AT ?org', { at: '2021' })
  assert.deepEqual(at2021.map(match => match.bindings['org']), ['acme'])
  const at2026 = query(store, 'alice WORKS-AT ?org', { at: '2026-06' })
  assert.deepEqual(at2026.map(match => match.bindings['org']), ['initech'])
  // 2023 is inside the range — whole periods at both ends.
  const at2023 = query(store, 'alice WORKS-AT ?org', { at: '2023-12-31' })
  assert.deepEqual(at2023.map(match => match.bindings['org']), ['acme'])
  // Timeless claims always apply.
  assert.equal(query(store, 'alice IS engineer', { at: '1999' }).length, 1)
  store.close()
})

test('point time contexts cover their whole period (spec §32.4)', () => {
  const store = open()
  store.ingest('OpenAI HAS revenue: 20B USD/yr @2026-Q1')
  assert.equal(query(store, 'OpenAI HAS revenue: ?v', { at: '2026-02-15' }).length, 1)
  assert.equal(query(store, 'OpenAI HAS revenue: ?v', { at: '2026' }).length, 1)
  assert.equal(query(store, 'OpenAI HAS revenue: ?v', { at: '2026-04-01' }).length, 0)
  assert.equal(query(store, 'OpenAI HAS revenue: ?v').length, 1, 'without at, time contexts do not filter')
  store.close()
})

// Metric `IS` values are never bound by CAVE-Q variables (spec §10.1) —
// metric rows are reached with a payload-less pattern (`revenue IS`), and
// the interpolated value rides the match's `at`.
test('trajectories interpolate at the instant (spec §32.3)', () => {
  const store = open()
  store.ingest('revenue IS 20B -> 40B USD/yr @2025..2028')
  // 2026-07-02T12:00Z is the exact midpoint of 2025-01-01..2028-01-01.
  const mid = query(store, 'revenue IS', { at: '2026-07-02T12:00:00Z' })
  assert.equal(mid.length, 1)
  assert.equal(mid[0]!.at?.num, 30_000_000_000)
  assert.equal(mid[0]!.at?.text, '30B USD/yr')
  assert.equal(mid[0]!.at?.unit, 'USD/yr')
  const start = query(store, 'revenue IS', { at: '2025' })
  assert.equal(start[0]!.at?.num, 20_000_000_000)
  const arrived = query(store, 'revenue IS', { at: '2028' })
  assert.equal(arrived[0]!.at?.num, 40_000_000_000)
  // The end value holds through the end period's tail: 40B *in* 2028.
  const tail = query(store, 'revenue IS', { at: '2028-09' })
  assert.equal(tail[0]!.at?.num, 40_000_000_000)
  assert.equal(tail[0]!.at?.text, '40B USD/yr')
  // Outside the range the claim does not apply at all.
  assert.equal(query(store, 'revenue IS', { at: '2024' }).length, 0)
  // Without at there is no evaluation — the stored trajectory is the value.
  assert.equal(query(store, 'revenue IS')[0]!.at, undefined)
  store.close()
})

test('interpolated values substitute into value-slot bindings (spec §32.4)', () => {
  const store = open()
  store.ingest('acme HAS headcount: 100 -> 400 @2025..2027')
  const matches = query(store, 'acme HAS headcount: ?n', { at: '2026' })
  assert.equal(matches.length, 1)
  assert.equal(matches[0]!.bindings['n'], '250')
  assert.equal(matches[0]!.at?.num, 250)
  assert.equal(matches[0]!.row?.value_text, '100 -> 400', 'the stored row is untouched')
  const stored = query(store, 'acme HAS headcount: ?n')
  assert.equal(stored[0]!.bindings['n'], '100 -> 400')
  store.close()
})

test('interpolation is linear in calendar time (spec §32.3)', () => {
  const store = open()
  // 2024 is a leap year: 2025-01-01 is 366 of 731 days into 2024..2026.
  store.ingest('acme HAS headcount: 100 -> 400 @2024..2026')
  const matches = query(store, 'acme HAS headcount: ?n', { at: '2025' })
  assert.equal(matches[0]!.bindings['n'], '250.2')
  store.close()
})

test('a glued-unit trajectory interpolates in its own style (spec §32.3)', () => {
  const store = open()
  store.ingest('db/query-time IS 5ms -> 800ms @2026-04-10..04-11')
  const mid = query(store, 'db/query-time IS', { at: '2026-04-10T12:00:00Z' })
  assert.equal(mid.length, 1)
  assert.equal(mid[0]!.at?.text, '402.5ms')
  assert.equal(query(store, 'db/query-time IS', { at: '2026-04-12' }).length, 0)
  store.close()
})

test('no interpolation without exactly one closed range (spec §32.3)', () => {
  const store = open()
  store.ingest([
    'a IS 10 -> 20 @2026..',
    'b IS 10 -> 20',
    'c IS 10 -> 20 @2024..2025 @2026..2027'
  ].join('\n'))
  const open_ = query(store, 'a IS', { at: '2030' })
  assert.equal(open_.length, 1, 'the open range still covers the instant')
  assert.equal(open_[0]!.at, undefined, 'but nothing anchors the far endpoint')
  const timeless = query(store, 'b IS', { at: '2030' })
  assert.equal(timeless.length, 1)
  assert.equal(timeless[0]!.at, undefined)
  const ambiguous = query(store, 'c IS', { at: '2026-07' })
  assert.equal(ambiguous.length, 1)
  assert.equal(ambiguous[0]!.at, undefined, 'two closed ranges are ambiguous — no interpolation')
  store.close()
})

test('at composes with asOf: belief time and valid time are independent (spec §32.4)', () => {
  const store = open()
  store.ingest('revenue IS 20B -> 40B USD/yr @2025..2028')
  const before = store.claimsAbout('revenue')[0]!.tx
  store.ingest('revenue IS 20B -> 60B USD/yr @2025..2028')
  const now = query(store, 'revenue IS', { at: '2026-07-02T12:00:00Z' })
  assert.equal(now.length, 1, 'one belief series — the re-estimate supersedes')
  assert.equal(now[0]!.at?.text, '40B USD/yr', 'current belief interpolates')
  const then = query(store, 'revenue IS', { at: '2026-07-02T12:00:00Z', asOf: before })
  assert.equal(then[0]!.at?.text, '30B USD/yr', 'what we believed then about that moment')
  store.close()
})

test('at rejects unparseable anchors and transitive patterns (spec §32.4)', () => {
  const store = open()
  store.ingest('terrier EXTENDS dog\ndog EXTENDS animal')
  assert.throws(() => query(store, '?x EXTENDS ?y', { at: 'someday' }), /cannot parse at anchor/)
  assert.throws(() => query(store, 'terrier EXTENDS+ animal', { at: '2026' }), /transitive/)
  store.close()
})
