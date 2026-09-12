/** Run alone: bounded equality explanation cost, without backend search. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Adapter, Explain, Model } from '../packages/solver/src/index.ts'

const measurements = []
for (const digits of [4096, 16384]) for (const equal of [false, true]) {
  const base = 10n ** BigInt(digits - 1)
  const a = { sort: 'real', numerator: String(base + 1n), denominator: String(base + 3n) }
  const b = equal
    ? { sort: 'real', numerator: String(2n * (base + 1n)), denominator: String(2n * (base + 3n)) }
    : { sort: 'real', numerator: String(base + 7n), denominator: String(base + 9n) }
  const model = { schema: Model.schema, variables: [{ id: 'a', sort: 'real' }, { id: 'b', sort: 'real' }],
    constraints: Array.from({ length: 64 }, (_, index) => ({ id: `compare-${index}`, expression: {
      kind: index % 2 === 0 ? 'eq' : 'neq', left: { kind: 'variable', id: 'a' }, right: { kind: 'variable', id: 'b' }
    } })) }
  const result = { status: 'satisfied', backend: { name: 'fixture', version: '1' }, elapsedMs: 0,
    diagnostics: [], assignment: { a, b } }
  const samplesMs = []
  for (let iteration = 0; iteration < 6; iteration++) {
    const start = performance.now()
    const report = Explain.report(model, result, Adapter.defaultLimits)
    const elapsed = performance.now() - start
    assert.equal(report.outcome.status, 'satisfied')
    assert.equal(report.outcome.hardConstraints.length, 64)
    report.outcome.hardConstraints.forEach((constraint, index) => {
      assert.equal(constraint.evaluation, (index % 2 === 0) === equal ? 'satisfied' : 'violated')
    })
    if (iteration > 0) samplesMs.push(elapsed)
  }
  measurements.push({ digits, equal, comparisons: 64, medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
}
console.log(JSON.stringify({ format: 'cave.explanation-equality-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: 'One warmup and five timed complete Explain.report calls per case, with 64 alternating equality/inequality constraints. Fractions near one, distinct or equivalent after reduction. Default limits; includes capture, validation, digesting and evaluation. Excludes fixture construction, assertions and backend solving. Not a general work-limit test.', measurements }, null, 2))
