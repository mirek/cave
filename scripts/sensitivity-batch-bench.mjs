/** Run alone: measure workflow overhead with an immediate unknown-result adapter. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Adapter, Model, Workflow } from '../packages/solver/src/index.ts'

const measurements = []
for (const constraints of [0, 100, 1000]) {
  const model = {
    schema: Model.schema,
    variables: [{ id: 'cost', sort: 'int', min: 0, max: 1000 }],
    constraints: Array.from({ length: constraints }, (_, index) => ({
      id: `bound-${index}`, expression: { kind: 'gte', left: { kind: 'variable', id: 'cost' },
        right: { kind: 'literal', sort: 'int', value: '0' } }
    }))
  }
  for (const count of [1, 16, 64, 'late-limit']) {
    const rejected = count === 'late-limit'
    const request = {
      variableId: 'cost', operation: 'feasibility',
      samples: (rejected ? ['1', '1000'] : Array.from({ length: count }, (_, index) => String(index)))
        .map(value => ({ sort: 'int', value }))
    }
    const options = rejected ? { limits: { maxNumericDigits: constraints + 8 } } : {}
    let calls = 0
    const backend = { name: 'immediate-unknown', version: '1' }
    const adapter = { backend, capabilities: new Set(Adapter.capabilities), solve: async () => {
      calls++
      return { status: 'unknown', reason: { kind: 'indeterminate', message: 'benchmark fixture' },
        backend, diagnostics: [], elapsedMs: 0 }
    } }
    const samplesMs = []
    for (let iteration = 0; iteration < 6; iteration++) {
      calls = 0
      let result, error
      const start = performance.now()
      try { result = await Workflow.sensitivity(adapter, model, request, options) }
      catch (caught) { error = caught }
      const elapsed = performance.now() - start
      if (rejected) {
        assert.ok(error instanceof Error)
        assert.match(error.message, /maxNumericDigits/)
        assert.equal(calls, 0)
      } else {
        assert.equal(error, undefined)
        assert.equal(calls, count)
        assert.equal(result.points.length, count)
        assert.ok(result.points.every(point => point.report.explanation.outcome.status === 'unknown'))
      }
      if (iteration > 0) samplesMs.push(elapsed)
    }
    measurements.push({ constraints, samples: request.samples.length,
      outcome: rejected ? 'model-limit-before-backend' : 'unknown', backendCalls: calls,
      medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
  }
}
console.log(JSON.stringify({ format: 'cave.sensitivity-batch-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  method: 'One warmup and five timed complete workflow calls per case; fixture construction and assertions excluded. Immediate unknown adapter: no solver search. Timings include preflight, per-run validation and report construction.',
  measurements }, null, 2))
