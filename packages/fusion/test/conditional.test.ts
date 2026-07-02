import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { noisyAndIndependent, normalizeHypotheses, hypothesisGap } from '@cave/fusion'

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

test('all-zero hypothesis sets cannot normalize', () => {
  assert.equal(normalizeHypotheses([{ conf: 0 }, { conf: 0 }]), undefined)
})

test('hypothesisGap measures distance from exhaustiveness', () => {
  assert.ok(Math.abs(hypothesisGap([0.5, 0.3, 0.2])) < 1e-12)
  assert.ok(hypothesisGap([0.5, 0.2]) < 0)
  assert.ok(hypothesisGap([0.9, 0.9]) > 0)
})
