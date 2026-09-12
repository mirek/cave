import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = 256
  const constraints = Number(process.argv[3])
  const maxExplanationBits = Number(process.argv[4])
  assert.ok([1, 32, 384].includes(constraints))
  assert.ok([1024, Adapter.defaultLimits.maxExplanationBits].includes(maxExplanationBits))
  const variables = Array.from({ length: count }, (_, index) => ({ id: `x${index}`, sort: 'real' }))
  const model = { schema: Model.schema, variables, constraints: Array.from({ length: constraints }, (_, index) =>
    ({ id: `positive-${index}`, expression: { kind: 'gt', left: { kind: 'add',
      operands: variables.map(variable => ({ kind: 'variable', id: variable.id })) },
    right: { kind: 'literal', sort: 'real', value: '0' } } })
  ) }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, constraints * (count + 3))
  if (constraints === 384) {
    assert.throws(() => Validate.model({ ...model, constraints: [...model.constraints,
      ...Array.from({ length: 3 }, (_, index) => ({ ...model.constraints[0], id: `extra-${index}` }))] }), /maxExpressionNodes/)
  }
  const limits = { ...Adapter.defaultLimits, maxExplanationBits }
  const outcome = { status: 'satisfied', assignment: Object.fromEntries(variables.map((variable, index) =>
    [variable.id, { sort: 'real', numerator: '1', denominator: String(10n ** 100n + BigInt(2 * index + 1)) }])),
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const report = Explain.report(model, outcome, limits)
    samplesMs.push(performance.now() - start)
    // Every assigned fraction is strictly positive, independently of reduction order.
    assert.equal(report.outcome.hardConstraints.length, constraints)
    for (const constraint of report.outcome.hardConstraints) {
      assert.equal(constraint.evaluation, maxExplanationBits === 1024 ? 'indeterminate' : 'satisfied')
      if (maxExplanationBits === 1024) assert.match(constraint.evaluationReason, /maxExplanationBits/)
    }
  }
  console.log(JSON.stringify({ terms: count, constraints, maxExplanationBits, stats,
    assignmentDenominatorDigits: 101, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1] }))
} else {
  const results = []
  for (const constraints of [1, 32, 384]) for (const budget of [1024, Adapter.defaultLimits.maxExplanationBits]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(constraints), String(budget)],
      { encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-cumulative-sum-bench.mjs', 'packages/solver/src/explain.ts',
    'packages/solver/src/adapter.ts', 'packages/solver/src/explanation-budget.ts',
    'packages/solver/src/validate.ts', 'packages/solver/src/balanced-reduce.ts',
    'packages/solver/src/exact.ts', 'packages/solver/src/integer-gcd.ts',
    'packages/solver/src/canonical-owned.ts', 'packages/solver/src/clone.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per constraint count and budget; four public calls, first discarded; construction and assertions outside timer',
    childAllowance: { timeoutMs: 180000, maxOldSpaceMb: 256 }, limits: Adapter.defaultLimits,
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
