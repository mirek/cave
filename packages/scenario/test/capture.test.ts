import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { captureDefinition } from '../src/capture.ts'
import type { Definition } from '../src/model.ts'

test('definition capture preserves shared references, cycles, sparse arrays and getter order', () => {
  const reads: string[] = []
  const shared = { get value() { reads.push('nested'); return 1 } }
  const supplied: Record<string, unknown> = {
    get first() { reads.push('first'); return shared },
    get second() { reads.push('second'); return shared },
    sparse: [shared, , shared]
  }
  supplied.self = supplied
  Object.defineProperty(supplied, '__proto__', { value: shared, enumerable: true })
  const captured = captureDefinition(supplied as unknown as Definition) as unknown as Record<string, unknown>
  assert.deepEqual(reads, ['first', 'second', 'nested'])
  assert.notEqual(captured, supplied)
  assert.notEqual(captured.first, shared)
  assert.equal(captured.first, captured.second)
  assert.equal(captured.self, captured)
  assert.equal(Object.getPrototypeOf(captured), null)
  assert.equal(captured.__proto__, captured.first)
  const sparse = captured.sparse as unknown[]
  assert.equal(sparse.length, 3)
  assert.equal(Object.hasOwn(sparse, 1), false)
  assert.equal(sparse[0], captured.first)
  assert.equal(sparse[2], captured.first)
  assert.equal(Object.isFrozen(supplied), false)
})
