import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = Number(process.argv[3])
  assert.ok([128, 1024, 4096].includes(count))
  const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [
    { id: 'greater-one', expression: { kind: 'gt', left: { kind: 'multiply',
      operands: Array.from({ length: count }, () => ({ kind: 'variable', id: 'x' })) },
    right: { kind: 'literal', sort: 'real', value: '1' } } }
  ] }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, count + 3)
  const outcome = { status: 'satisfied', assignment: { x: { sort: 'real',
    numerator: String(10n ** 50n + 1n), denominator: String(10n ** 50n) } },
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const report = Explain.report(model, outcome, Adapter.defaultLimits)
    samplesMs.push(performance.now() - start)
    // Every factor exceeds one, so the product does too, independently of evaluation order.
    assert.equal(report.outcome.hardConstraints[0].evaluation, 'satisfied')
  }
  console.log(JSON.stringify({ count, stats, assignmentDecimalDigits: 51,
    normalizedDenominatorDigits: 50 * count + 1, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1] }))
} else {
  const results = []
  for (const count of [128, 1024, 4096]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(count)],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-flat-product-bench.mjs', 'packages/solver/src/explain.ts',
    'packages/solver/src/balanced-reduce.ts', 'packages/solver/src/fraction-product.ts', 'packages/solver/src/integer-gcd.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per count; four public calls, first discarded; construction and assertions outside timer',
    childAllowance: { timeoutMs: 30000, maxOldSpaceMb: 256 }, limits: Adapter.defaultLimits,
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
