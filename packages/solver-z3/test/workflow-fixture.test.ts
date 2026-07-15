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
