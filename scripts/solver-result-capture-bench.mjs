import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { captureResult } from '../packages/solver/src/result.ts'
import { Adapter, Explain, Model } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = Number(process.argv[3]), mode = process.argv[4], topology = process.argv[5]
  assert.ok([1000, 25000, 100000].includes(count))
  assert.ok(['capture', 'report'].includes(mode))
  assert.ok(['shared', 'distinct'].includes(topology))
  const entry = { level: 'info', code: 'fixture', message: 'backend diagnostic' }
  const result = { status: 'satisfied', assignment: {}, backend: { name: 'fixture', version: '1' }, elapsedMs: 0,
    diagnostics: topology === 'shared' ? Array(count).fill(entry) : Array.from({ length: count }, () => ({ ...entry })) }
  const model = { schema: Model.schema, variables: [], constraints: [] }
  const expected = structuredClone(result), samplesMs = []
  let outputHash
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const output = mode === 'capture' ? captureResult(result) : Explain.report(model, result, Adapter.defaultLimits)
    samplesMs.push(performance.now() - start)
    const metadata = mode === 'capture' ? output : output.run
    assert.deepEqual(metadata.diagnostics, expected.diagnostics)
    assert.notEqual(metadata.diagnostics, result.diagnostics)
    assert.notEqual(metadata.diagnostics[0], result.diagnostics[0])
    assert.equal(metadata.diagnostics[0] === metadata.diagnostics[count - 1], topology === 'shared')
    if (mode === 'capture') assert.deepEqual(output, expected)
    else assert.equal(output.outcome.status, 'satisfied')
    const hash = createHash('sha256').update(JSON.stringify(output)).digest('hex')
    outputHash ??= hash
    assert.equal(hash, outputHash)
    assert.deepEqual(result, expected)
  }
  console.log(JSON.stringify({ count, mode, topology, samplesMs, outputHash,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1], processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const count of [1000, 25000, 100000]) for (const mode of ['capture', 'report']) for (const topology of ['shared', 'distinct']) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(count), mode, topology],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  for (let index = 0; index < results.length; index += 2) assert.equal(results[index].outputHash, results[index + 1].outputHash)
  const paths = ['scripts/solver-result-capture-bench.mjs', 'pnpm-lock.yaml',
    ...readdirSync('packages/solver/src').filter(name => name.endsWith('.ts')).sort().map(name => `packages/solver/src/${name}`)]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh children; four calls, first discarded; fixture, reference copy, hashing and assertions outside timing',
    memory: 'lifetime peak RSS includes fixtures, native reference, four calls and assertions; not isolated capture allocation',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
