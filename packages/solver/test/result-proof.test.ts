import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Adapter, Explain, Model, Solve, Validate } from '@cavelang/solver'

const model: Model.t = { schema: Model.schema, variables: [], constraints: [] }
const common = { backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 }
const adapterOf = (result: Adapter.Result): Adapter.t => ({
  backend: common.backend, capabilities: new Set(Adapter.capabilities), solve: async () => result
})

test('proved solver outcomes require literal proof markers at result boundaries', async () => {
  for (const [status, field] of [['optimal', 'optimalityProved'], ['unsatisfied', 'infeasibilityProved']] as const) {
    for (const value of [undefined, null, false, 'true', 1, {}]) {
      const result = { ...common, status, assignment: {}, objectives: [], [field]: value } as unknown as Adapter.Result
      const pattern = new RegExp(`${status} solver result requires ${field}: true`)
      assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), pattern)
      await assert.rejects(Solve.run(adapterOf(result), model), pattern)
      await assert.rejects(Solve.runWithExplanation(adapterOf(result), model), pattern)
    }
  }
})

test('solver proof validation and returned outcomes use one captured marker', async () => {
  for (const status of ['optimal', 'unsatisfied'] as const) {
    for (const mode of ['run', 'explain', 'direct'] as const) {
      const field = status === 'optimal' ? 'optimalityProved' : 'infeasibilityProved'
      let reads = 0
      const result = { ...common, status, assignment: {}, objectives: [], get [field]() { return ++reads === 1 } } as unknown as Adapter.Result
      const output = mode === 'run' ? await Solve.run(adapterOf(result), model) : mode === 'explain' ?
        (await Solve.runWithExplanation(adapterOf(result), model)).outcome : Explain.report(model, result, Adapter.defaultLimits).outcome
      assert.equal(reads, 1)
      assert.equal(output.status, status)
      assert.equal((output as unknown as Record<string, unknown>)[field], true)
    }
  }
})

test('unsupported solver result statuses fail instead of losing the outcome', async () => {
  for (const status of [undefined, '', 'timeout']) {
    const result = { ...common, status } as unknown as Adapter.Result
    assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), /solver result status/)
    await assert.rejects(Solve.run(adapterOf(result), model), /solver result status/)
  }
})

test('rejected result metadata permits same-adapter recovery with detached outcomes', async () => {
  const result = { ...common, status: 'satisfied', assignment: {}, elapsedMs: -1,
    diagnostics: [{ level: 'info', code: 'fixture', message: 'original' }] } as Adapter.Result
  let calls = 0
  const adapter: Adapter.t = { ...adapterOf(result), solve: async () => { calls++; return result } }
  await assert.rejects(Solve.run(adapter, model), /elapsedMs/)
  await assert.rejects(Solve.runWithExplanation(adapter, model), /elapsedMs/)
  assert.equal(calls, 2)
  const mutable = result as unknown as { elapsedMs: number, diagnostics: { message: string }[] }
  mutable.elapsedMs = 0.5
  const captured = await Solve.run(adapter, model)
  mutable.diagnostics[0]!.message = 'updated'
  assert.equal(captured.diagnostics[0]!.message, 'original')
  const report = await Solve.runWithExplanation(adapter, model)
  assert.equal(report.run.elapsedMs, 0.5)
  assert.equal(report.run.diagnostics[0]!.message, 'updated')
  assert.equal(report.outcome.status, 'satisfied')
  assert.equal(calls, 4)
})

test('unknown solver outcomes require usable reasons across solve and explanation boundaries', async () => {
  for (const reason of [undefined, null, [], {}, 'timeout', { kind: 'other', message: 'detail' },
    { kind: 'timeout' }, { kind: 'timeout', message: 1 }, { kind: 'resource-limit', message: 'detail', limit: 'constructor' },
    { kind: 'resource-limit', message: 'detail', limit: null }]) {
    const result = { ...common, status: 'unknown', reason } as unknown as Adapter.Result
    assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), /unknown solver reason/)
    await assert.rejects(Solve.run(adapterOf(result), model), /unknown solver reason/)
    await assert.rejects(Solve.runWithExplanation(adapterOf(result), model), /unknown solver reason/)
  }
  for (const kind of ['timeout', 'resource-limit', 'cancelled', 'backend-error', 'indeterminate'] as const) {
    const result: Adapter.Result = { ...common, status: 'unknown', reason: { kind, message: '', limit: 'timeoutMs' } }
    const explanation = await Solve.runWithExplanation(adapterOf(result), model)
    assert.equal(explanation.outcome.status, 'unknown')
    assert.ok(Explain.render(explanation).includes(`Unknown: ${kind}`))
  }
})


