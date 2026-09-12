import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { clone } from '../packages/solver/src/clone.ts'
import { Adapter, Explain, Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = Number(process.argv[3]), mode = process.argv[4], topology = process.argv[5] ?? 'shared'
  assert.ok([1000, 25000, 99999].includes(count))
  assert.ok(['clone', 'report'].includes(mode))
  assert.ok(['shared', 'distinct'].includes(topology))
  const leaf = { kind: 'variable', id: 'ready' }
  const model = { schema: Model.schema, variables: [{ id: 'ready', sort: 'bool' }],
    constraints: [{ id: 'all', expression: { kind: 'and', operands: topology === 'shared' ? Array(count).fill(leaf) : Array.from({ length: count }, () => ({ ...leaf })) } }] }
  const stats = Validate.model(model)
  assert.equal(stats.expressionNodes, count + 1)
  const expected = mode === 'clone' ? structuredClone(model) : undefined
  const result = { status: 'satisfied', assignment: { ready: { sort: 'bool', value: true } },
    backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
  const samplesMs = []
  let outputHash
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const output = mode === 'clone' ? clone(model) : Explain.report(model, result, Adapter.defaultLimits)
    samplesMs.push(performance.now() - start)
    if (mode === 'clone') {
      assert.deepEqual(output, expected)
      assert.equal(output.constraints[0].expression.operands[0] === output.constraints[0].expression.operands[count - 1], topology === 'shared')
      assert.notEqual(output.constraints[0].expression.operands[0], model.constraints[0].expression.operands[0])
    } else {
      assert.equal(output.outcome.status, 'satisfied')
      assert.equal(output.outcome.hardConstraints[0].evaluation, 'satisfied')
    }
    const hash = createHash('sha256').update(JSON.stringify(output)).digest('hex')
    outputHash ??= hash
    assert.equal(hash, outputHash)
  }
  console.log(JSON.stringify({ count, mode, topology, stats, outputHash, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1], processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const count of [1000, 25000, 99999]) for (const mode of ['clone', 'report']) for (const topology of ['shared', 'distinct']) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(count), mode, topology],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  for (let index = 0; index < results.length; index += 2) assert.equal(results[index].outputHash, results[index + 1].outputHash)
  const paths = ['scripts/solver-wide-capture-bench.mjs', 'pnpm-lock.yaml',
    ...readdirSync('packages/solver/src').filter(name => name.endsWith('.ts')).sort().map(name => `packages/solver/src/${name}`)]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per size/mode/topology; four calls, first discarded; construction, native reference and assertions outside timer',
    memory: 'lifetime peak RSS includes fixture, native reference when applicable, assertions and four calls; not isolated copy allocation',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
