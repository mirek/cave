import assert from 'node:assert/strict'
import test from 'node:test'
import { PlaygroundRuntime } from '../src/playground/client.ts'

type Listener = (event: { data?: unknown, message?: string }) => void

class WorkerDouble {
  static current: WorkerDouble
  readonly requests: { id: number }[] = []
  readonly listeners = new Map<string, Listener>()
  terminated = 0
  sendFailure: Error | undefined
  constructor() { WorkerDouble.current = this }
  addEventListener(name: string, listener: Listener) { this.listeners.set(name, listener) }
  postMessage(request: { id: number }) {
    if (this.sendFailure !== undefined) throw this.sendFailure
    this.requests.push(request)
  }
  terminate() { this.terminated++ }
  emit(name: string, event: Parameters<Listener>[0]) { this.listeners.get(name)?.(event) }
}

const withWorker = async (body: () => Promise<void>) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerDouble })
  try { await body() } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'Worker')
    else Object.defineProperty(globalThis, 'Worker', descriptor)
  }
}

test('malformed worker replies retire the runtime and settle all requests', { timeout: 5000 }, async () => {
  for (const data of [null, [], { id: 0, ok: true }, { id: 1.5, ok: true }, { id: 1, ok: 'yes' },
    { id: 1, ok: false, error: 42 }, { id: 1, ok: false, error: 'bad', fatal: 'yes' },
    { id: 1, ok: true, result: null },
    { id: 1, ok: true, result: { matches: 1, output: 'wrong result kind' } },
    { id: 1, ok: true, result: { claims: -1, edges: 0, currentBeliefs: 0 } }]) {
    await withWorker(async () => {
      const failures: Error[] = []
      const runtime = new PlaygroundRuntime(error => failures.push(error))
      const worker = WorkerDouble.current
      const settled = Promise.allSettled([runtime.open('api IS service', 'test'), runtime.query('?x IS service')])
      try {
        assert.doesNotThrow(() => worker.emit('message', { data }))
        assert.equal(runtime.isClosed, true)
        const results = await settled
        assert.ok(results.every(result => result.status === 'rejected' && /invalid response/.test(result.reason.message)))
        assert.equal(failures.length, 1)
        assert.equal(worker.terminated, 1)
        assert.doesNotThrow(() => worker.emit('message', { data: null }))
        assert.equal(failures.length, 1)
      } finally { runtime.close(); await settled }
    })
  }
})

test('query response validation rejects malformed counts and output', { timeout: 5000 }, async () => {
  for (const result of [{ matches: -1, output: '' }, { matches: 0.5, output: '' },
    { matches: Infinity, output: '' }, { matches: 0, output: null },
    { claims: 0, edges: 0, currentBeliefs: 0 }]) {
    await withWorker(async () => {
      const runtime = new PlaygroundRuntime()
      const worker = WorkerDouble.current
      const response = runtime.query('?x IS service')
      const rejected = assert.rejects(response, /invalid response/)
      worker.emit('message', { data: { id: 1, ok: true, result } })
      await rejected
      assert.equal(runtime.isClosed, true)
      assert.equal(worker.terminated, 1)
    })
  }
})

test('worker shutdown settles every pending request and ignores late replies', { timeout: 5000 }, async () => {
  for (const cause of ['close', 'error', 'messageerror', 'fatal'] as const) {
    await withWorker(async () => {
      const failures: Error[] = []
      const runtime = new PlaygroundRuntime(error => failures.push(error))
      const worker = WorkerDouble.current
      const first = runtime.open('api IS service', 'test')
      const second = runtime.query('?x IS service')
      const third = runtime.append('other IS service')
      const settled = Promise.allSettled([first, second, third])
      if (cause === 'close') runtime.close()
      else if (cause === 'fatal') worker.emit('message', { data: { id: worker.requests[0]!.id, ok: false, error: 'initialization failed', fatal: true } })
      else worker.emit(cause, { message: 'worker failed' })
      const outcomes = await settled
      assert.ok(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason instanceof Error), cause)
      assert.equal(runtime.isClosed, true)
      assert.equal(worker.terminated, 1)
      assert.equal(failures.length, cause === 'close' ? 0 : 1)
      worker.emit('message', { data: { id: worker.requests[1]!.id, ok: true, result: { matches: 1, output: 'late' } } })
      worker.emit('error', { message: 'late error' })
      runtime.close()
      assert.equal(worker.terminated, 1)
      assert.equal(failures.length, cause === 'close' ? 0 : 1)
      await assert.rejects(runtime.query('?x IS service'), /closed/)
      assert.equal(worker.requests.length, 3)
      assert.equal((Reflect.get(runtime, 'pending') as Map<number, unknown>).size, 0)
    })
  }
})

test('ordinary worker request errors preserve other requests and future queries', { timeout: 5000 }, async () => withWorker(async () => {
  const runtime = new PlaygroundRuntime(() => assert.fail('ordinary query errors must not retire the worker'))
  const worker = WorkerDouble.current
  try {
    const bad = runtime.query('invalid')
    const good = runtime.query('?x IS service')
    const rejected = assert.rejects(bad, /bad query/)
    worker.emit('message', { data: { id: worker.requests[0]!.id, ok: false, error: 'bad query' } })
    const result = { matches: 1, output: 'api' }
    worker.emit('message', { data: { id: worker.requests[1]!.id, ok: true, result } })
    await rejected
    assert.deepEqual(await good, result)
    assert.equal(runtime.isClosed, false)
    assert.equal(worker.terminated, 0)
    const next = runtime.query('?x IS service')
    worker.emit('message', { data: { id: worker.requests[2]!.id, ok: true, result } })
    assert.deepEqual(await next, result)
  } finally { runtime.close() }
}))


test('failed worker sends release pending requests without closing a usable worker', { timeout: 5000 }, async () => withWorker(async () => {
  const runtime = new PlaygroundRuntime(() => assert.fail('a failed send must not retire a healthy worker'))
  const worker = WorkerDouble.current
  try {
    const earlier = runtime.open('api IS service', 'test')
    const pending = Reflect.get(runtime, 'pending') as Map<number, unknown>
    worker.sendFailure = new Error('send failed')
    for (let index = 0; index < 100; index++) {
      await assert.rejects(runtime.query('invalid'), /send failed/)
      assert.equal(pending.size, 1, 'only the earlier request remains pending')
    }
    assert.equal(worker.terminated, 0)
    assert.equal(runtime.isClosed, false)
    worker.sendFailure = undefined
    const opened = { claims: 1, edges: 0, currentBeliefs: 1 }
    worker.emit('message', { data: { id: worker.requests[0]!.id, ok: true, result: opened } })
    assert.deepEqual(await earlier, opened)
    const later = runtime.query('?x IS service')
    const result = { matches: 1, output: 'api' }
    worker.emit('message', { data: { id: worker.requests[1]!.id, ok: true, result } })
    assert.deepEqual(await later, result)
    assert.equal(pending.size, 0)
  } finally { runtime.close() }
}))
