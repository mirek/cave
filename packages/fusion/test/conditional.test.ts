import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { noisyAndIndependent, normalizeHypotheses, hypothesisGap } from '@cavelang/fusion'

test('confidence helpers reject malformed probabilities even after a zero factor', () => {
  for (const conf of [-1, 1.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => noisyAndIndependent(conf, []), RangeError)
    assert.throws(() => noisyAndIndependent(0, [conf]), RangeError)
    assert.throws(() => normalizeHypotheses([{ conf }]), RangeError)
    assert.throws(() => hypothesisGap([conf]), RangeError)
  }
})

test('confidence helpers reject sparse evidence arrays', () => {
  for (const values of [new Array<number>(1), [0, , 0.5], [, 1]]) {
    assert.throws(() => noisyAndIndependent(0, values as number[]), RangeError)
    assert.throws(() => hypothesisGap(values as number[]), RangeError)
  }
  for (const hypotheses of [new Array<{ conf: number }>(1), [{ conf: 0.5 }, , { conf: 0.5 }]]) {
    assert.throws(() => normalizeHypotheses(hypotheses as { conf: number }[]))
  }
  assert.deepEqual(normalizeHypotheses([]), undefined)
  assert.equal(hypothesisGap([]), -1)
})

test('spec §10.2 example: 0.8 × 0.6 = 0.48', () => {
  assert.ok(Math.abs(noisyAndIndependent(0.8, [0.6]) - 0.48) < 1e-12)
})

test('no conditions leaves the claim confidence untouched', () => {
  assert.equal(noisyAndIndependent(0.8, []), 0.8)
})

test('multiple independent conditions multiply', () => {
  assert.ok(Math.abs(noisyAndIndependent(0.9, [0.5, 0.5]) - 0.225) < 1e-12)
})

test('spec §10.3: hypothesis sets renormalize preserving proportions', () => {
  const hypotheses = [
    { cause: 'memory-leak', conf: 0.75 },
    { cause: 'deadlock', conf: 0.15 },
    { cause: 'oom-killer', conf: 0.1 }
  ]
  const normalized = normalizeHypotheses(hypotheses)
  assert.ok(normalized)
  assert.ok(Math.abs(normalized.reduce((sum, h) => sum + h.conf, 0) - 1) < 1e-12)
  assert.equal(normalized[0]!.conf, 0.75)
  const skewed = normalizeHypotheses([{ conf: 1 }, { conf: 1 }])
  assert.deepEqual(skewed?.map(h => h.conf), [0.5, 0.5])
})

test('hypothesis totals retain small probabilities beside a dominant hypothesis', () => {
  const small = Array.from({ length: 10_000 }, () => 1e-16)
  const expected = 1 + small.length * 1e-16
  for (const confs of [[1, ...small], [...small, 1]]) {
    // Measure the excess directly; (1 + excess) - 1 introduces cancellation.
    const expectedGap = small.length * 1e-16
    assert.ok(Math.abs(hypothesisGap(confs) - expectedGap) < expectedGap * 1e-12)
    const hypotheses = confs.map((conf, index) => Object.freeze({ conf, index }))
    const normalized = normalizeHypotheses(Object.freeze(hypotheses))!
    const dominant = confs.indexOf(1)
    assert.equal(normalized[dominant]!.conf, 1 / expected)
    assert.equal(normalized[dominant]!.index, dominant)
    assert.equal(hypotheses[dominant]!.conf, 1)
    assert.notEqual(normalized[dominant], hypotheses[dominant])
  }
  assert.deepEqual(normalizeHypotheses([{ conf: Number.MIN_VALUE }, { conf: Number.MIN_VALUE }]),
    [{ conf: 0.5 }, { conf: 0.5 }])
})

test('all-zero hypothesis sets cannot normalize', () => {
  assert.equal(normalizeHypotheses([{ conf: 0 }, { conf: 0 }]), undefined)
})

test('hypothesisGap measures distance from exhaustiveness', () => {
  assert.ok(Math.abs(hypothesisGap([0.5, 0.3, 0.2])) < 1e-12)
  assert.ok(hypothesisGap([0.5, 0.2]) < 0)
  assert.ok(hypothesisGap([0.9, 0.9]) > 0)
})

test('conditional helpers calculate with the confidence values they validate', () => {
  let reads = 0
  const conditions = [0.5]
  Object.defineProperty(conditions, '0', { get: () => ++reads === 1 ? 0.5 : NaN })
  assert.equal(noisyAndIndependent(0.8, conditions), 0.4)
  assert.equal(reads, 1)
})

test('hypothesis normalization captures confidence once with metadata preserved', () => {
  let reads = 0
  const hypothesis = { name: 'first', get conf() { return ++reads === 1 ? 0.5 : NaN } }
  assert.deepEqual(normalizeHypotheses([hypothesis, { name: 'second', conf: 0.5 }]), [
    { name: 'first', conf: 0.5 }, { name: 'second', conf: 0.5 }
  ])
  assert.equal(reads, 1)
})

test('hypothesis capture retains inherited confidence and enumerable symbol metadata', () => {
  const label = Symbol('label')
  const hypothesis = Object.assign(Object.create({ conf: 0.5 }), { name: 'first', [label]: 'kept' })
  assert.deepEqual(normalizeHypotheses([hypothesis]), [{ name: 'first', [label]: 'kept', conf: 1 }])
})

test('hypothesis gaps retain excess probability below the rounding threshold at one', () => {
  for (const excess of [2 ** -54, Number.MIN_VALUE]) {
    assert.equal(hypothesisGap([1, excess]), excess)
    assert.equal(hypothesisGap([excess, 1]), excess)
  }
})

test('hypothesis gaps retain a representable deficit after near-unit cancellation', () => {
  const values = [1 - 2 ** -52, 2 ** -53, 2 ** -54]
  for (const confs of [values, [...values].reverse(), [values[1]!, values[0]!, values[2]!]]) {
    assert.equal(hypothesisGap(confs), -(2 ** -54))
  }
})

test('hypothesis gaps agree with exact integer sums for ordered near-unit dyadic inputs', () => {
  const unit = 1n << 64n
  let checked = 0
  const signs = new Set<number>()
  for (let seed = 0; seed < 256; seed++) {
    // Every numerator is exactly representable as a double; the dominant
    // probability is aligned to 2^-52 and all terms share a 2^64 denominator.
    const numerators = [
      unit - BigInt(Math.floor(seed / 16)) * 4096n,
      BigInt((seed * 13) % 4096),
      BigInt((seed * 31) % 4096),
      BigInt(seed % 17) * 16n,
    ]
    const exactGap = numerators.reduce((sum, value) => sum + value, -unit)
    const expected = Number(exactGap) * 2 ** -64
    signs.add(Math.sign(expected))
    const values = numerators.map(value => Number(value) * 2 ** -64)
    for (const ordered of [values, [...values].reverse(), [...values.slice(1), values[0]!]]) {
      assert.equal(hypothesisGap(ordered), expected, `seed ${seed}, order ${checked % 3}`)
      checked++
    }
  }
  assert.equal(checked, 768)
  assert.deepEqual([...signs].sort((a, b) => a - b), [-1, 0, 1])
})
