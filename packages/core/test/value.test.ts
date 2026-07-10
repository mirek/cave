import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Value } from '@cavelang/core'

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
