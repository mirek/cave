import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { closeWorkers } from '../src/close-workers.ts'

const worker = () => {
  let exit!: () => void
  let calls = 0
  const exited = new Promise<void>(resolve => { exit = resolve })
  return { terminate() { calls++; return exited }, exit() { exit() }, get calls() { return calls } }
}

test('pool teardown waits for running and idle worker exits while cleanup moves workers', async () => {
  const first = worker(), second = worker()
  const runningWorkers = [first]
  const unusedWorkers = [second]
  let cleared = false
  const pool = { runningWorkers, unusedWorkers, terminateAllThreads() { assert.strictEqual(this, pool); cleared = true } }
  const closing = closeWorkers(pool)
  assert.deepEqual([first.calls, second.calls], [1, 1])
  assert.equal(cleared, false)
  // A final cleanup message moves the worker before its exit acknowledgment.
  unusedWorkers.push(runningWorkers.pop()!)
  first.exit()
  await Promise.resolve()
  assert.equal(cleared, false)
  second.exit()
  await closing
  assert.equal(cleared, true)
  assert.deepEqual([first.calls, second.calls], [1, 1])
})

test('shutdown includes workers created by pending messages before clearing the pool', async () => {
  const first = worker(), late = worker()
  const runningWorkers = [first]
  let cleared = false
  const pool = { runningWorkers, unusedWorkers: [], terminateAllThreads() { cleared = true } }
  const closing = closeWorkers(pool)
  runningWorkers.push(late)
  first.exit()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(late.calls, 1)
  assert.equal(cleared, false)
  late.exit()
  await closing
  assert.equal(cleared, true)
})

test('empty and absent worker pools close without waiting for a worker event', async () => {
  let cleared = 0
  await closeWorkers({ runningWorkers: [], unusedWorkers: [], terminateAllThreads() { cleared++ } })
  await closeWorkers(undefined)
  assert.equal(cleared, 1)
})

for (const synchronous of [true, false]) {
  test(`failed ${synchronous ? 'synchronous' : 'asynchronous'} termination still waits for other workers`, async () => {
    const failure = new Error('termination failed')
    const failing = { terminate(): Promise<void> {
      if (synchronous) throw failure
      return Promise.reject(failure)
    } }
    const healthy = worker()
    let cleared = false
    let settled = false
    const closing = closeWorkers({
      runningWorkers: [failing], unusedWorkers: [healthy],
      terminateAllThreads() { cleared = true }
    })
    const rejected = assert.rejects(closing, error => error === failure)
    void closing.then(() => { settled = true }, () => { settled = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(healthy.calls, 1)
    assert.equal(settled, false)
    assert.equal(cleared, false)
    healthy.exit()
    await rejected
    assert.equal(cleared, false)
  })
}

test('multiple termination failures retain every cause without clearing handlers', async () => {
  const first = new Error('first worker')
  const second = new Error('second worker')
  let cleared = false
  await assert.rejects(closeWorkers({
    runningWorkers: [{ terminate() { throw first } }],
    unusedWorkers: [{ terminate() { return Promise.reject(second) } }],
    terminateAllThreads() { cleared = true }
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [first, second])
    assert.equal(error.message, 'Z3 worker termination failed: first worker; second worker')
    return true
  })
  assert.equal(cleared, false)
})

test('unprintable termination causes do not replace the aggregate failure', async () => {
  const first = { toString() { throw new Error('string conversion failed') } }
  const second = new Error('second worker')
  await assert.rejects(closeWorkers({
    runningWorkers: [{ terminate() { throw first } }, { terminate() { throw second } }],
    unusedWorkers: [],
    terminateAllThreads() { assert.fail('failed pool must retain handlers') }
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [first, second])
    assert.equal(error.message, 'Z3 worker termination failed: [unprintable thrown value]; second worker')
    return true
  })
})
