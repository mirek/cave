import { test } from 'node:test'
import assert from 'node:assert/strict'

const { validatePerformanceBaseline, assertPerformanceCoverage } = await import(
  new URL('../../../scripts/performance-baseline.mjs', import.meta.url).href)

const baseline = () => ({
  format: 'cave.performance-baseline', version: 1, runtime: 'fixture',
  workloads: { work: { baselineMs: 1, thresholdMs: 25 } },
})

test('performance baseline validation rejects unusable budgets and metadata', () => {
  assert.doesNotThrow(() => validatePerformanceBaseline(baseline()))
  for (const thresholdMs of ['25', null, undefined, NaN, Infinity, -1, 0, 26]) {
    assert.throws(() => validatePerformanceBaseline({ ...baseline(), workloads: {
      work: { baselineMs: 1, thresholdMs },
    } }), /invalid baseline budget for work/)
  }
  for (const value of [null, [], {}, { ...baseline(), runtime: '' },
    { ...baseline(), workloads: {} }, { ...baseline(), workloads: [] },
    { ...baseline(), workloads: { work: null } },
    { ...baseline(), workloads: { work: { baselineMs: 0, thresholdMs: 1 } } },
    { ...baseline(), workloads: { work: { baselineMs: 1, thresholdMs: 2, runtime: 42 } } }]) {
    assert.throws(() => validatePerformanceBaseline(value), /performance benchmark:/)
  }
})

test('performance coverage requires every recorded workload and rejects unrecorded results', () => {
  assert.doesNotThrow(() => assertPerformanceCoverage(baseline(), { work: {} }))
  assert.throws(() => assertPerformanceCoverage(baseline(), {}), /unmeasured: work/)
  assert.throws(() => assertPerformanceCoverage(baseline(), Object.create({ work: {} })), /unmeasured: work/)
  assert.throws(() => assertPerformanceCoverage(baseline(), { work: {}, unexpected: {} }), /unrecorded: unexpected/)
})
