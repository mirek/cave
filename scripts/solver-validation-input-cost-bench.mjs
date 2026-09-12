import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const kind = process.argv[3], size = Number(process.argv[4])
  assert.ok(['invalid-integer', 'unknown-reference', 'provenance'].includes(kind))
  assert.ok([1000, 100000, 1000000].includes(size))
  const text = kind === 'invalid-integer' ? '9'.repeat(size - 1) + 'x' : kind === 'unknown-reference' ? 'x'.repeat(size) : ''
  const ids = kind === 'provenance' ? Array.from({ length: size }, (_, index) => `row-${index}`) : undefined
  const base = { schema: Model.schema, variables: [], constraints: [] }
  const model = kind === 'invalid-integer' ? { ...base, variables: [{ id: 'x', sort: 'int', min: text, max: 1 }] }
    : kind === 'unknown-reference' ? { ...base, constraints: [{ id: 'check', expression: { kind: 'variable', id: text } }] }
      : { ...base, variables: [{ id: 'x', sort: 'bool', evidenceRowIds: ids }] }
  const samplesMs = []
  let expected, outputHash
  for (let sample = 0; sample < 4; sample++) {
    let output, failure
    const start = performance.now()
    try { output = Validate.model(model) } catch (error) { failure = error }
    samplesMs.push(performance.now() - start)
    if (kind === 'provenance') {
      assert.equal(failure, undefined)
      assert.deepEqual(output, { variables: 1, constraints: 0, objectives: 0, enumValues: 0, expressionNodes: 0, expressionDepth: 0 })
      assert.equal(ids.length, size)
      assert.equal(ids[0], 'row-0')
      assert.equal(ids.at(-1), `row-${size - 1}`)
      assert.ok(ids.every((value, index) => value === `row-${index}`))
    } else {
      assert.ok(failure instanceof Validate.ModelValidationError)
      assert.equal(failure.problems.length, 1)
      assert.ok(failure.message.length < 1200)
      output = { error: failure.name, message: failure.message }
    }
    expected ??= output
    assert.deepEqual(output, expected)
    outputHash = createHash('sha256').update(JSON.stringify(output)).digest('hex')
  }
  console.log(JSON.stringify({ kind, size, samplesMs, medianMs: samplesMs.slice(1).sort((a,b)=>a-b)[1], outputHash,
    messageLength: expected.message?.length, processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const kind of ['invalid-integer', 'unknown-reference', 'provenance']) for (const size of [1000,100000,1000000]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', kind, String(size)],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-validation-input-cost-bench.mjs', 'pnpm-lock.yaml',
    ...readdirSync('packages/solver/src').filter(name=>name.endsWith('.ts')).sort().map(name=>`packages/solver/src/${name}`)]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'fresh sequential children; four direct validations, first discarded; fixture, assertions and hashing outside timing',
    memory: 'lifetime peak RSS includes fixture and four calls; old-space allowance is not a process RSS cap',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
