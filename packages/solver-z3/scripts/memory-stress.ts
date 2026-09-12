import * as assert from 'node:assert/strict'
import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const gc = (globalThis as { gc?: () => void }).gc
assert.ok(gc, 'run this diagnostic with node --expose-gc')
assert.ok(process.argv.slice(2).every(argument => argument === '--large') && process.argv.length <= 3,
  'usage: memory-stress.ts [--large]')
const large = process.argv.includes('--large')
const iterations = large ? 3 : 10
const runtime = await create()
const count = 3_000
const model: Model.t = {
  schema: Model.schema,
  variables: Array.from({ length: count }, (_, index) => ({ id: `x${index}`, sort: 'int', min: 0, max: 1 })),
  constraints: [],
  objectives: [{
    id: 'total', direction: 'maximize',
    expression: { kind: 'add', operands: Array.from({ length: count }, (_, index) => ({ kind: 'variable', id: `x${index}` })) }
  }]
}
const small: Model.t = { schema: Model.schema, variables: [{ id: 'ok', sort: 'bool' }], constraints: [] }
const timer = setInterval(gc, 1)
try {
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, backend: runtime.backend, iterations, variables: count, largeVariables: large ? 75_000 : 0 }))
  for (let iteration = 0; iteration < iterations; iteration++) {
    const limited = await Solve.run(runtime, small, { limits: { maxMemoryBytes: 1024 * 1024 } })
    console.log(JSON.stringify({ iteration, phase: 'limited', result: limited }))
    assert.equal(limited.status, 'unknown')
    if (limited.status === 'unknown') {
      assert.equal(limited.reason.kind, 'resource-limit')
      assert.equal(limited.reason.limit, 'maxMemoryBytes')
    }
    const largeResults = []
    if (large) {
      const largeCount = 75_000
      const variables: Model.Variable[] = Array.from({ length: largeCount }, (_, index) => ({ id: `v${index}`, sort: 'int', min: 0, max: 1 }))
      for (const optimize of [false, true]) {
        console.log(JSON.stringify({ iteration, phase: optimize ? 'large-optimization-start' : 'large-feasibility-start' }))
        const started = performance.now()
        const result = await Solve.run(runtime, {
          schema: Model.schema,
          variables,
          constraints: [{ id: 'outside-last-domain', expression: { kind: 'lt', left: { kind: 'variable', id: `v${largeCount - 1}` }, right: { kind: 'literal', sort: 'int', value: '0' } } }],
          ...(optimize ? { objectives: [{ id: 'constant', direction: 'minimize' as const, expression: { kind: 'literal' as const, sort: 'int' as const, value: '0' } }] } : {})
        }, { limits: {
          maxVariables: largeCount,
          // Two one-digit bounds per variable, plus the constraint and optional objective literals.
          maxNumericDigits: 2 * largeCount + 2,
          timeoutMs: 30_000
        } })
        console.log(JSON.stringify({ iteration, phase: optimize ? 'large-optimization' : 'large-feasibility', result, wallMs: performance.now() - started, memory: process.memoryUsage() }))
        // Probe subsequent requests before asserting so a poisoned runtime is visible.
        largeResults.push(result)
      }
    }
    console.log(JSON.stringify({ iteration, phase: 'recovery-start' }))
    const result = await Solve.run(runtime, model, { limits: { maxVariables: count } })
    console.log(JSON.stringify({ iteration, phase: 'recovered', status: result.status, elapsedMs: result.elapsedMs, ...(result.status === 'unknown' ? { reason: result.reason } : {}), ...(result.status === 'optimal' ? { objectives: result.objectives } : {}) }))
    assert.equal(result.status, 'optimal', JSON.stringify(result))
    if (result.status === 'optimal') {
      assert.deepEqual(result.objectives, [{ objectiveId: 'total', value: { sort: 'int', value: String(count) } }])
      assert.equal(Object.keys(result.assignment).length, count)
      for (const value of Object.values(result.assignment)) assert.deepEqual(value, { sort: 'int', value: '1' })
    }
    for (const result of largeResults) assert.equal(result.status, 'unsatisfied', JSON.stringify(result))
  }
} finally {
  clearInterval(timer)
  await runtime.close()
}
