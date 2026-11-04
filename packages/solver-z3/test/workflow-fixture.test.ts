import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter, Workflow } from '@cavelang/solver'
import { architectureModel, runWorkflowFixture } from '@cavelang/solver-z3'

test('architecture fixture is bounded, named, and keeps confidence out of its objective', () => {
  const model = architectureModel({ teamSize: 10, deploymentFrequency: 6 })
  assert.deepEqual(model.variables.map(variable => variable.id), [
    'architecture', 'deployment-frequency', 'team-size'
  ])
  assert.deepEqual(model.constraints.map(constraint => constraint.id), [
    'microservices-team-capacity', 'small-team-monolith',
    'input/team-size', 'input/deployment-frequency'
  ])
  assert.deepEqual(model.objectives?.map(objective => objective.id), ['operational-cost'])
})

test('fixture rejects unknown models and invalid typed inputs before loading an adapter', async () => {
  let invoked = false
  const adapter: Adapter.t = {
    backend: { name: 'fake', version: '1' },
    capabilities: new Set(Adapter.capabilities),
    solve: async () => {
      invoked = true
      throw new Error('must not run')
    }
  }
  const unknown = await runWorkflowFixture(['uploaded-model', 'optimization'], adapter)
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /unknown workflow model/)
  const invalid = await runWorkflowFixture(['architecture', 'optimization', '--team-size', '100'], adapter)
  assert.equal(invalid.code, 2)
  assert.match(invalid.err, /2 to 20/)
  assert.equal(invoked, false)
})

test('fixture routes through workflow validation and the shared result vocabulary', async () => {
  let submittedTimeout = 0
  const adapter: Adapter.t = {
    backend: { name: 'fake', version: '1' },
    capabilities: new Set(Adapter.capabilities),
    solve: async (_model, request) => {
      submittedTimeout = request.limits.timeoutMs
      return {
        status: 'unknown',
        reason: { kind: 'timeout', message: 'fixture timeout', limit: 'timeoutMs' },
        backend: { name: 'fake', version: '1' },
        diagnostics: [],
        elapsedMs: 1
      }
    }
  }
  const result = await runWorkflowFixture([
    'architecture', 'optimization', '--team-size', '10',
    '--deployment-frequency', '6', '--timeout-ms', '25'
  ], adapter)
  assert.equal(result.code, 0)
  assert.equal(submittedTimeout, 25)
  const report = JSON.parse(result.out) as Workflow.Report
  assert.equal(report.schema, Workflow.schema)
  assert.deepEqual(report.operation, { kind: 'optimization' })
  assert.equal(report.explanation.outcome.status, 'unknown')
})

for (const [flag, field] of [['--max-explanation-bits', 'maxExplanationBits'], ['--max-explanation-work', 'maxExplanationWork']] as const) {
test(`fixture validates ${field} before invoking the adapter`, async () => {
  let calls = 0
  const adapter: Adapter.t = { backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; throw new Error('must not run') } }
  for (const flags of [[], ['0'], ['-1'], ['1.5'], ['NaN'], ['Infinity'], ['9007199254740992'],
    ['64', flag, '128']]) {
    const result = await runWorkflowFixture(['architecture', 'optimization', flag, ...flags], adapter)
    assert.equal(result.code, 2)
    assert.match(result.err, new RegExp(flag))
  }
  assert.equal(calls, 0)
  const help = await runWorkflowFixture(['--help'], adapter)
  assert.match(help.out, new RegExp(flag))
})

test(`every fixture operation carries the selected or default ${field}`, async () => {
  for (const operation of ['feasibility', 'optimization', 'counterexample', 'sensitivity']) {
    for (const maximum of [undefined, 64]) {
      const seen: number[] = []
      const adapter: Adapter.t = { backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
        solve: async (_model, request) => {
          seen.push(request.limits[field])
          return { status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' },
            backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
        } }
      const flags = maximum === undefined ? [] : [flag, String(maximum)]
      const result = await runWorkflowFixture(['architecture', operation, '--from', '1', '--to', '1', ...flags], adapter)
      assert.equal(result.code, 0, result.err)
      assert.ok(seen.length > 0)
      assert.ok(seen.every(value => value === (maximum ?? Adapter.defaultLimits[field])))
      assert.match(result.out, new RegExp(`"${field}": ${maximum ?? Adapter.defaultLimits[field]}`))
    }
  }
})

}

