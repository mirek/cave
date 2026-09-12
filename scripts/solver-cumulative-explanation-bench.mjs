import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = 4096
  const constraints = Number(process.argv[3])
  const maxExplanationBits = Number(process.argv[4])
  assert.ok([1, 8, 24].includes(constraints))
  assert.ok([1024, Adapter.defaultLimits.maxExplanationBits].includes(maxExplanationBits))
  const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: Array.from({ length: constraints }, (_, index) =>
    ({ id: `greater-one-${index}`, expression: { kind: 'gt', left: { kind: 'multiply',
      operands: Array.from({ length: count }, () => ({ kind: 'variable', id: 'x' })) },
    right: { kind: 'literal', sort: 'real', value: '1' } } })
  ) }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, constraints * (count + 3))
  if (constraints === 24) {
    assert.throws(() => Validate.model({ ...model, constraints: [...model.constraints, { ...model.constraints[0], id: 'one-too-many' }] }), /maxExpressionNodes/)
  }
  const limits = { ...Adapter.defaultLimits, maxExplanationBits }
  const outcome = { status: 'satisfied', assignment: { x: { sort: 'real',
    numerator: String(10n ** 50n + 1n), denominator: String(10n ** 50n) } },
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const report = Explain.report(model, outcome, limits)
    samplesMs.push(performance.now() - start)
    // Every factor exceeds one, so the product does too, independently of evaluation order.
    assert.equal(report.outcome.hardConstraints.length, constraints)
    for (const constraint of report.outcome.hardConstraints) {
      assert.equal(constraint.evaluation, maxExplanationBits === 1024 ? 'indeterminate' : 'satisfied')
      if (maxExplanationBits === 1024) assert.match(constraint.evaluationReason, /maxExplanationBits/)
    }
  }
  console.log(JSON.stringify({ count, constraints, maxExplanationBits, stats, assignmentDecimalDigits: 51,
    normalizedDenominatorDigits: 50 * count + 1, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1] }))
} else {
  const results = []
  for (const constraints of [1, 8, 24]) for (const budget of [1024, Adapter.defaultLimits.maxExplanationBits]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(constraints), String(budget)],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-cumulative-explanation-bench.mjs', 'packages/solver/src/explain.ts',
    'packages/solver/src/adapter.ts', 'packages/solver/src/explanation-budget.ts', 'packages/solver/src/validate.ts', 'packages/solver/src/balanced-reduce.ts', 'packages/solver/src/fraction-product.ts', 'packages/solver/src/integer-gcd.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per constraint count and budget; four public calls, first discarded; construction and assertions outside timer',
    childAllowance: { timeoutMs: 30000, maxOldSpaceMb: 256 }, limits: Adapter.defaultLimits,
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
