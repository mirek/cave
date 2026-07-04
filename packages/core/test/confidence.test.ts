import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Confidence } from '@cavelang/core'

test('parses percentage to decimal (spec §13.4 step 6)', () => {
  assert.equal(Confidence.parse('90%'), 0.9)
  assert.equal(Confidence.parse('70%'), 0.7)
  assert.equal(Confidence.parse('0%'), 0)
  assert.equal(Confidence.parse('100%'), 1)
  assert.equal(Confidence.parse('94.5%'), 0.945)
})

test('rejects non-percentages, including percent-less numbers (spec §16)', () => {
  assert.equal(Confidence.parse('90'), undefined)
  assert.equal(Confidence.parse('2026'), undefined)
  assert.equal(Confidence.parse('production'), undefined)
  assert.equal(Confidence.parse('%'), undefined)
  assert.equal(Confidence.parse(''), undefined)
})

test('clamps out-of-range values', () => {
  assert.equal(Confidence.parse('150%'), 1)
  assert.equal(Confidence.clamp(-0.5), 0)
})

test('omitted confidence defaults to 100% (spec §6.3)', () => {
  assert.equal(Confidence.defaultConfidence, 1)
})

test('formats canonical percent text', () => {
  assert.equal(Confidence.format(0.9), '90%')
  assert.equal(Confidence.format(0.945), '94.5%')
  assert.equal(Confidence.format(1), '100%')
})
