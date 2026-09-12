import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'
import { expressionKey } from '../packages/solver/src/expression-key.ts'

if (process.argv[2] === '--case') {
  const identifierLength = Number(process.argv[3])
  assert.ok([16, 1024, 8192].includes(identifierLength))
  const id = 'x'.repeat(identifierLength)
  const expression = { kind: 'and', operands: Array.from({ length: 4096 }, () => ({ kind: 'variable', id })) }
  const model = { schema: Model.schema, variables: [{ id, sort: 'bool' }],
    constraints: [{ id: 'first', expression }, { id: 'duplicate', expression }] }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, 8194)
  const keyUnits = expressionKey(expression, new Map()).length
  const outcome = { status: 'satisfied', assignment: { [id]: { sort: 'bool', value: true } },
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const limits = { ...Adapter.defaultLimits, maxExplanationWork: 1 }
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const report = Explain.report(model, outcome, limits)
    samplesMs.push(performance.now() - start)
    assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), ['satisfied', 'satisfied'])
    assert.equal(report.run.limits.maxExplanationWork, 1)
  }
  console.log(JSON.stringify({ identifierLength, stats, keyCodeUnits: keyUnits, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1],
    processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const length of [16, 1024, 8192]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(length)],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-identifier-size-bench.mjs', 'packages/solver/src/explain.ts',
    'packages/solver/src/expression-key.ts', 'packages/solver/src/validate.ts',
    'packages/solver/src/canonical.ts', 'packages/solver/src/canonical-owned.ts', 'packages/solver/src/clone.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per identifier size; four complete reports, first discarded; construction and assertions outside timer',
    memory: 'process lifetime peak RSS includes construction, explicit syntax-key sizing and all four reports; not isolated report allocation',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
