import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Time, Value } from '@cavelang/core'

test('simple units glue to the number (spec §7.1)', () => {
  assert.deepEqual(Value.parse('30ms'), { raw: '30ms', kind: 'number', approx: false, num: 30, unit: 'ms' })
  assert.deepEqual(Value.parse('3600s'), { raw: '3600s', kind: 'number', approx: false, num: 3600, unit: 's' })
  assert.deepEqual(Value.parse('10mo'), { raw: '10mo', kind: 'number', approx: false, num: 10, unit: 'mo' })
})

test('multipliers normalize (spec §13.4 step 8)', () => {
  assert.equal(Value.parse('20B').num, 20_000_000_000)
  assert.equal(Value.parse('900M').num, 900_000_000)
  assert.equal(Value.parse('1.5T').num, 1_500_000_000_000)
  assert.equal(Value.parse('10K').num, 10_000)
})

test('compound units use a space, / means per (spec §7.1)', () => {
  const revenue = Value.parse('20B USD/yr')
  assert.equal(revenue.num, 20_000_000_000)
  assert.equal(revenue.unit, 'USD/yr')
  assert.equal(revenue.raw, '20B USD/yr')
  const users = Value.parse('900M users/wk')
  assert.equal(users.num, 900_000_000)
  assert.equal(users.unit, 'users/wk')
})

test('space-separated plain unit (spec §7.1: pool HAS max: 20 conn)', () => {
  assert.deepEqual(Value.parse('20 conn'), { raw: '20 conn', kind: 'number', approx: false, num: 20, unit: 'conn' })
})

test('% is a unit (spec §7.1)', () => {
  assert.deepEqual(Value.parse('94.5%'), { raw: '94.5%', kind: 'number', approx: false, num: 94.5, unit: '%' })
})

test('~ prefix means approximate, raw preserved (spec §7.1)', () => {
  const value = Value.parse('~20B USD/yr')
  assert.equal(value.approx, true)
  assert.equal(value.num, 20_000_000_000)
  assert.equal(value.unit, 'USD/yr')
  assert.equal(value.raw, '~20B USD/yr')
  assert.equal(Value.parse('~30ms').approx, true)
})

test('negative and decimal numbers', () => {
  assert.equal(Value.parse('-3.5ms').num, -3.5)
  assert.equal(Value.parse('-2B').num, -2_000_000_000)
})

test('bare year is a number, dashed forms are date-like (spec §16 date_like)', () => {
  assert.equal(Value.parse('2026').kind, 'number')
  assert.equal(Value.parse('2026').num, 2026)
  assert.equal(Value.parse('2026-H2').kind, 'date')
  assert.equal(Value.parse('2026-Q1').kind, 'date')
  assert.equal(Value.parse('2026-04').kind, 'date')
  assert.equal(Value.parse('2026-04-10').kind, 'date')
})

test('date classification uses calendar-valid temporal periods', () => {
  for (const text of ['2024-02-29', '2026-04', '2026-Q4', '2026-H2', '2020-W53']) {
    assert.equal(Value.isDateLike(text), true, text)
    assert.equal(Value.parse(text).kind, 'date', text)
    assert.notEqual(Time.parsePeriod(text), undefined, text)
  }
  for (const text of ['2025-02-29', '2026-04-31', '2026-13', '2021-W53', '2026-W00', '2026-Q5']) {
    assert.equal(Value.isDateLike(text), false, text)
    assert.equal(Value.parse(text).kind, 'atom', text)
  }
})

test('atoms stay textual', () => {
  assert.deepEqual(Value.parse('token-expiry'), { raw: 'token-expiry', kind: 'atom', approx: false })
  assert.equal(Value.parse('critical').kind, 'atom')
  assert.equal(Value.parse('source-to-target').kind, 'atom')
})

test('multiplier letter alone stays glued, longer runs are units', () => {
  assert.equal(Value.parse('20B').unit, undefined)
  assert.equal(Value.parse('20Bq').unit, 'Bq')
  assert.equal(Value.parse('20Bq').num, 20)
})

test('domain-specific units pass through verbatim (spec §7.1)', () => {
  assert.equal(Value.parse('1000 req/s').unit, 'req/s')
  assert.equal(Value.parse('50 tps').unit, 'tps')
})

