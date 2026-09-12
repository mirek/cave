import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Model, Solve } from '../packages/solver/src/index.ts'
import { create } from '../packages/solver-z3/src/index.ts'

if (process.argv[2] === '--case') {
  const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
  const size = 80
  const variables = Array.from({ length: size }, (_, index) =>
    ({ id: `p${index}`, sort: 'int', min: 0, max: size - 2 }))
  const constraints = []
  for (let left = 0; left < size; left++) for (let right = left + 1; right < size; right++) {
    constraints.push({ id: `different-${left}-${right}`, expression: { kind: 'neq',
      left: { kind: 'variable', id: `p${left}` }, right: { kind: 'variable', id: `p${right}` } } })
  }
  const model = { schema: Model.schema, variables, constraints }
  const runtime = await create()
  emit({ phase: 'initialized', initializationMs: runtime.initializationMs, backend: runtime.backend })
  try {
    for (let iteration = 0; iteration < 10; iteration++) {
      emit({ phase: 'starting', iteration })
      const started = performance.now()
      const result = await Solve.run(runtime, model, { limits: { timeoutMs: 1 } })
      const wallMs = performance.now() - started
      emit({ phase: 'result', iteration, wallMs, adapterElapsedMs: result.elapsedMs,
        status: result.status, reason: result.status === 'unknown' ? result.reason : undefined })
      assert.equal(result.status, 'unknown')
      assert.equal(result.reason.kind, 'timeout')
      const recovery = await Solve.run(runtime, { schema: Model.schema, variables: [], constraints: [] })
      assert.equal(recovery.status, 'satisfied')
      emit({ phase: 'recovered', iteration })
    }
  } finally {
    const started = performance.now()
    await runtime.close()
    emit({ phase: 'closed', closeMs: performance.now() - started })
  }
} else {
  const runs = []
  for (let trial = 0; trial < 3; trial++) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case'],
      { encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
    const events = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    runs.push({ trial, status: child.status, signal: child.signal, error: child.error?.code,
      stderr: child.stderr, events })
  }
  const paths = ['scripts/z3-deadline-probe.mjs', 'pnpm-lock.yaml',
    ...['packages/solver/src', 'packages/solver-z3/src'].flatMap(directory =>
      readdirSync(directory).filter(name => name.endsWith('.ts')).sort().map(name => `${directory}/${name}`))]
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    protocol: 'Three sequential fresh processes; ten 1 ms pigeonhole requests each on one runtime, each followed by a satisfiable recovery check. A 15 s external process deadline retains partial events and terminates an overrun; it is a diagnostic harness limit, not an adapter guarantee.',
    sources: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), runs }, null, 2))
  if (runs.some(run => run.status !== 0)) process.exitCode = 1
}
