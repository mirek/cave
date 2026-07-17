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