test('trajectories: two endpoints, shared unit (spec §32.3)', () => {
  const revenue = Value.parse('20B -> 40B USD/yr')
  assert.equal(revenue.kind, 'trajectory')
  assert.equal(revenue.from, 20_000_000_000)
  assert.equal(revenue.to, 40_000_000_000)
  assert.equal(revenue.unit, 'USD/yr')
  assert.equal(revenue.num, undefined) // a trajectory is not one number
  assert.equal(revenue.raw, '20B -> 40B USD/yr')
  const latency = Value.parse('5ms -> 800ms')
  assert.equal(latency.kind, 'trajectory')
  assert.equal(latency.from, 5)
  assert.equal(latency.to, 800)
  assert.equal(latency.unit, 'ms')
  const plain = Value.parse('10 -> 20')
  assert.equal(plain.kind, 'trajectory')
  assert.equal(plain.unit, undefined)
  assert.equal(Value.parse('~20B -> 40B USD/yr').approx, true)
  assert.equal(Value.parse('-5 -> 5 C').from, -5)
})

test('malformed trajectories degrade to atoms (spec §1.6)', () => {
  assert.equal(Value.parse('20B -> soon').kind, 'atom')
  assert.equal(Value.parse('20ms -> 40s').kind, 'atom') // endpoint units disagree
  assert.equal(Value.parse('10 -> 20 -> 30').kind, 'atom')
  assert.equal(Value.parse('-> 40B').kind, 'atom')
})

test('interpolate and formatAt: linear, clamped, styled (spec §32.3)', () => {
  const revenue = Value.parse('20B -> 40B USD/yr')
  assert.equal(Value.interpolate(revenue, 0), 20_000_000_000)
  assert.equal(Value.interpolate(revenue, 0.5), 30_000_000_000)
  assert.equal(Value.interpolate(revenue, 2), 40_000_000_000) // clamped
  assert.equal(Value.formatAt(revenue, 0.5), '30B USD/yr')
  const latency = Value.parse('5ms -> 800ms')
  assert.equal(Value.formatAt(latency, 0.5), '402.5ms') // glued unit stays glued
  const conn = Value.parse('10 conn -> 20 conn')
  assert.equal(Value.formatAt(conn, 0.5), '15 conn')
  assert.equal(Value.interpolate(Value.parse('30ms'), 0.5), undefined)
  assert.equal(Value.formatAt(Value.parse('30ms'), 0.5), undefined)
})

test('formatNumber: plain decimal, never exponent notation (spec §16 number)', () => {
  assert.equal(Value.formatNumber(42), '42')
  assert.equal(Value.formatNumber(-3.5), '-3.5')
  assert.equal(Value.formatNumber(0), '0')
  assert.equal(Value.formatNumber(1e-7), '0.0000001')
  assert.equal(Value.formatNumber(1.5e-7), '0.00000015')
  assert.equal(Value.formatNumber(-1.23e-7), '-0.000000123')
  assert.equal(Value.formatNumber(1e21), '1000000000000000000000')
  assert.equal(Value.formatNumber(-1.5e21), '-1500000000000000000000')
  // Full-precision round-trip through the CAVE number grammar.
  for (const n of [1e-7, -1e-7, 5e-324, 1.7976931348623157e308, 123.456, 1e21, 2026]) {
    const text = Value.formatNumber(n)
    assert.doesNotMatch(text, /[eE]/, text)
    const parsed = Value.parse(text)
    assert.equal(parsed.kind, 'number', text)
    assert.equal(parsed.num, n)
  }
  assert.throws(() => Value.formatNumber(Infinity))
  assert.throws(() => Value.formatNumber(-Infinity))
  assert.throws(() => Value.formatNumber(NaN))
})

test('formatAt keeps tiny interpolations in plain decimal (exponent-notation bug)', () => {
  const drift = Value.parse('0.0000001 -> 0.0000005')
  assert.equal(drift.kind, 'trajectory')
  const at = Value.formatAt(drift, 0.5)
  assert.equal(at, '0.0000003')
  assert.equal(Value.parse(at!).kind, 'number', 'the emitted scalar re-parses as a number, not an atom')
})

