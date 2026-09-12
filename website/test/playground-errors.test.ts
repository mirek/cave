import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseCleanupError, describeWorkerError, SqliteInitializationError } from '../src/playground/errors.ts'

test('worker failure descriptions remain cloneable for unreadable thrown values', () => {
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message getter failed') } })
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  for (const [error, fatal] of [[Object.create(null), false], [unreadable, false], [revoked.proxy, true]] as const) {
    const response = describeWorkerError(error)
    assert.deepEqual(structuredClone(response), { error: '[unprintable thrown value]', fatal })
  }
  assert.deepEqual(describeWorkerError(new Error('query failed')), { error: 'query failed', fatal: false })
  assert.deepEqual(describeWorkerError('query failed'), { error: 'query failed', fatal: false })
})

test('worker failure descriptions retain fatal initialization and cleanup classification', () => {
  for (const error of [new SqliteInitializationError('download failed'), new DatabaseCleanupError(Object.create(null))]) {
    const response = describeWorkerError(error)
    assert.deepEqual(structuredClone(response), { error: error.message, fatal: true })
  }
})
