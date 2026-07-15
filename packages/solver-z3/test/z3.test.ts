import { after, test } from 'node:test'
import * as assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const run = promisify(execFile)
const runtimePromise = create()

after(async () => (await runtimePromise).close())

const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const int = (value: Model.Integer): Model.Expression => ({ kind: 'literal', sort: 'int', value })
const real = (value: Model.Rational): Model.Expression => ({ kind: 'literal', sort: 'real', value })

test('initializes one lazy process runtime', async () => {
  const runtime = await runtimePromise
  assert.strictEqual(await create(), runtime)
  assert.match(runtime.backend.version, /4\.16\.0/)
  assert.ok(runtime.initializationMs > 0)
})

test('compiles Boolean, bounded integer, exact rational, and finite enum values', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    enums: [{ id: 'architecture', values: ['monolith', 'microservices'] }],
    variables: [
      { id: 'available', sort: 'bool' },
      { id: 'team-size', sort: 'int', min: 1, max: 100 },
      { id: 'cost', sort: 'real' },
      { id: 'choice', sort: 'enum', domain: 'architecture' }
    ],
    constraints: [
      { id: 'available', expression: ref('available') },
      { id: 'team', expression: { kind: 'eq', left: ref('team-size'), right: int(12) } },
      { id: 'cost', expression: { kind: 'eq', left: ref('cost'), right: real('0.10000000000000000000') } },
      {
        id: 'exact-division',
        expression: {
          kind: 'eq',
          left: { kind: 'divide', left: int(1), right: int(2) },
          right: real('0.5')
        }
      },
      {
        id: 'choice',
        expression: {
          kind: 'eq',
          left: ref('choice'),
          right: { kind: 'literal', sort: 'enum', domain: 'architecture', value: 'microservices' }
        }
      }
    ]
  }
  const result = await Solve.run(runtime, model)
  assert.equal(result.status, 'satisfied')
  if (result.status !== 'satisfied') return
  assert.deepEqual(result.assignment, {
    available: { sort: 'bool', value: true },
    choice: { sort: 'enum', domain: 'architecture', value: 'microservices' },
    cost: { sort: 'real', numerator: '1', denominator: '10' },
    'team-size': { sort: 'int', value: '12' }
  })
})

test('maps an unsatisfiable core back to stable constraint IDs', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'deploy', sort: 'bool' }],
    constraints: [
      { id: 'policy/must-deploy', expression: ref('deploy') },
      { id: 'policy/must-not-deploy', expression: { kind: 'not', value: ref('deploy') } }
    ]
  }
  const result = await Solve.run(runtime, model, { unsatCore: true })
  assert.equal(result.status, 'unsatisfied')
  if (result.status !== 'unsatisfied') return
  assert.deepEqual(result.core, ['policy/must-deploy', 'policy/must-not-deploy'])
})

test('renders a real Z3 core with CAVE evidence and scenario inputs', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'deploy', sort: 'bool' }],
    constraints: [
      {
        id: 'policy/must-deploy', expression: ref('deploy'),
        declaration: { uri: 'models/release.cave', line: 3 },
        evidenceRowIds: ['row:release-policy'], scenarioInputIds: ['release-window']
      },
      {
        id: 'policy/must-not-deploy', expression: { kind: 'not', value: ref('deploy') },
        declaration: { uri: 'models/release.cave', line: 4 },
        evidenceRowIds: ['row:freeze'], scenarioInputIds: ['release-window']
      }
    ]
  }
  const report = await Solve.runWithExplanation(runtime, model, { unsatCore: true }, {
    inputs: [{
      id: 'release-window', authoredValue: 'Friday 17:00',
      evidenceRowIds: ['row:release-policy', 'row:freeze'], scenarioClaimIds: []
    }]
  })
  assert.equal(report.outcome.status, 'unsatisfied')
  if (report.outcome.status !== 'unsatisfied') return
  assert.deepEqual(report.outcome.core?.map(constraint => ({
    id: constraint.id,
    declaration: constraint.declaration,
    evidenceRowIds: constraint.evidenceRowIds,
    scenarioInputIds: constraint.scenarioInputIds
  })), [
    {
      id: 'policy/must-deploy', declaration: { uri: 'models/release.cave', line: 3 },
      evidenceRowIds: ['row:release-policy'], scenarioInputIds: ['release-window']
    },
    {
      id: 'policy/must-not-deploy', declaration: { uri: 'models/release.cave', line: 4 },
      evidenceRowIds: ['row:freeze'], scenarioInputIds: ['release-window']
    }
  ])
})

test('canonical enum coding is stable across declaration reordering', async () => {
  const runtime = await runtimePromise
  const fixture = (values: readonly string[]): Model.t => ({
    schema: Model.schema,
    enums: [{ id: 'architecture', values }],
    variables: [{ id: 'choice', sort: 'enum', domain: 'architecture' }],
    constraints: []
  })
  const [left, right] = await Promise.all([
    Solve.run(runtime, fixture(['microservices', 'monolith'])),
    Solve.run(runtime, fixture(['monolith', 'microservices']))
  ])
  assert.equal(left.status, 'satisfied')
  assert.equal(right.status, 'satisfied')
  if (left.status === 'satisfied' && right.status === 'satisfied') {
    assert.deepEqual(left.assignment, right.assignment)
  }
})

