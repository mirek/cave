import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { agentTimeoutMs } from '../src/timeout.ts'

test('ingest timeout validation rejects nonnumbers without coercing them', () => {
  let coercions = 0
  const coercible = { [Symbol.toPrimitive]() { coercions++; return 1 } }
  const throwing = { [Symbol.toPrimitive]() { coercions++; throw new Error('unexpected coercion') } }
  for (const value of ['1', true, new Number(1), [1], 1n, Symbol('timeout'), coercible, throwing, null, undefined]) {
    assert.throws(() => agentTimeoutMs(value as unknown as number), error => {
      assert.ok(error instanceof TypeError)
      assert.match(error.message, /timeout.*must resolve to whole milliseconds/)
      return true
    })
  }
  assert.equal(coercions, 0)
  assert.doesNotThrow(() => agentTimeoutMs(1.001))
})
