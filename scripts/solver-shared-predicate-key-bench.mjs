import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = Number(process.argv[3]), shared = process.argv[4] === 'shared'
  assert.ok([1, 32, 128].includes(count))
  const expression = { kind: 'and', operands: Array.from({ length: 255 }, () => ({ kind: 'variable', id: 'ready' })) }
  const model = { schema: Model.schema, variables: [{ id: 'ready', sort: 'bool' }],
    constraints: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, expression: shared ? expression : structuredClone(expression) })) }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, 256 * count)
  const result = { status: 'satisfied', assignment: { ready: { sort: 'bool', value: true } },
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  let outputHash
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const report = Explain.report(model, result, Adapter.defaultLimits)
    samplesMs.push(performance.now() - start)
    assert.equal(report.outcome.status, 'satisfied')
    assert.deepEqual(report.outcome.hardConstraints.map(value => value.evaluation), Array(count).fill('satisfied'))
    const hash = createHash('sha256').update(JSON.stringify(report)).digest('hex')
    outputHash ??= hash
    assert.equal(hash, outputHash)
  }
  console.log(JSON.stringify({ count, shared, stats, outputHash, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1], processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const count of [1, 32, 128]) for (const mode of ['shared', 'distinct']) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(count), mode],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  for (let index = 0; index < results.length; index += 2) assert.equal(results[index].outputHash, results[index + 1].outputHash)
  const paths = ['scripts/solver-shared-predicate-key-bench.mjs', 'packages/solver/src/explain.ts',
    'packages/solver/src/expression-key.ts', 'packages/solver/src/clone.ts', 'packages/solver/src/validate.ts']
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per case; four complete reports, first discarded; construction and assertions outside timer',
    memory: 'process lifetime peak RSS includes construction and all four reports; not isolated cache allocation',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
