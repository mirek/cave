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

test('msOf() recovers the encoded timestamp (spec §20.2 staleness)', () => {
  const rand = new Uint8Array(8)
  assert.equal(Uuidv7.msOf(Uuidv7.at(1_750_000_000_000, 0, rand)), 1_750_000_000_000)
  assert.equal(Uuidv7.msOf(Uuidv7.at(0, 0, rand)), 0)
  assert.equal(Uuidv7.msOf(Uuidv7.at(0xffff_ffff_ffff, 0, rand)), 0xffff_ffff_ffff)
})

test('observe() is the receive rule: next() outsorts every observed id (spec §28.2)', () => {
  const rand = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])
  // Far ahead of both the wall clock and this file's earlier frozen mints.
  const merged = Uuidv7.at(3_000_000_000_000, 0x0a0, rand)
  Uuidv7.observe(merged)
  const minted = Uuidv7.next()
  assert.ok(minted > merged, `${minted} > ${merged}`)
  assert.equal(Uuidv7.msOf(minted), 3_000_000_000_000, 'same millisecond, sequence bumped')

  // Observing the past never lowers the floor.
  Uuidv7.observe(Uuidv7.at(1_000, 0xfff, rand))
  assert.ok(Uuidv7.next() > minted)

  // Sequence exhaustion at the observed millisecond rolls forward.
  Uuidv7.observe(Uuidv7.at(3_000_000_000_001, 0xfff, rand))
  const rolled = Uuidv7.next(() => 0)
  assert.equal(Uuidv7.msOf(rolled), 3_000_000_000_002)
})

test('observe() ignores ids that are not UUIDv7', () => {
  const before = Uuidv7.next()
  Uuidv7.observe('ffffffff-ffff-ffff-ffff-ffffffffffff') // v f, not v7
  Uuidv7.observe('not an id')
  const after = Uuidv7.next()
  assert.ok(after > before)
  assert.ok(Uuidv7.msOf(after) < 3_100_000_000_000, 'the malformed maxima left no trace')
})

test('withStatePreserved rolls back observations and mints', () => {
  const before = Uuidv7.next()
  const future = Uuidv7.at(
    Uuidv7.msOf(before) + 1000,
    0x800,
    new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])
  )
  Uuidv7.withStatePreserved(() => {
    Uuidv7.observe(future)
    assert.ok(Uuidv7.next() > future)
  })
  assert.ok(Uuidv7.next(() => 0) < future, 'speculative clock changes left no trace')
})
