import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Model, Validate } from '../packages/solver/src/index.ts'

if (process.argv[2] === '--case') {
  const count = Number(process.argv[3]), comparisons = Number(process.argv[4])
  assert.ok([100, 1000, 10000].includes(count))
  assert.ok([10, 10000].includes(comparisons))
  const values = Array.from({ length: count }, (_, index) => `choice-${String(index).padStart(5, '0')}`)
  const literal = { kind: 'literal', sort: 'enum', domain: 'Choice', value: values.at(-1) }
  const expression = { kind: 'and', operands: Array.from({ length: comparisons }, () => ({ kind: 'eq', left: literal, right: literal })) }
  const model = { schema: Model.schema, enums: [{ id: 'Choice', values }], variables: [], constraints: [{ id: 'check', expression }] }
  const limits = { maxEnumValues: count }
  const expected = { variables: 0, constraints: 1, objectives: 0, enumValues: count, expressionNodes: 1 + comparisons * 3, expressionDepth: 3 }
  const samplesMs = []
  for (let sample = 0; sample < 4; sample++) {
    const start = performance.now()
    const output = Validate.model(model, limits)
    samplesMs.push(performance.now() - start)
    assert.deepEqual(output, expected)
  }
  console.log(JSON.stringify({ count, comparisons, literalOccurrences: comparisons * 2, samplesMs,
    medianMs: samplesMs.slice(1).sort((a, b) => a - b)[1],
    outputHash: createHash('sha256').update(JSON.stringify(expected)).digest('hex'), processMaxRssKiB: process.resourceUsage().maxRSS }))
} else {
  const results = []
  for (const count of [100, 1000, 10000]) for (const comparisons of [10, 10000]) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--case', String(count), String(comparisons)],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    results.push(JSON.parse(child.stdout))
  }
  const paths = ['scripts/solver-enum-validation-bench.mjs', 'pnpm-lock.yaml',
    ...readdirSync('packages/solver/src').filter(name => name.endsWith('.ts')).sort().map(name => `packages/solver/src/${name}`)]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    timing: 'fresh sequential children; four validations, first discarded; fixture and assertions outside timing',
    memory: 'lifetime peak RSS includes fixture, four calls and assertions; not isolated allocation',
    childAllowance: { timeoutMs: 60000, maxOldSpaceMb: 256 },
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), results }, null, 2))
}
