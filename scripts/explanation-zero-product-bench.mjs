/** Run alone: bounded explanation arithmetic, without backend search. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Adapter, Explain, Model } from '../packages/solver/src/index.ts'

const measurements = []
for (const digits of [512, 4096]) {
  const value = '1' + '0'.repeat(digits - 1)
  for (const operands of [16, 64]) for (const zeroPosition of ['first', 'last']) {
    const model = {
      schema: Model.schema,
      variables: [{ id: 'x', sort: 'int', min: value, max: value }],
      constraints: [{ id: 'zero-product', expression: {
        kind: 'eq', left: {
          kind: 'multiply', operands: Array.from({ length: operands + 1 }, (_, index) =>
            index === (zeroPosition === 'first' ? 0 : operands)
              ? { kind: 'literal', sort: 'int', value: '0' } : { kind: 'variable', id: 'x' })
        }, right: { kind: 'literal', sort: 'int', value: '0' }
      } }]
    }
    const result = { status: 'satisfied', backend: { name: 'fixture', version: '1' },
      elapsedMs: 0, diagnostics: [], assignment: { x: { sort: 'int', value } } }
    const samplesMs = []
    for (let iteration = 0; iteration < 6; iteration++) {
      const start = performance.now()
      const report = Explain.report(model, result, Adapter.defaultLimits)
      const elapsed = performance.now() - start
      assert.equal(report.outcome.status, 'satisfied')
      assert.equal(report.outcome.hardConstraints[0].evaluation, 'satisfied')
      assert.deepEqual(report.outcome.assignments[0].value, { sort: 'int', value })
      if (iteration > 0) samplesMs.push(elapsed)
    }
    measurements.push({ assignmentDigits: digits, nonzeroOperands: operands, zeroPosition, modelNumericDigits: 2 * digits + 2,
      nonzeroProductDigits: 1 + (digits - 1) * operands,
      medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
  }
}
console.log(JSON.stringify({ format: 'cave.explanation-zero-product-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: 'One warmup and five timed Explain.report calls per case, using default limits. Construction and assertions excluded. No backend search. Values are powers of ten; exact product digit counts are derived algebraically. Timings include model validation, digesting, assignment capture and arithmetic evaluation. Nonzero operands alone would produce at most 262081 digits, but each complete product is zero. This is not a general resource-limit test.',
  measurements }, null, 2))
