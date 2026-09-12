import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseCleanupError, replaceDatabase } from '../src/playground/replace-database.ts'

test('unprintable replacement failures retain fatal cleanup classification and original errors', () => {
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message getter failed') } })
  for (const failure of [Object.create(null), unreadable]) {
    const cleanupError = new Error('replacement close interrupted')
    let closes = 0
    assert.throws(() => replaceDatabase(undefined, { close() { closes++; throw cleanupError } }, () => {
      throw failure
    }), error => {
      assert.ok(error instanceof DatabaseCleanupError)
      assert.equal(error.cause, failure)
      assert.equal(error.errors[0], failure)
      assert.equal(error.errors[1], cleanupError)
      assert.ok(error.message.includes('[unprintable thrown value]'))
      assert.ok(error.message.includes(cleanupError.message))
      return true
    })
    assert.equal(closes, 1)
  }
})

test('database replacement publishes only after loading and closing the previous database', () => {
  const events: string[] = []
  const result = { claims: 1 }
  assert.equal(replaceDatabase({ close: () => { events.push('old closed') } },
    { close: () => { events.push('replacement closed') } }, () => { events.push('loaded'); return result }), result)
  assert.deepEqual(events, ['loaded', 'old closed'])
})

for (const phase of ['load', 'old close']) for (const cleanupFails of [false, true]) {
  test(`database replacement handles ${phase} failure (cleanup failure=${cleanupFails})`, () => {
    const failure = new Error(`${phase} interrupted`), cleanupError = new Error('replacement close interrupted')
    let oldCloses = 0, replacementCloses = 0
    const current = { close: () => { oldCloses++; throw failure } }
    const replacement = { close: () => { replacementCloses++; if (cleanupFails) throw cleanupError } }
    assert.throws(() => replaceDatabase(current, replacement, () => {
      if (phase === 'load') throw failure
      return 'loaded'
    }), error => {
      if (phase === 'load' && !cleanupFails) return error === failure
      assert.ok(error instanceof DatabaseCleanupError)
      assert.deepEqual(error.errors, cleanupFails ? [failure, cleanupError] : [failure])
      assert.equal(error.cause, failure)
      assert.ok(error.message.includes(failure.message))
      if (cleanupFails) assert.ok(error.message.includes(cleanupError.message))
      return true
    })
    assert.equal(oldCloses, phase === 'load' ? 0 : 1)
    assert.equal(replacementCloses, 1)
  })
}
