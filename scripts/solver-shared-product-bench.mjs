import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const depth = Number(process.argv[3])
  const operation = process.argv[4] ?? 'product'
  assert.ok(['product', 'negate', 'divide', 'add'].includes(operation))
  assert.ok([8, 10, 12].includes(depth))
  let expression = { kind: 'variable', id: 'x' }
  for (let level = 0; level < depth; level++) expression = { kind: 'multiply', operands: [expression, expression] }
  if (operation === 'negate') expression = { kind: 'negate', value: expression }
  if (operation === 'divide') expression = { kind: 'divide', left: expression, right: { kind: 'literal', sort: 'real', value: '-1' } }
  if (operation === 'add') expression = { kind: 'add', operands: [expression, { kind: 'literal', sort: 'real', value: '1' }] }
  const extraNodes = operation === 'product' ? 0 : operation === 'negate' ? 1 : 2
  const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }], constraints: [
    { id: 'equal-one', expression: { kind: 'eq', left: expression, right: { kind: 'literal', sort: 'real', value: '1' } } }
  ] }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, 2 ** (depth + 1) + 1 + extraNodes)
  const outcome = { status: 'satisfied', assignment: { x: { sort: 'real', numerator: String(10n ** 50n + 1n), denominator: String(10n ** 50n) } },
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const result = Explain.report(model, outcome, Adapter.defaultLimits)
    samplesMs.push(performance.now() - start)
    // x > 1 implies x^(2^depth) > 1, and its negation is below zero; neither equals one.
    assert.equal(result.outcome.hardConstraints[0].evaluation, 'violated')
  }
  console.log(JSON.stringify({ operation, depth, distinctExpressionNodes: depth + 3 + extraNodes, stats,
    assignmentDecimalDigits: 51, normalizedDenominatorDigits: 50 * 2 ** depth + 1,
    samplesMs, medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1] }))
} else {
  const operation = process.argv[2] ?? 'product'
  assert.ok(['product', 'negate', 'divide', 'add'].includes(operation))
  const results = []
  for (const depth of [8, 10, 12]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(depth), operation],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-shared-product-bench.mjs', 'packages/solver/src/explain.ts', 'packages/solver/src/validate.ts', 'packages/solver/src/exact.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per depth; four public calls, first discarded; fixture construction and assertions outside timer',
    childAllowance: { timeoutMs: 30000, maxOldSpaceMb: 256 }, limits: Adapter.defaultLimits,
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
