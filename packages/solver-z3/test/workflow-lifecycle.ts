import { mock } from 'node:test'
import * as assert from 'node:assert/strict'
import { Adapter } from '@cavelang/solver'

const mode = process.argv[2]
const unprintable = { toString() { throw new Error('cannot stringify') } }
let created = 0
let closed = 0
const adapter: Adapter.t & { close: () => Promise<void> } = {
  backend: { name: 'fake', version: '1' },
  capabilities: new Set(Adapter.capabilities),
  solve: async () => ({
    status: 'unknown', reason: { kind: 'timeout', message: 'timeout', limit: 'timeoutMs' },
    backend: { name: 'fake', version: '1' }, diagnostics: [], elapsedMs: 0
  }),
  close: async () => {
    closed++
    if (mode === 'unprintable-cleanup') throw unprintable
    if (mode === 'unprintable-operation' || mode === 'success') return
    throw new Error('cleanup unavailable')
  }
}
if (mode === 'combined' || mode === 'unprintable-operation') {
  Object.defineProperty(adapter, 'capabilities', { get() { if (mode === 'unprintable-operation') throw unprintable; throw new Error('operation unavailable') } })
}
mock.module(new URL('../src/runtime.ts', import.meta.url).href, {
  namedExports: { create: async () => {
    created++
    if (mode === 'unprintable-startup') throw unprintable
    if (mode === 'startup') throw new Error('startup unavailable')
    return adapter
  } }
})
const { runWorkflowFixture } = await import('../src/workflow-fixture.ts')
const invalid = await runWorkflowFixture(['invalid'])
assert.equal(invalid.code, 2)
assert.equal(created, 0)
const result = await runWorkflowFixture(['architecture', 'feasibility'])
assert.equal(created, 1)
assert.equal(closed, mode === 'startup' || mode === 'unprintable-startup' ? 0 : 1)
if (mode === 'success') {
  assert.equal(result.code, 0)
  assert.equal(result.err, '')
  assert.equal(JSON.parse(result.out).explanation.outcome.status, 'unknown')
} else {
  assert.equal(result.code, 1)
  assert.equal(result.out, '')
  assert.equal(result.err, mode === 'unprintable-startup' || mode === 'unprintable-operation' ? '[unprintable thrown value]\n'
    : mode === 'unprintable-cleanup' ? 'Z3 shutdown failed: [unprintable thrown value]\n'
    : mode === 'startup' ? 'startup unavailable\n'
    : mode === 'combined' ? 'operation unavailable\nZ3 shutdown failed: cleanup unavailable\n'
    : 'Z3 shutdown failed: cleanup unavailable\n')
}
// Caller-owned adapters must never be closed by the fixture.
let suppliedClosed = 0
const supplied = { backend: adapter.backend, solve: adapter.solve, capabilities: new Set(Adapter.capabilities), close: async () => { suppliedClosed++ } }
await runWorkflowFixture(['architecture', 'feasibility'], supplied)
assert.equal(suppliedClosed, 0)
assert.equal(created, 1)