test('quoted constructors and format round-trip', () => {
  assert.equal(Value.format(Value.ofText('install dependencies')), '"install dependencies"')
  assert.equal(Value.format(Value.ofCode('<=')), '`<=`')
  assert.equal(Value.format(Value.parse('~20B USD/yr')), '~20B USD/yr')
})

test('isUnit and isDateLike predicates', () => {
  assert.equal(Value.isUnit('USD/yr'), true)
  assert.equal(Value.isUnit('%'), true)
  assert.equal(Value.isUnit('users/wk'), true)
  assert.equal(Value.isUnit('9x'), false)
  assert.equal(Value.isDateLike('2026-W07'), true)
  assert.equal(Value.isDateLike('2026'), false)
})

test('trajectory interpolation preserves finite extremes and exact endpoints', () => {
  for (const [from, to] of [[-1e308, 1e308], [1e308, -1e308], [1e308, 1], [1, 1e308]] as const) {
    const value = Value.parse(`${Value.formatNumber(from)} -> ${Value.formatNumber(to)}`)
    assert.equal(value.kind, 'trajectory')
    assert.equal(Value.interpolate(value, 0), from)
    assert.equal(Value.interpolate(value, 1), to)
    assert.equal(Value.interpolate(value, -1), from)
    assert.equal(Value.interpolate(value, 2), to)
    for (const fraction of [0.25, 0.5, 0.75]) assert.ok(Number.isFinite(Value.interpolate(value, fraction)))
    if (from === -to) assert.equal(Value.interpolate(value, 0.5), 0)
  }
})

test('trajectory display rounding does not overflow a finite interpolated value', () => {
  for (const sign of [-1, 1]) {
    for (const multiplier of ['', 'T']) {
      const endpoint = `${Value.formatNumber(sign * (multiplier === 'T' ? 1.7976e308 : Number.MAX_VALUE) / (multiplier === 'T' ? 1e12 : 1))}${multiplier}`
      const value = Value.parse(`${endpoint} -> ${endpoint}`)
      assert.ok(Number.isFinite(value.from))
      const formatted = Value.formatAt(value, 0.5)
      assert.ok(formatted)
      assert.equal(Value.parse(formatted).num, value.from)
    }
  }
})

test('overflowing numeric literals retain text instead of non-finite values', () => {
  const huge = '9'.repeat(400)
  const finite = Value.formatNumber(1e308)
  for (const raw of [huge, `-${huge}`, `${huge}ms`, `${huge} USD`, `${finite}T`, `${huge} -> 1`, `1 -> ${huge}`, `~${huge}`]) {
    const value = Value.parse(raw)
    assert.equal(value.kind, 'atom', raw)
    assert.equal(value.raw, raw)
    assert.equal(value.num, undefined)
    assert.equal(value.from, undefined)
    assert.equal(value.to, undefined)
  }
  assert.equal(Value.parse(Value.formatNumber(Number.MAX_VALUE)).num, Number.MAX_VALUE)
})

test('multipliers normalize decimal text before floating-point conversion', () => {
  assert.equal(Value.parse('1.001K').num, Value.parse('1001').num)
  const tiny = `0.${'0'.repeat(324)}1`
  for (const [suffix, exponent] of [['K', 3], ['M', 6], ['B', 9], ['T', 12]] as const) {
    assert.equal(Value.parse(`${tiny}${suffix}`).num, Number(`1e${exponent - 325}`))
    assert.equal(Value.parse(`-${tiny}${suffix}`).num, -Number(`1e${exponent - 325}`))
  }
})

test('unrepresentable nonzero magnitudes retain their text instead of becoming zero', () => {
  const tiny = `0.${'0'.repeat(324)}1`
  for (const raw of [tiny, `-${tiny}`, `${tiny}ms`, `${tiny} -> 1`, `1 -> ${tiny}`, `~${tiny}`]) {
    const value = Value.parse(raw)
    assert.equal(value.kind, 'atom')
    assert.equal(value.raw, raw)
    assert.equal(value.num, undefined)
  }
  assert.equal(Value.parse(`0.${'0'.repeat(400)}`).num, 0)
  assert.equal(Value.parse(Value.formatNumber(Number.MIN_VALUE)).num, Number.MIN_VALUE)
})
