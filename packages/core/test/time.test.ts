import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Time } from '@cavelang/core'

const utc = (text: string): number => Date.parse(text)

test('time points name whole calendar periods (spec §32.1)', () => {
  assert.deepEqual(Time.parsePeriod('2025'), { start: utc('2025-01-01T00:00:00Z'), end: utc('2026-01-01T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-04'), { start: utc('2026-04-01T00:00:00Z'), end: utc('2026-05-01T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-12'), { start: utc('2026-12-01T00:00:00Z'), end: utc('2027-01-01T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-04-10'), { start: utc('2026-04-10T00:00:00Z'), end: utc('2026-04-11T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-Q1'), { start: utc('2026-01-01T00:00:00Z'), end: utc('2026-04-01T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-Q4'), { start: utc('2026-10-01T00:00:00Z'), end: utc('2027-01-01T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-H2'), { start: utc('2026-07-01T00:00:00Z'), end: utc('2027-01-01T00:00:00Z') })
})

test('ISO weeks: week 1 contains Jan 4, weeks start Monday (spec §32.1)', () => {
  // 2026-01-04 is a Sunday; the week containing it starts Monday 2025-12-29.
  assert.deepEqual(Time.parsePeriod('2026-W01'), { start: utc('2025-12-29T00:00:00Z'), end: utc('2026-01-05T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2026-W15'), { start: utc('2026-04-06T00:00:00Z'), end: utc('2026-04-13T00:00:00Z') })
  assert.deepEqual(Time.parsePeriod('2020-W53'), { start: utc('2020-12-28T00:00:00Z'), end: utc('2021-01-04T00:00:00Z') })
  assert.equal(Time.parsePeriod('2021-W53'), undefined)
})

test('calendar validation covers leap years and month lengths', () => {
  assert.deepEqual(Time.parsePeriod('2024-02-29'), { start: utc('2024-02-29T00:00:00Z'), end: utc('2024-03-01T00:00:00Z') })
  assert.equal(Time.parsePeriod('2025-02-29'), undefined)
  assert.equal(Time.parsePeriod('2026-02-30'), undefined)
  assert.equal(Time.parsePeriod('2026-04-31'), undefined)
  assert.equal(Time.parsePeriod('2026-04-00'), undefined)
  assert.equal(Time.parsePeriod('2026-13'), undefined)
})

test('out-of-calendar and malformed points are not periods', () => {
  assert.equal(Time.parsePeriod('2026-W00'), undefined)
  assert.equal(Time.parsePeriod('2026-W54'), undefined)
  assert.equal(Time.parsePeriod('production'), undefined)
  assert.equal(Time.parsePeriod('306'), undefined)
})

test('ranges: closed, open-ended, whole periods at both ends (spec §32.2)', () => {
  const closed = Time.parseRange('2025..2028')
  assert.deepEqual(closed?.start, Time.parsePeriod('2025'))
  assert.deepEqual(closed?.end, Time.parsePeriod('2028'))
  assert.deepEqual(Time.parseRange('..2025'), { end: Time.parsePeriod('2025') })
  assert.deepEqual(Time.parseRange('2026..'), { start: Time.parsePeriod('2026') })
  assert.equal(Time.parseRange('..'), undefined)
  assert.equal(Time.parseRange('2028..2025'), undefined)
  assert.equal(Time.parseRange('2025..2026..2027'), undefined)
})

test('range end points abbreviate by inheriting leading segments (spec §32.2)', () => {
  const days = Time.parseRange('2026-04-10..04-11')
  assert.deepEqual(days?.end, Time.parsePeriod('2026-04-11'))
  const short = Time.parseRange('2026-04-10..11')
  assert.deepEqual(short?.end, Time.parsePeriod('2026-04-11'))
  const months = Time.parseRange('2026-04..07')
  assert.deepEqual(months?.end, Time.parsePeriod('2026-07'))
  // Q/H/W points are written in full; a bare quarter is not a period.
  assert.equal(Time.parseRange('2026-Q1..Q3'), undefined)
  assert.deepEqual(Time.parseRange('2026-Q1..2026-Q3')?.end, Time.parsePeriod('2026-Q3'))
})

test('contexts read as time when date-like, opaque otherwise (spec §32.2)', () => {
  assert.deepEqual(Time.ofContext('2026-Q1'), { kind: 'point', period: Time.parsePeriod('2026-Q1') })
  assert.deepEqual(Time.ofContext('time:2026-04-10'), { kind: 'point', period: Time.parsePeriod('2026-04-10') })
  assert.equal(Time.ofContext('2025..2028')?.kind, 'range')
  assert.equal(Time.ofContext('time:2025..2028')?.kind, 'range')
  assert.equal(Time.ofContext('production'), undefined)
  assert.equal(Time.ofContext('src:filing'), undefined)
  assert.equal(Time.ofContext('auth.ts:42'), undefined)
  assert.equal(Time.ofContext('v1..v2'), undefined)
})

test('instants: periods anchor at their start, timestamps read exactly (spec §32.4)', () => {
  assert.equal(Time.parseInstant('2026'), utc('2026-01-01T00:00:00Z'))
  assert.equal(Time.parseInstant('2026-07'), utc('2026-07-01T00:00:00Z'))
  assert.equal(Time.parseInstant('2026-04-10T14:30:00Z'), utc('2026-04-10T14:30:00Z'))
  assert.equal(Time.parseInstant('2026-04-10T14:30:00'), utc('2026-04-10T14:30:00Z'))
  assert.equal(Time.parseInstant('2026-04-10T16:30:00+02:00'), utc('2026-04-10T14:30:00Z'))
  assert.deepEqual(Time.parseBoundary('2026-Q1'), Time.parsePeriod('2026-Q1'))
  assert.equal(Time.parseTimestamp('2026-02-30T12:00:00Z'), undefined)
  assert.equal(Time.parseTimestamp('2026-04-10T24:00:00Z'), undefined)
  assert.equal(Time.parseInstant('not-a-time'), undefined)
})

test('zoneless timestamps mean UTC in every process timezone', () => {
  const moduleUrl = new URL('../src/time.ts', import.meta.url).href
  const program = `import * as Time from ${JSON.stringify(moduleUrl)}; process.stdout.write(String(Time.parseInstant('2026-04-10T14:30:00')))`
  const expected = String(utc('2026-04-10T14:30:00Z'))
  for (const TZ of ['UTC', 'Europe/Paris', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '--eval', program], {
      encoding: 'utf8',
      env: { ...process.env, TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, expected, `timestamp changed under TZ=${TZ}`)
  }
})

test('coverage: points cover their period, ranges cover whole end periods (spec §32.4)', () => {
  const q1 = Time.ofContext('2026-Q1')!
  assert.equal(Time.covers(q1, utc('2026-02-15T00:00:00Z')), true)
  assert.equal(Time.covers(q1, utc('2026-04-01T00:00:00Z')), false)
  const range = Time.ofContext('2025..2028')!
  assert.equal(Time.covers(range, utc('2024-12-31T23:59:59Z')), false)
  assert.equal(Time.covers(range, utc('2025-01-01T00:00:00Z')), true)
  assert.equal(Time.covers(range, utc('2028-12-31T23:59:59Z')), true)
  assert.equal(Time.covers(range, utc('2029-01-01T00:00:00Z')), false)
  const until = Time.ofContext('..2025')!
  assert.equal(Time.covers(until, utc('1999-01-01T00:00:00Z')), true)
  assert.equal(Time.covers(until, utc('2026-01-01T00:00:00Z')), false)
  const since = Time.ofContext('2026..')!
  assert.equal(Time.covers(since, utc('2031-01-01T00:00:00Z')), true)
  assert.equal(Time.covers(since, utc('2025-12-31T00:00:00Z')), false)
})

test('appliesAt: timeless claims always apply, any covering time context suffices (spec §32.4)', () => {
  const at2026 = utc('2026-06-01T00:00:00Z')
  assert.equal(Time.appliesAt([], at2026), true)
  assert.equal(Time.appliesAt(['production', 'src:filing'], at2026), true)
  assert.equal(Time.appliesAt(['2026'], at2026), true)
  assert.equal(Time.appliesAt(['2025'], at2026), false)
  assert.equal(Time.appliesAt(['2025', '2026-H2'], at2026), false)
  assert.equal(Time.appliesAt(['2025', '2026'], at2026), true)
  assert.equal(Time.appliesAt(['production', '2025..2028'], at2026), true)
})

test('closedRangeOf: exactly one closed range interpolates (spec §32.3)', () => {
  assert.deepEqual(Time.closedRangeOf(['production', '2025..2028']), Time.parseRange('2025..2028'))
  assert.equal(Time.closedRangeOf(['2026..']), undefined)
  assert.equal(Time.closedRangeOf(['2026']), undefined)
  assert.equal(Time.closedRangeOf(['2025..2028', '2026..2027']), undefined)
})

test('fractionAt: start-instant anchors, clamped through the end period tail (spec §32.3)', () => {
  const range = Time.parseRange('2025..2028') as { start: Time.Period, end: Time.Period }
  assert.equal(Time.fractionAt(range, utc('2025-01-01T00:00:00Z')), 0)
  assert.equal(Time.fractionAt(range, utc('2028-01-01T00:00:00Z')), 1)
  assert.equal(Time.fractionAt(range, utc('2028-06-15T00:00:00Z')), 1)
  const mid = Time.fractionAt(range, utc('2026-07-02T12:00:00Z'))
  assert.ok(Math.abs(mid - 0.5) < 0.001)
})
