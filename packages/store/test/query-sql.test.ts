import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { Uuidv7 } from '@cavelang/core'
import { QuerySql } from '@cavelang/store'

test('transaction boundaries use whole UTC periods and one-second timestamps', () => {
  const day = QuerySql.transactionBounds('2026-07-16')!
  assert.equal(Uuidv7.msOf(day.hi) - Uuidv7.msOf(day.lo), 86_400_000)
  const second = QuerySql.transactionBounds('2026-07-16T12:34:56Z')!
  assert.equal(Uuidv7.msOf(second.hi) - Uuidv7.msOf(second.lo), 1_000)
  assert.deepEqual(QuerySql.transactionBounds('2026-07-16T12:34:56'), second)
  const quarter = QuerySql.transactionBounds('2026-Q1')!
  assert.equal(Uuidv7.msOf(quarter.lo), Date.UTC(2026, 0, 1))
  assert.equal(Uuidv7.msOf(quarter.hi), Date.UTC(2026, 3, 1))
  assert.equal(QuerySql.transactionBounds('yesterday'), undefined)
})

test('as-of boundaries include exact transactions and whole named periods', () => {
  const id = Uuidv7.at(Date.UTC(2026, 6, 16), 0, new Uint8Array(8))
  assert.deepEqual(QuerySql.asOfBoundary(id.toUpperCase()), { operator: '<=', tx: id })
  assert.equal(QuerySql.asOfBoundary('2026-07-16')?.operator, '<')
  assert.equal(QuerySql.asOfBoundary('later'), undefined)
})

test('transaction periods intersect the UUID epoch without rejecting earlier calendar dates', () => {
  const epoch = Uuidv7.at(0, 0, new Uint8Array(8))
  for (const text of ['0000', '1969', '1969-12-31T23:59:58Z']) {
    assert.deepEqual(QuerySql.transactionBounds(text), { lo: epoch, hi: epoch })
    assert.deepEqual(QuerySql.asOfBoundary(text), { operator: '<', tx: epoch })
  }
  const crossing = QuerySql.transactionBounds('1969-12-31T23:59:59.500Z')!
  assert.equal(crossing.lo, epoch)
  assert.equal(Uuidv7.msOf(crossing.hi), 500)
  const week = QuerySql.transactionBounds('1970-W01')!
  assert.equal(week.lo, epoch)
  assert.equal(Uuidv7.msOf(week.hi), Date.UTC(1970, 0, 5))
})

test('the final four-digit year and maximum UUID remain usable transaction boundaries', () => {
  const year = QuerySql.transactionBounds('9999')!
  assert.equal(Uuidv7.msOf(year.lo), Date.parse('9999-01-01T00:00:00Z'))
  assert.equal(Uuidv7.msOf(year.hi), Date.parse('+010000-01-01T00:00:00Z'))
  const crossing = QuerySql.transactionBounds('9999-12-31T23:59:59.500Z')!
  assert.equal(Uuidv7.msOf(crossing.hi), Date.parse('+010000-01-01T00:00:00.500Z'))
  const maximum = 'ffffffff-ffff-7fff-bfff-ffffffffffff'
  assert.deepEqual(QuerySql.asOfBoundary(maximum.toUpperCase()), { operator: '<=', tx: maximum })
})