test('minimizes, maximizes, and applies objectives lexicographically', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [
      { id: 'cost', sort: 'int', min: 0, max: 10 },
      { id: 'capacity', sort: 'int', min: 0, max: 10 }
    ],
    constraints: [
      { id: 'cost-floor', expression: { kind: 'gte', left: ref('cost'), right: int(3) } },
      { id: 'capacity-ceiling', expression: { kind: 'lte', left: ref('capacity'), right: int(8) } }
    ],
    softConstraints: [{
      id: 'prefer-expensive',
      expression: { kind: 'eq', left: ref('cost'), right: int(10) },
      weight: '100'
    }],
    objectives: [
      { id: 'min-cost', direction: 'minimize', expression: ref('cost') },
      { id: 'max-capacity', direction: 'maximize', expression: ref('capacity') }
    ]
  }
  const result = await Solve.run(runtime, model)
  assert.equal(result.status, 'optimal')
  if (result.status !== 'optimal') return
  assert.deepEqual(result.assignment, {
    capacity: { sort: 'int', value: '8' },
    cost: { sort: 'int', value: '3' }
  })
  assert.deepEqual(result.objectives, [
    { objectiveId: 'min-cost', value: { sort: 'int', value: '3' } },
    { objectiveId: 'max-capacity', value: { sort: 'int', value: '8' } }
  ])
})

test('uses explicit soft weights without consulting belief confidence', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'choice', sort: 'int', min: 0, max: 2 }],
    constraints: [],
    softConstraints: [
      { id: 'weak', expression: { kind: 'eq', left: ref('choice'), right: int(1) }, weight: '1' },
      { id: 'strong', expression: { kind: 'eq', left: ref('choice'), right: int(2) }, weight: '5.0' }
    ]
  }
  const result = await Solve.run(runtime, model)
  assert.equal(result.status, 'optimal')
  if (result.status !== 'optimal') return
  assert.deepEqual(result.assignment.choice, { sort: 'int', value: '2' })
})

test('queues simultaneous solve requests without sharing solver state', async () => {
  const runtime = await runtimePromise
  const fixture = (value: number): Model.t => ({
    schema: Model.schema,
    variables: [{ id: 'x', sort: 'int', min: 0, max: 10 }],
    constraints: [{ id: `x-${value}`, expression: { kind: 'eq', left: ref('x'), right: int(value) } }]
  })
  const [left, right] = await Promise.all([
    Solve.run(runtime, fixture(2)),
    Solve.run(runtime, fixture(9))
  ])
  assert.equal(left.status, 'satisfied')
  assert.equal(right.status, 'satisfied')
  if (left.status === 'satisfied') assert.deepEqual(left.assignment.x, { sort: 'int', value: '2' })
  if (right.status === 'satisfied') assert.deepEqual(right.assignment.x, { sort: 'int', value: '9' })
})

test('reports an actual solver deadline as unknown rather than infeasible', async () => {
  const runtime = await runtimePromise
  const size = 80
  const variables: Model.Variable[] = Array.from(
    { length: size },
    (_, index) => ({ id: `p${index}`, sort: 'int', min: 0, max: size - 2 })
  )
  const constraints: Model.HardConstraint[] = []
  for (let left = 0; left < size; left += 1) {
    for (let right = left + 1; right < size; right += 1) {
      constraints.push({
        id: `different-${left}-${right}`,
        expression: { kind: 'neq', left: ref(`p${left}`), right: ref(`p${right}`) }
      })
    }
  }
  const result = await Solve.run(runtime, { schema: Model.schema, variables, constraints }, {
    limits: { timeoutMs: 1 }
  })
  assert.equal(result.status, 'unknown')
  if (result.status !== 'unknown') return
  assert.equal(result.reason.kind, 'timeout')
  assert.equal(result.reason.limit, 'timeoutMs')
})

test('enforces the portable output-size limit after solving', async () => {
  const runtime = await runtimePromise
  const result = await Solve.run(runtime, {
    schema: Model.schema,
    variables: [{ id: 'ok', sort: 'bool' }],
    constraints: [{ id: 'ok', expression: ref('ok') }]
  }, { limits: { maxOutputBytes: 1 } })
  assert.equal(result.status, 'unknown')
  if (result.status !== 'unknown') return
  assert.equal(result.reason.kind, 'resource-limit')
  assert.equal(result.reason.limit, 'maxOutputBytes')
})

test('maps Z3 memory exhaustion to the portable resource-limit result', async () => {
  const runtime = await runtimePromise
  const model: Model.t = {
    schema: Model.schema,
    variables: [{ id: 'ok', sort: 'bool' }],
    constraints: [{ id: 'ok', expression: ref('ok') }]
  }
  const limited = await Solve.run(runtime, model, {
    limits: { maxMemoryBytes: 1024 * 1024 }
  })
  assert.equal(limited.status, 'unknown')
  if (limited.status !== 'unknown') return
  assert.equal(limited.reason.kind, 'resource-limit')
  assert.equal(limited.reason.limit, 'maxMemoryBytes')

  // Raising the next request's process-wide Z3 limit restores normal solving.
  assert.equal((await Solve.run(runtime, model)).status, 'satisfied')
})

test('a short-lived process terminates workers cleanly', async () => {
  const result = await run(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    new URL('./short-lived.ts', import.meta.url).pathname
  ], { timeout: 10_000 })
  assert.equal(result.stderr, '')
})
