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

test('formats rounded presentation percent text', () => {
  assert.equal(Confidence.format(0.9), '90%')
  assert.equal(Confidence.format(0.945), '94.5%')
  assert.equal(Confidence.format(1), '100%')
})

test('exact percentage formatting preserves authored, computed, and subnormal confidence', () => {
  const values = [0, 1, 0.500001, 0.999, 0.8 * 0.9, 1 / 3, 1e-20, Number.MIN_VALUE, 1 - Number.EPSILON]
  const bits = new DataView(new ArrayBuffer(8))
  let seed = 0x12345678
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  for (let i = 0; i < 500; i += 1) {
    const exponent = next() % 1023
    bits.setUint32(0, (exponent << 20) | (next() & 0xfffff))
    bits.setUint32(4, next())
    values.push(bits.getFloat64(0))
  }
  for (const value of values) {
    const text = Confidence.formatExact(value)
    assert.match(text, /^\d+(?:\.\d+)?%$/)
    assert.equal(Confidence.parse(text), value, `${value} via ${text}`)
  }
  assert.equal(Confidence.formatExact(0.500001), '50.0001%')
  assert.equal(Confidence.parse('99.9%'), 0.999)
  assert.equal(Confidence.format(0.500001), '50%', 'rounded presentation remains available')
  for (const invalid of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
    assert.throws(() => Confidence.formatExact(invalid), RangeError)
  }
})
