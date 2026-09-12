import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'
import { expressionKey } from '../packages/solver/src/expression-key.ts'

if (process.argv[2] === '--case') {
  const padding = Number(process.argv[3])
  assert.ok([1, 1024, 65536].includes(padding))
  const expression = { kind: 'eq', left: { kind: 'literal', sort: 'real', value: `1e${'0'.repeat(padding)}` },
    right: { kind: 'literal', sort: 'real', value: '1' } }
  const model = { schema: Model.schema, variables: [], constraints: [{ id: 'same', expression }] }
  const limits = { ...Adapter.defaultLimits, maxNumericDigits: 4 }
  const stats = Validate.model(model, limits)
  assert.equal(stats.expressionNodes, 3)
  assert.throws(() => Validate.model(model, { ...limits, maxNumericDigits: 3 }), /maxNumericDigits/)
  const keyCodeUnits = expressionKey(expression, new Map()).length
  const result = { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  let outputHash
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const report = Explain.report(model, result, limits)
    samplesMs.push(performance.now() - start)
    assert.equal(report.outcome.status, 'satisfied')
    assert.equal(report.outcome.hardConstraints[0].evaluation, 'satisfied')
    const hash = createHash('sha256').update(JSON.stringify(report)).digest('hex')
    outputHash ??= hash
    assert.equal(hash, outputHash)
  }
  console.log(JSON.stringify({ padding, inputCodeUnits: expression.left.value.length, keyCodeUnits, stats, outputHash, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1], processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const padding of [1, 1024, 65536]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(padding)],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  assert.equal(new Set(results.map(result => result.outputHash)).size, 1)
  for (const result of results) assert.equal(result.keyCodeUnits - results[0].keyCodeUnits, result.padding - results[0].padding)
  const paths = ['scripts/solver-exponent-padding-bench.mjs', 'packages/solver/src/expression-key.ts',
    'packages/solver/src/numeric-size.ts', 'packages/solver/src/exact.ts', 'packages/solver/src/explain.ts',
    'packages/solver/src/validate.ts', 'packages/solver/src/clone.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per case; four complete reports, first discarded; construction and assertions outside timer',
    memory: 'process lifetime peak RSS includes fixture construction, key measurement, validation and all four reports',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
