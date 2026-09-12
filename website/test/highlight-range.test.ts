import assert from 'node:assert/strict'
import test from 'node:test'
import { firstSpanEndingAfter } from '../src/lib/highlight-range.ts'

test('highlight range lookup preserves boundary and gap behavior', () => {
  const spans = [{ end: 3 }, { end: 8 }, { end: 20 }]
  for (const [offset, expected] of [[0, 0], [2, 0], [3, 1], [5, 1], [8, 2], [19, 2], [20, 3], [30, 3]]) {
    assert.equal(firstSpanEndingAfter(spans, offset!), expected)
  }
  assert.equal(firstSpanEndingAfter([], 0), 0)
})

test('numbered examples find late spans without rescanning preceding captures', () => {
  let reads = 0
  const spans = Array.from({ length: 20_000 }, (_, index) => ({
    get end() { reads += 1; return index * 5 + 4 },
  }))
  for (let line = 0; line < 5_000; line++) {
    assert.equal(firstSpanEndingAfter(spans, line * 20), line * 4)
  }
  assert.ok(reads <= 5_000 * 15, `expected logarithmic lookups, observed ${reads} capture reads`)
})
