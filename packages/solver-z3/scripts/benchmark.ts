import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('z3-solver/package.json'))

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

const beforeRssBytes = process.memoryUsage().rss
const runtime = await create()
const firstStarted = performance.now()
const first = await Solve.run(runtime, architecture)
const firstCheckMs = performance.now() - firstStarted
if (first.status !== 'optimal') throw new Error(`benchmark fixture returned ${first.status}`)

const warmRuns = 25
const warm: number[] = []
for (let index = 0; index < warmRuns; index += 1) {
  const started = performance.now()
  const result = await Solve.run(runtime, architecture)
  if (result.status !== 'optimal') throw new Error(`warm fixture returned ${result.status}`)
  warm.push(performance.now() - started)
}

await runtime.close()
warm.sort((left, right) => left - right)
const mean = warm.reduce((sum, value) => sum + value, 0) / warm.length

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  backend: runtime.backend,
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