test('fixture rejects timeouts outside the Z3 timer range before adapter submission', async () => {
  const seen: number[] = []
  const adapter: Adapter.t = { backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async (_model, request) => {
      seen.push(request.limits.timeoutMs)
      return { status: 'unknown', reason: { kind: 'timeout', message: 'fixture' },
        backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
    } }
  for (const timeout of ['2147483648', '9007199254740991']) {
    const result = await runWorkflowFixture(['architecture', 'optimization', '--timeout-ms', timeout], adapter)
    assert.equal(result.code, 2)
    assert.match(result.err, /--timeout-ms must be an integer from 1 to 2147483647/)
  }
  assert.deepEqual(seen, [])
  for (const timeout of ['1', '2147483647']) {
    const result = await runWorkflowFixture(['architecture', 'optimization', '--timeout-ms', timeout], adapter)
    assert.equal(result.code, 0, result.err)
  }
  assert.deepEqual(seen, [1, 2147483647])
})

for (const mode of ['startup', 'cleanup', 'combined', 'success', 'unprintable-startup', 'unprintable-operation', 'unprintable-cleanup']) {
  test(`workflow runtime lifecycle reports ${mode} without leaking adapter ownership`, async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { fileURLToPath } = await import('node:url')
    await promisify(execFile)(process.execPath, [
      '--experimental-test-module-mocks',
      fileURLToPath(new URL('./workflow-lifecycle.ts', import.meta.url)), mode
    ], { timeout: 10000 })
  })
}

test('sensitivity --db binds the team size from a CAVE claim and cites its evidence row', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { open } = await import('@cavelang/store')
  const dir = mkdtempSync(join(tmpdir(), 'cave-solver-db-'))
  try {
    const path = join(dir, 'facts.db')
    const store = open(path)
    store.ingest('system HAS team-size: 12 people')
    store.close()
    let calls = 0
    const adapter: Adapter.t = { backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
      solve: async () => {
        calls++
        return { status: 'unknown', reason: { kind: 'indeterminate', message: 'fixture' },
          backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
      } }
    const result = await runWorkflowFixture(['architecture', 'sensitivity', '--db', path, '--from', '3', '--to', '3'], adapter)
    assert.equal(result.code, 0, result.err)
    assert.equal(calls, 1)
    const report = JSON.parse(result.out) as Workflow.SensitivityReport
    assert.deepEqual(report.fixed, [{ variableId: 'team-size', value: { sort: 'int', value: '12' } }])
    const run = report.points[0]!.report.explanation.run
    assert.equal(run.scenario?.id, 'architecture-sensitivity')
    assert.equal(run.inputs.length, 1)
    assert.equal(run.inputs[0]!.query, 'system HAS team-size: ?n')
    assert.equal(run.inputs[0]!.authoredValue, '12 people')
    assert.equal(run.inputs[0]!.evidenceRowIds.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--db rejects other operations, --team-size, and unusable claims before the adapter runs', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { open } = await import('@cavelang/store')
  let calls = 0
  const adapter: Adapter.t = { backend: { name: 'fixture', version: '1' }, capabilities: new Set(Adapter.capabilities),
    solve: async () => { calls++; throw new Error('must not run') } }
  for (const operation of ['feasibility', 'optimization', 'counterexample']) {
    const result = await runWorkflowFixture(['architecture', operation, '--db', 'facts.db'], adapter)
    assert.equal(result.code, 2)
    assert.match(result.err, /--db is supported only by sensitivity/)
  }
  const both = await runWorkflowFixture(['architecture', 'sensitivity', '--db', 'facts.db', '--team-size', '10'], adapter)
  assert.equal(both.code, 2)
  assert.match(both.err, /mutually exclusive/)
  const dir = mkdtempSync(join(tmpdir(), 'cave-solver-db-'))
  try {
    for (const [index, [claim, message]] of ([
      ['other HAS team-size: 10 people', /matched no eligible value/],
      ['system HAS team-size: 10', /expected unit "people"/],
      ['system HAS team-size: 30 people', /from 2 to 20 people/]
    ] as const).entries()) {
      const path = join(dir, `${index}.db`)
      const store = open(path)
      store.ingest(claim)
      store.close()
      const result = await runWorkflowFixture(['architecture', 'sensitivity', '--db', path], adapter)
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, message)
    }
    const missing = await runWorkflowFixture(['architecture', 'sensitivity', '--db', join(dir, 'absent.db')], adapter)
    assert.equal(missing.code, 1)
    assert.match(missing.err, /^--db /)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(calls, 0)
})
