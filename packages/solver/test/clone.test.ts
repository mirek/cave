import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clone } from '../src/clone.ts'

test('portable copies preserve sharing, cycles, sparse arrays, and ordinary data keys', () => {
  const shared = { value: 'before' }
  const input = { first: shared, second: shared, array: new Array(2), record: JSON.parse('{"__proto__":{"value":1}}'), self: undefined as unknown }
  input.self = input
  input.array[1] = shared
  Object.defineProperty(input, 'hidden', { get() { throw new Error('non-enumerable accessor must be ignored') } })
  Object.defineProperty(input, Symbol('ignored'), { enumerable: true, get() { throw new Error('symbol accessor must be ignored') } })
  Object.defineProperty(input.array, 'label', { enumerable: true, value: 'named array data' })
  const copy = clone(input)
  assert.deepEqual(copy, structuredClone(input))
  assert.equal(copy.first, copy.second)
  assert.equal(copy.array[1], copy.first)
  assert.equal(copy.self, copy)
  assert.equal(Object.hasOwn(copy.array, 0), false)
  assert.equal(Object.getPrototypeOf(copy.record), Object.prototype)
  shared.value = 'after'
  assert.equal(copy.first.value, 'before')
})

test('nonportable containers retain native clone graph behavior and errors', () => {
  const shared = { value: 1 }
  const input = { shared, map: new Map([['shared', shared]]) }
  const copy = clone(input)
  assert.equal(copy.map.get('shared'), copy.shared)
  assert.notEqual(copy.shared, shared)
  assert.throws(() => clone({ callback: () => undefined }), { name: 'DataCloneError' })
})

test('native fallback reads accessor properties only once', () => {
  let reads = 0
  const input = { get value() { return ++reads }, map: new Map() }
  assert.equal(clone(input).value, 1)
  assert.equal(reads, 1)
})

test('accessor evaluation order matches native cloning', () => {
  const fixture = () => {
    let state = 0
    return { nested: { get first() { return ++state } }, get second() { return ++state } }
  }
  assert.deepEqual(clone(fixture()), structuredClone(fixture()))
})

test('proxies retain native rejection without invoking their traps', () => {
  const input = new Proxy({}, { ownKeys() { throw new Error('proxy trap invoked') } })
  assert.throws(() => clone({ input }), { name: 'DataCloneError' })
})

test('accessor mutations retain native property snapshots and shared graph identity', () => {
  const fixture = () => {
    const shared = { value: 'before' }
    const input = {
      get first() {
        shared.value = 'after'
        delete input.removed
        Object.defineProperty(input, 'added', { enumerable: true, value: 'late' })
        return shared
      },
      removed: 'original' as string | undefined,
      later: shared,
      map: new Map([['shared', shared]]),
    }
    return input
  }
  const copy = clone(fixture())
  assert.deepEqual(copy, structuredClone(fixture()))
  assert.equal(copy.first.value, 'after')
  assert.equal(copy.first, copy.later)
  assert.equal(copy.map.get('shared'), copy.first)
  assert.equal(Object.hasOwn(copy, 'removed'), false)
  assert.equal(Object.hasOwn(copy, 'added'), false)
})

test('failed accessor capture preserves thrown values and retries without cached partial copies', () => {
  for (const failure of [new Error('capture failed'), Object.create(null)]) {
    let reads = 0
    let broken = true
    const shared = { value: 'before' }
    const input = {
      first: shared,
      get later() {
        reads++
        shared.value = 'changed by getter'
        if (broken) throw failure
        return shared
      },
    }
    assert.throws(() => clone(input), error => error === failure)
    assert.equal(reads, 1)
    assert.equal(shared.value, 'changed by getter')
    broken = false
    const copy = clone(input)
    assert.equal(reads, 2)
    assert.equal(copy.first, copy.later)
    assert.equal(copy.first.value, 'changed by getter')
    shared.value = 'changed after capture'
    assert.equal(copy.first.value, 'changed by getter')
  }
})

test('deep native fallback failures permit a fresh portable retry', () => {
  let reads = 0
  const leaf = { value: 'before' }
  let nested: { child?: unknown, value?: string } = leaf
  for (let depth = 0; depth < 20000; depth++) nested = { child: nested }
  const input = { get mode() { reads++; return 'captured' }, nested }
  assert.throws(() => clone(input), { name: 'RangeError' })
  assert.equal(reads, 1)
  assert.equal(leaf.value, 'before')
  Object.defineProperty(input, 'mode', { value: 'captured', enumerable: true, configurable: true })
  const copy = clone(input)
  assert.equal(reads, 1)
  assert.equal(copy.mode, 'captured')
  let cursor = copy.nested
  for (let depth = 0; depth < 20000; depth++) {
    assert.notEqual(cursor, undefined)
    cursor = cursor.child as typeof cursor
  }
  assert.notEqual(cursor, leaf)
  assert.equal(cursor.value, 'before')
  leaf.value = 'after'
  assert.equal(cursor.value, 'before')
})
