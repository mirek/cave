import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'
import { ExplanationBudget } from '../packages/solver/src/explanation-budget.ts'

// Experimental accounting only. This does not add a library limit or alter
// report-limit metadata. Every isolated child restores the prototype on exit.
if (process.argv[2] === '--case' || process.argv[2] === '--native-case') {
  const native = process.argv[2] === '--native-case'
  const maximum = Number(process.argv[3])
  assert.ok([1_000_000, 10_000_000, Number.MAX_SAFE_INTEGER].includes(maximum))
  const variables = Array.from({ length: 256 }, (_, i) => ({ id: `x${i}`, sort: 'real' }))
  const model = { schema: Model.schema, variables,
    constraints: Array.from({ length: 384 }, (_, i) => ({ id: `positive-${i}`,
      expression: { kind: 'gt', left: { kind: 'add', operands: variables.map(({ id }) => ({ kind: 'variable', id })) },
        right: { kind: 'literal', sort: 'real', value: String(-i) } } })) }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, 99_456)
  const outcome = { status: 'satisfied', assignment: Object.fromEntries(variables.map(({ id }, i) =>
    [id, { sort: 'real', numerator: '1', denominator: String(10n ** 100n + BigInt(2 * i + 1)) }])),
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  let used = 0, checks = 0, rejected = 0
  const original = ExplanationBudget.prototype.check
  if (!native) ExplanationBudget.prototype.check = function (...bounds) {
    original.apply(this, bounds)
    checks++
    const cost = Math.max(0, ...bounds)
    if (cost > maximum - used) {
      rejected++
      throw new RangeError('diagnostic cumulative explanation work exhausted')
    }
    used += cost
  }
  try {
    const start = performance.now()
    const report = Explain.report(model, outcome, { ...Adapter.defaultLimits, maxExplanationWork: native ? maximum : Number.MAX_SAFE_INTEGER })
    const elapsedMs = performance.now() - start
    assert.equal(report.outcome.status, 'satisfied')
    const evaluations = report.outcome.hardConstraints
    assert.equal(evaluations.length, 384)
    assert.ok(evaluations.every(row => row.evaluation === 'satisfied' ||
      (row.evaluation === 'indeterminate' && (native ? /maxExplanationWork/.test(row.evaluationReason) : row.evaluationReason === 'diagnostic cumulative explanation work exhausted'))))
    // Positive fractions exceed every nonpositive threshold, independently of reduction order.
    const satisfied = evaluations.filter(row => row.evaluation === 'satisfied').length
    assert.equal(maximum === Number.MAX_SAFE_INTEGER ? satisfied === 384 : satisfied > 0 && satisfied < 384, true)
    assert.ok(used <= maximum)
    console.log(JSON.stringify({ maximum, native, ...(native ? {} : { used, checks, rejected }), satisfied,
      indeterminate: 384 - satisfied, elapsedMs, stats }))
  } finally { ExplanationBudget.prototype.check = original }
} else {
  const results = []
  for (const maximum of [Number.MAX_SAFE_INTEGER, 1_000_000, 10_000_000]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(maximum)],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/explanation-work-policy-probe.mjs', ...readdirSync('packages/solver/src')
    .filter(name => name.endsWith('.ts')).map(name => `packages/solver/src/${name}`)]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    accounting: 'sum of maximum estimated bit bounds at each successful size check; rejected charges do not consume the remaining allowance',
    timing: 'one full report per fresh child; diagnostic instrumentation included; construction and assertions excluded; no warmup or statistical timing claim',
    childAllowance: { timeoutMs: 120000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
