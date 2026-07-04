import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Uuidv7 } from '@cavelang/core'

test('well-formed UUIDv7: version and variant bits', () => {
  const id = Uuidv7.next()
  assert.ok(Uuidv7.is(id), id)
})

test('at() is pure and deterministic', () => {
  const rand = new Uint8Array([0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
  const id = Uuidv7.at(0x0123456789ab, 0x1a2, rand)
  assert.equal(id, '01234567-89ab-71a2-bf01-020304050607')
  assert.ok(Uuidv7.is(id))
})

test('at() validates ranges', () => {
  const rand = new Uint8Array(8)
  assert.throws(() => Uuidv7.at(-1, 0, rand))
  assert.throws(() => Uuidv7.at(0, 0x1000, rand))
  assert.throws(() => Uuidv7.at(0, 0, new Uint8Array(4)))
})

test('timestamps order lexicographically', () => {
  const rand = new Uint8Array(8)
  const early = Uuidv7.at(1000, 0, rand)
  const late = Uuidv7.at(1001, 0, rand)
  assert.ok(early < late)
})

test('next() is strictly monotonic across many same-millisecond calls', () => {
  const frozen = () => 1_750_000_000_000
  const ids = Array.from({ length: 5000 }, () => Uuidv7.next(frozen))
  for (let i = 1; i < ids.length; i++) {
    assert.ok(ids[i - 1]! < ids[i]!, `${ids[i - 1]} < ${ids[i]}`)
  }
  assert.equal(new Set(ids).size, ids.length)
})

test('next() survives clock going backwards', () => {
  const before = Uuidv7.next(() => 2_000_000_000_000)
  const after = Uuidv7.next(() => 1_000_000_000_000)
  assert.ok(before < after)
})
