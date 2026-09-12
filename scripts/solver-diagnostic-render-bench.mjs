import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Adapter, Explain, Model } from '../packages/solver/src/index.ts'

const sizes = [1024, 65536, 1048576]
const families = ['plain', 'control']
const sha256 = text => createHash('sha256').update(text).digest('hex')
if (process.argv[2] === '--case') {
  const size = Number(process.argv[3])
  const family = process.argv[4]
  assert.ok(sizes.includes(size) && families.includes(family))
  const message = (family === 'plain' ? 'a' : '\u0085').repeat(size)
  const report = Explain.report({ schema: Model.schema, variables: [], constraints: [] }, {
    status: 'unknown', reason: { kind: 'backend-error', message },
    backend: { name: 'fixture', version: '1' }, elapsedMs: 0, diagnostics: []
  }, Adapter.defaultLimits)
  const before = sha256(JSON.stringify(report))
  // Independent, explicit expected escaping for this single-character corpus.
  const expectedMessage = family === 'plain' ? message : '"' + '\\u0085'.repeat(size) + '"'
  const expected = `Solver result: unknown\nModel: ${report.run.modelDigest}\nBackend: fixture 1\nElapsed: 0 ms\nUnknown: backend-error — ${expectedMessage}\n`
  const samplesMs = []
  let output
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    output = Explain.render(report)
    samplesMs.push(performance.now() - start)
    assert.equal(output, expected)
    assert.equal(sha256(JSON.stringify(report)), before)
  }
  console.log(JSON.stringify({ family, inputCodeUnits: size, renderedMessageCodeUnits: expectedMessage.length,
    outputCodeUnits: output.length, outputSha256: sha256(output), samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1], processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const family of families) for (const size of sizes) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(size), family],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-diagnostic-render-bench.mjs',
    ...readdirSync('packages/solver/src').filter(name => name.endsWith('.ts')).sort().map(name => `packages/solver/src/${name}`)]
  console.log(JSON.stringify({ format: 'cave.solver-diagnostic-render', version: 1,
    node: process.version, platform: process.platform, arch: process.arch,
    timing: 'sequential fresh child per case; four render calls, first discarded; construction and exact-output/nonmutation assertions outside timing',
    memory: 'process lifetime peak RSS includes fixture/report/expected-output construction, checks and four renders; not isolated renderer allocation',
    scope: 'single unknown-reason string, plain ASCII or U+0085; no general report-size or elapsed-time guarantee',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, sha256(readFileSync(path))])), results }, null, 2))
}
