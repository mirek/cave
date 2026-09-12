import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { ExplanationBudget } from '../packages/solver/src/explanation-budget.ts'

const cases = [
  ...[128, 1024, 4096].map(count => ['scripts/solver-flat-product-bench.mjs', '--case', String(count)]),
  ...['product', 'negate', 'divide', 'add'].map(operation => ['scripts/solver-shared-product-bench.mjs', '--case', '12', operation]),
  ['scripts/solver-numeric-budget-bench.mjs', '--case', 'explain', '990'],
  ['scripts/explanation-intermediate-bench.mjs'],
  ['scripts/solver-cumulative-sum-bench.mjs', '--case', '384', '1000000']
]

if (process.argv[2] === '--case') {
  const index = Number(process.argv[3]), maximum = Number(process.argv[4])
  assert.ok(Number.isInteger(index) && cases[index] !== undefined)
  assert.ok([10_000_000, Number.MAX_SAFE_INTEGER].includes(maximum))
  const records = [], budgets = new WeakMap()
  const original = ExplanationBudget.prototype.check, log = console.log
  ExplanationBudget.prototype.check = function (...bounds) {
    original.apply(this, bounds)
    let record = budgets.get(this)
    if (record === undefined) { record = { used: 0, checks: 0, rejected: 0 }; budgets.set(this, record); records.push(record) }
    record.checks++
    const cost = Math.max(0, ...bounds)
    if (cost > maximum - record.used) {
      record.rejected++
      throw new RangeError('diagnostic cumulative explanation work exhausted')
    }
    record.used += cost
  }
  // Existing fixture assertions run unchanged. Their instrumented timings are
  // deliberately omitted: this probe calibrates accounting, not performance.
  console.log = () => {}
  const command = cases[index]
  try {
    process.argv = [process.execPath, ...command]
    await import(pathToFileURL(resolve(command[0])).href)
    assert.ok(records.every(record => record.used <= maximum))
    log(JSON.stringify({ command, maximum, guardedReports: records.length,
      maxUsed: Math.max(0, ...records.map(record => record.used)),
      rejected: records.reduce((total, record) => total + record.rejected, 0), records }))
  } finally { ExplanationBudget.prototype.check = original; console.log = log }
} else {
  const results = []
  for (let index = 0; index < cases.length; index++) for (const maximum of [Number.MAX_SAFE_INTEGER, 10_000_000]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(index), String(maximum)],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, `${JSON.stringify(cases[index])}, allowance ${maximum}: ${child.stderr}`)
    results.push(JSON.parse(child.stdout))
  }
  const paths = [...new Set(['scripts/explanation-work-calibration.mjs', ...cases.map(value => value[0]),
    ...readdirSync('packages/solver/src').filter(name => name.endsWith('.ts')).map(name => `packages/solver/src/${name}`)])]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    scope: 'Existing workload assertions under temporary per-report arithmetic accounting; no public API or defaults changed; sequential isolated children',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
