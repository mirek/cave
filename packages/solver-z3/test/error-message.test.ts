import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { errorMessage } from '../src/error-message.ts'

test('diagnostics survive hostile thrown values and always produce text', () => {
  const proxy = Proxy.revocable({}, {})
  proxy.revoke()
  const brokenMessage = Object.defineProperty(new Error(), 'message', { get() { throw new Error('hidden') } })
  for (const value of [proxy.proxy, brokenMessage, { toString() { throw new Error('hidden') } }]) {
    assert.equal(errorMessage(value), '[unprintable thrown value]')
  }
  assert.equal(errorMessage(new Error('original failure')), 'original failure')
  assert.equal(errorMessage(Object.defineProperty(new Error(), 'message', { value: 17 })), '17')
  assert.equal(errorMessage(null), 'null')
})
