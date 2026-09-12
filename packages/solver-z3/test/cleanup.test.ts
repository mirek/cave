import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { guardCleanup } from '../src/cleanup.ts'

const deferred = () => {
  let resolve!: (value: string) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('native cleanup waits for all active checks and preserves release order', async () => {
  const solver = deferred()
  const optimizer = deferred()
  const released: string[] = []
  const api = {
    solver_check_assumptions: () => solver.promise,
    optimize_check: () => optimizer.promise,
    dec_ref: (id: string) => { released.push(`ast:${id}`) },
    model_dec_ref: (id: string) => { released.push(`model:${id}`) },
    del_context: (id: string) => { released.push(`context:${id}`) }
  }
  guardCleanup(api)
  api.dec_ref('before')
  const first = api.solver_check_assumptions()
  const second = api.optimize_check()
  api.dec_ref('during')
  api.model_dec_ref('during')
  api.del_context('during')
  assert.deepEqual(released, ['ast:before'])
  solver.resolve('sat')
  assert.equal(await first, 'sat')
  assert.deepEqual(released, ['ast:before'])
  optimizer.resolve('unsat')
  assert.equal(await second, 'unsat')
  assert.deepEqual(released, ['ast:before', 'ast:during', 'model:during', 'context:during'])
  api.dec_ref('after')
  assert.equal(released.at(-1), 'ast:after')
})

test('a rejected native check drains queued cleanup and permits subsequent checks', async () => {
  const operation = deferred()
  let releases = 0
  const api = {
    solver_check_assumptions: () => operation.promise,
    optimize_check: async () => 'sat',
    dec_ref: () => { releases++ }
  }
  guardCleanup(api)
  const checked = api.solver_check_assumptions()
  api.dec_ref()
  const failure = new Error('native failure')
  operation.reject(failure)
  await assert.rejects(checked, error => error === failure)
  assert.equal(releases, 1)
  assert.equal(await api.optimize_check(), 'sat')
  api.dec_ref()
  assert.equal(releases, 2)
})

for (const checkFails of [false, true]) for (const multiple of [false, true]) {
  test(`queued cleanup attempts every release and retains failures (check=${checkFails}, multiple=${multiple})`, async () => {
    const operation = deferred()
    const checkError = new Error('native check failed')
    const firstError = Object.create(null)
    const secondError = new Error('second release failed')
    const released: string[] = []
    const api = {
      solver_check_assumptions: () => operation.promise,
      optimize_check: async () => 'sat',
      dec_ref: (id: string) => {
        released.push(id)
        if (id === 'first') throw firstError
        if (id === 'second' && multiple) throw secondError
      }
    }
    guardCleanup(api)
    const checked = api.solver_check_assumptions()
    for (const id of ['first', 'second', 'last']) api.dec_ref(id)
    assert.deepEqual(released, [])
    if (checkFails) operation.reject(checkError)
    else operation.resolve('sat')
    await assert.rejects(checked, error => {
      if (!checkFails && !multiple) return error === firstError
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [
        ...checkFails ? [checkError] : [], firstError, ...multiple ? [secondError] : []
      ])
      if (checkFails) assert.equal(error.cause, checkError)
      assert.match(error.message, /unprintable thrown value/)
      return true
    })
    assert.deepEqual(released, ['first', 'second', 'last'])
    assert.equal(await api.optimize_check(), 'sat')
    api.dec_ref('after')
    assert.deepEqual(released, ['first', 'second', 'last', 'after'])
  })
}
