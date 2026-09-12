import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { Canonical, Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('z3-solver/package.json'))
const dependencyVersion = (JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version

const files = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  }))).flat()
}

const paths = await files(packageRoot)
let installedBytes = 0
let gzipBytes = 0
for (const path of paths) {
  installedBytes += (await stat(path)).size
  gzipBytes += gzipSync(await readFile(path), { level: 9 }).byteLength
}

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const architecture: Model.t = {
  schema: Model.schema,
  enums: [{ id: 'architecture', values: ['monolith', 'microservices'] }],
  variables: [
    { id: 'choice', sort: 'enum', domain: 'architecture' },
    { id: 'team-size', sort: 'int', min: 12, max: 12 },
    { id: 'monthly-cost', sort: 'real', min: '0', max: '1000' }
  ],
  constraints: [{
    id: 'architecture-cost',
    expression: {
      kind: 'eq',
      left: ref('monthly-cost'),
      right: {
        kind: 'if',
        condition: {
          kind: 'eq',
          left: ref('choice'),
          right: { kind: 'literal', sort: 'enum', domain: 'architecture', value: 'monolith' }
        },
        then: { kind: 'literal', sort: 'real', value: '80.25' },
        else: { kind: 'literal', sort: 'real', value: '120.50' }
      }
    }
  }],
  objectives: [{ id: 'min-monthly-cost', direction: 'minimize', expression: ref('monthly-cost') }]
}

const verify = (result: Awaited<ReturnType<typeof Solve.run>>, phase: string): void => {
  if (result.status !== 'optimal') throw new Error(`${phase} fixture returned ${result.status}`)
  assert.equal(result.optimalityProved, true, `${phase}: optimality must be proved`)
  const cost = { sort: 'real', numerator: '321', denominator: '4' }
  assert.deepEqual(result.assignment, {
    choice: { sort: 'enum', domain: 'architecture', value: 'monolith' },
    'team-size': { sort: 'int', value: '12' },
    'monthly-cost': cost
  }, `${phase}: incorrect benchmark assignment`)
  assert.equal(result.objectives.length, 1, `${phase}: expected one objective`)
  assert.equal(result.objectives[0]?.objectiveId, 'min-monthly-cost')
  assert.deepEqual(result.objectives[0]?.value, cost, `${phase}: incorrect exact optimum`)
}

const beforeRssBytes = process.memoryUsage().rss
const runtime = await create()
let firstCheckMs: number
const warmRuns = 25
const warm: number[] = []
try {
  const firstStarted = performance.now()
  const first = await Solve.run(runtime, architecture)
  firstCheckMs = performance.now() - firstStarted
  verify(first, 'benchmark')

  for (let index = 0; index < warmRuns; index += 1) {
    const started = performance.now()
    const result = await Solve.run(runtime, architecture)
    const elapsed = performance.now() - started
    verify(result, 'warm')
    warm.push(elapsed)
  }
} finally {
  await runtime.close()
}

warm.sort((left, right) => left - right)
const mean = warm.reduce((sum, value) => sum + value, 0) / warm.length

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  backend: runtime.backend,
  dependency: { name: 'z3-solver', version: dependencyVersion },
  fixture: { modelDigest: Canonical.digest(architecture), verifiedChecks: warm.length + 1 },
  artifacts: {
    files: paths.length,
    installedBytes,
    gzipBytes,
    wasmBytes: (await stat(join(packageRoot, 'build/z3-built.wasm'))).size
  },
  latencyMs: {
    coldInitialization: runtime.initializationMs,
    firstCheck: Number(firstCheckMs.toFixed(2)),
    warmMean: Number(mean.toFixed(2)),
    warmP50: Number(warm[Math.floor(warm.length * 0.5)]!.toFixed(2)),
    warmP95: Number(warm[Math.floor(warm.length * 0.95)]!.toFixed(2)),
    warmRuns
  },
  memoryBytes: {
    rssBeforeInitialization: beforeRssBytes,
    rssAfterRuns: process.memoryUsage().rss,
    peakRss: process.resourceUsage().maxRSS * 1024
  }
}, null, 2))
