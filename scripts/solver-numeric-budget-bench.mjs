import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Linear, Model, Validate } from '../packages/solver/src/index.ts'

const fixture = (operation, count) => {
  const operands = Array.from({ length: count }, (_, index) => ({ kind: 'literal', sort: 'real',
    value: { numerator: '1', denominator: String(10n ** 99n + 3n + BigInt(index) * 2n) } }))
  const sum = { kind: 'add', operands }
  return operation === 'linear'
    ? { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [],
      objectives: [{ id: 'ratio', direction: 'minimize', expression: { kind: 'divide', left: { kind: 'variable', id: 'x' }, right: sum } }] }
    : { schema: Model.schema, variables: [], constraints: [{ id: 'positive', expression: {
      kind: 'gt', left: sum, right: { kind: 'literal', sort: 'real', value: '0' }
    } }] }
}
if (process.argv[2] === '--case') {
  const operation = process.argv[3]
  const count = Number(process.argv[4])
  assert.ok(['linear', 'explain'].includes(operation))
  assert.ok([128, 512, 990].includes(count))
  const model = fixture(operation, count)
  const chargedNumericDigits = count * 101 + (operation === 'explain' ? 2 : 0)
  const stats = Validate.model(model)
  const outcome = { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const tooSmall = { ...Adapter.defaultLimits, maxNumericDigits: chargedNumericDigits - 1 }
  assert.throws(() => operation === 'linear' ? Linear.model(model, tooSmall) : Explain.report(model, outcome, tooSmall),
    error => error instanceof Validate.ModelLimitError && error.limit === 'maxNumericDigits' && error.actual === chargedNumericDigits)
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const result = operation === 'linear' ? Linear.model(model) : Explain.report(model, outcome, Adapter.defaultLimits)
    samplesMs.push(performance.now() - start)
    if (operation === 'linear') assert.deepEqual(result, { linear: true, problems: [] })
    else assert.equal(result.outcome.hardConstraints[0].evaluation, 'satisfied')
  }
  console.log(JSON.stringify({ operation, count, denominatorDigits: 100, chargedNumericDigits, stats, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1] }))
} else {
  const results = []
  for (const operation of ['linear', 'explain']) {
    assert.throws(() => Validate.model(fixture(operation, 991)),
      error => error instanceof Validate.ModelLimitError && error.limit === 'maxNumericDigits')
    for (const count of [128, 512, 990]) {
      const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', operation, String(count)],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
      assert.equal(child.error, undefined)
      assert.equal(child.status, 0, child.stderr)
      results.push(JSON.parse(child.stdout))
    }
  }
  const paths = ['scripts/solver-numeric-budget-bench.mjs', 'packages/solver/src/linear.ts', 'packages/solver/src/explain.ts',
    'packages/solver/src/constant-sign.ts', 'packages/solver/src/evaluate-expression.ts', 'packages/solver/src/exact.ts', 'packages/solver/src/fraction-sum.ts', 'packages/solver/src/integer-gcd.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'fresh child per case; four calls, first discarded; construction and assertions outside timer',
    childAllowance: { timeoutMs: 30000, maxOldSpaceMb: 256 }, numericLimit: Adapter.defaultLimits.maxNumericDigits,
    overBudgetCount: 991, sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
