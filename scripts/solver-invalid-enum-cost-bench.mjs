import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = Number(process.argv[3])
  assert.ok([1000,10000,100000].includes(count))
  const enums = Array.from({ length: count }, (_, index) => ({ id: `E${index}`, values: [] }))
  const model = { schema: Model.schema, variables: [], constraints: [], enums }
  const samplesMs = []
  let outputHash, messageLength
  for (let sample = 0; sample < 4; sample++) {
    let failure
    const start = performance.now()
    try { Validate.model(model) } catch (error) { failure = error }
    samplesMs.push(performance.now() - start)
    assert.ok(failure instanceof Validate.ModelValidationError)
    assert.equal(failure.problems.length, count)
    for (let index = 0; index < count; index++) {
      assert.equal(failure.problems[index], `enums[${index}] must contain at least one value`)
      assert.equal(enums[index].id, `E${index}`)
      assert.equal(enums[index].values.length, 0)
    }
    const hash = createHash('sha256').update(failure.message).digest('hex')
    outputHash ??= hash
    assert.equal(hash, outputHash)
    messageLength = failure.message.length
  }
  console.log(JSON.stringify({ count, samplesMs, medianMs: samplesMs.slice(1).sort((a,b)=>a-b)[1],
    problems: count, messageLength, outputHash, processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const count of [1000,10000,100000]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(count)],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-invalid-enum-cost-bench.mjs', 'pnpm-lock.yaml',
    ...readdirSync('packages/solver/src').filter(name=>name.endsWith('.ts')).sort().map(name=>`packages/solver/src/${name}`)]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'fresh sequential children; four direct validations, first discarded; fixtures, assertions and hashing outside timing',
    memory: 'lifetime peak RSS includes fixture, repeated errors and assertions; not isolated allocation or a process cap',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
