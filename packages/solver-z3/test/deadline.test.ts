import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { withDeadline } from '../src/deadline.ts'

test('a pending check receives another interrupt after ignoring the first', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let active = false
  let interrupts = 0
  let settle!: (status: 'unknown') => void
  const check = new Promise<'unknown'>(resolve => { settle = resolve })
  const result = withDeadline({ interrupt() {
    interrupts++
    if (active) settle('unknown')
  } }, 5, () => check)
  t.mock.timers.tick(5)
  assert.equal(interrupts, 1)
  active = true
  t.mock.timers.tick(50)
  assert.ok(interrupts >= 2, 'pending native work must receive a retry')
  assert.deepEqual(await result, { status: 'unknown', interrupted: true })
  const stopped = interrupts
  t.mock.timers.tick(1000)
  assert.equal(interrupts, stopped)
})

for (const failure of [false, true]) {
  test(`deadline timers stop after check ${failure ? 'failure' : 'success'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const error = new Error('check failed')
    let interrupts = 0
    const result = withDeadline({ interrupt() { interrupts++ } }, 5, async () => {
      if (failure) throw error
      return 'sat'
    })
    if (failure) await assert.rejects(result, value => value === error)
    else assert.deepEqual(await result, { status: 'sat', interrupted: false })
    t.mock.timers.tick(1000)
    assert.equal(interrupts, 0)
  })
}

for (const checkFails of [false, true]) for (const interruptError of [undefined, Object.create(null), new Error('first interrupt failed')]) {
  test(`interrupt failure stays in the pending check (checkFails=${checkFails}, thrown=${interruptError === undefined ? 'undefined' : interruptError instanceof Error ? 'Error' : 'unprintable'})`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const checkError = new Error('native check failed')
    let interrupts = 0, finished = false
    let resolve!: (status: 'unknown') => void
    let reject!: (error: unknown) => void
    const check = new Promise<'unknown'>((yes, no) => { resolve = yes; reject = no })
    const context = { interrupt() {
      interrupts++
      if (interrupts === 1) throw interruptError
      if (interrupts === 2) throw new Error('later interrupt failure')
      if (checkFails) reject(checkError)
      else resolve('unknown')
    } }
    const result = withDeadline(context, 5, () => check)
    void result.then(() => { finished = true }, () => { finished = true })
    assert.doesNotThrow(() => t.mock.timers.tick(5))
    await Promise.resolve()
    assert.equal(finished, false, 'failure must not release a still-running native check')
    assert.doesNotThrow(() => t.mock.timers.tick(50))
    assert.doesNotThrow(() => t.mock.timers.tick(50))
    await assert.rejects(result, error => {
      if (!checkFails) return error === interruptError
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, checkError)
      assert.deepEqual(error.errors, [checkError, interruptError])
      assert.match(error.message, /native check failed/)
      assert.match(error.message, interruptError === undefined ? /undefined/ :
        interruptError instanceof Error ? /first interrupt failed/ : /unprintable thrown value/)
      assert.doesNotMatch(error.message, /later interrupt failure/)
      return true
    })
    assert.equal(interrupts, 3)
    t.mock.timers.tick(1000)
    assert.equal(interrupts, 3)
    assert.deepEqual(await withDeadline(context, 5, async () => 'sat'), { status: 'sat', interrupted: false })
    t.mock.timers.tick(1000)
    assert.equal(interrupts, 3)
  })
}