test('unknown reason validation preserves captured fields and accepts supported limit names', async () => {
  for (const limit of Object.keys(Adapter.defaultLimits)) {
    const reason = Object.freeze({ kind: 'resource-limit', message: '', limit })
    assert.doesNotThrow(() => Validate.unknownReason(reason))
  }
  let kinds = 0, messages = 0, limits = 0
  const reason = {
    get kind() { return ++kinds === 1 ? 'timeout' : 'invalid' },
    get message() { return ++messages === 1 ? 'deadline' : null },
    get limit() { return ++limits === 1 ? 'timeoutMs' : 'invalid' }
  }
  const result = { ...common, status: 'unknown', reason } as unknown as Adapter.Result
  const explanation = await Solve.runWithExplanation(adapterOf(result), model)
  assert.deepEqual([kinds, messages, limits], [1, 1, 1])
  assert.deepEqual(explanation.outcome, { status: 'unknown', reason: { kind: 'timeout', message: 'deadline', limit: 'timeoutMs' } })
})

test('solver metadata rejects malformed identities, elapsed times and diagnostics', async () => {
  for (const metadata of [
    { backend: null }, { backend: { name: '', version: '1' } }, { backend: { name: 'fixture', version: 1 } },
    ...[undefined, null, -1, NaN, Infinity, '1'].map(elapsedMs => ({ elapsedMs })),
    ...[undefined, null, {}, [null], [{ level: 'debug', code: 'x', message: '' }],
      [{ level: 'info', code: null, message: '' }], [{ level: 'info', code: 'x', message: null }],
      new Array(1)].map(diagnostics => ({ diagnostics }))
  ]) {
    const result = { ...common, status: 'satisfied', assignment: {}, ...metadata } as unknown as Adapter.Result
    assert.throws(() => Explain.report(model, result, Adapter.defaultLimits), /solver (?:backend|elapsedMs|diagnostics)/)
    await assert.rejects(Solve.run(adapterOf(result), model), /solver (?:backend|elapsedMs|diagnostics)/)
    await assert.rejects(Solve.runWithExplanation(adapterOf(result), model), /solver (?:backend|elapsedMs|diagnostics)/)
  }
})

test('metadata validation accepts fractional time and preserves captured getter values', async () => {
  const diagnostics = Object.freeze(['info', 'warning', 'error'].map(level => Object.freeze({ level, code: '', message: '' })))
  assert.doesNotThrow(() => Validate.resultMetadata(Object.freeze({ ...common, elapsedMs: 0.25, diagnostics })))
  const reads = { backend: 0, name: 0, version: 0, elapsedMs: 0, diagnostics: 0, level: 0, code: 0, message: 0 }
  const result = { status: 'satisfied', assignment: {},
    get backend() { reads.backend++; return {
      get name() { return ++reads.name === 1 ? 'captured' : '' },
      get version() { return ++reads.version === 1 ? '1' : '' }
    } },
    get elapsedMs() { return ++reads.elapsedMs === 1 ? 0.25 : NaN },
    get diagnostics() { reads.diagnostics++; return [{
      get level() { return ++reads.level === 1 ? 'warning' : 'invalid' },
      get code() { return ++reads.code === 1 ? 'fixture' : null },
      get message() { return ++reads.message === 1 ? 'captured' : null }
    }] }
  } as unknown as Adapter.Result
  const explanation = await Solve.runWithExplanation(adapterOf(result), model)
  assert.deepEqual(Object.values(reads), Object.values(reads).map(() => 1))
  assert.equal(explanation.run.elapsedMs, 0.25)
  assert.deepEqual(explanation.run.backend, { name: 'captured', version: '1' })
  assert.deepEqual(explanation.run.diagnostics, [{ level: 'warning', code: 'fixture', message: 'captured' }])
})

test('failed result capture preserves thrown values and permits same-object retry at every boundary', async () => {
  for (const mode of ['run', 'explain', 'report'] as const) for (const unprintable of [false, true]) {
    const failure = unprintable ? Object.create(null) : new Error('backend identity unavailable')
    let broken = true, reads = 0
    const diagnostics = [{ level: 'info' as const, code: 'fixture', message: 'original' }]
    const result: Adapter.Result = { ...common, status: 'satisfied', assignment: {}, diagnostics,
      backend: { get name() { reads++; if (broken) throw failure; return 'recovered' }, version: '1' } }
    const adapter = adapterOf(result)
    const capture = async () => mode === 'run' ? Solve.run(adapter, model) : mode === 'explain' ?
      Solve.runWithExplanation(adapter, model) : Explain.report(model, result, Adapter.defaultLimits)
    await assert.rejects(capture(), error => error === failure)
    assert.equal(reads, 1)
    assert.equal(result.diagnostics, diagnostics)
    assert.equal(diagnostics[0]!.message, 'original')
    broken = false
    const output = await capture()
    assert.equal(reads, 2, 'retry captures the same input exactly once again')
    diagnostics[0]!.message = 'changed after capture'
    const metadata = 'run' in output ? output.run : output
    assert.equal(metadata.backend.name, 'recovered')
    assert.equal(metadata.diagnostics[0]!.message, 'original')
  }
})
