import assert from 'node:assert/strict'
import { gcd } from '../packages/solver/src/integer-gcd.ts'

const euclid = (a, b) => {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}
let seed = 123456789n
const random = bits => {
  let value = 0n
  for (let i = 0; i < bits; i += 32) {
    seed = (1664525n * seed + 1013904223n) & 0xffffffffn
    value = (value << 32n) | seed
  }
  return value
}
const measurements = []
for (const bits of [32, 128, 1024, 8192]) for (const kind of ['coprime', 'shared', 'unit', 'equal']) {
  const pairs = Array.from({ length: 100 }, () => {
    const a = random(bits), b = random(bits), common = euclid(a, b)
    if (kind === 'unit') return [a, 1n]
    if (kind === 'equal') return [a, a]
    const factor = kind === 'shared' ? random(128) : 1n
    return [a / common * factor, b / common * factor]
  })
  for (const [a, b] of pairs) assert.equal(gcd(a, b), euclid(a, b))
  const row = { bits, kind, pairs: pairs.length }
  for (const [name, fn] of [['euclid', euclid], ['batched', gcd]]) {
    const samples = []
    for (let sample = 0; sample < 7; sample++) {
      const start = performance.now()
      for (const [a, b] of pairs) fn(a, b)
      samples.push(performance.now() - start)
    }
    row[name + 'MedianMs'] = samples.sort((a, b) => a - b)[3]
  }
  measurements.push(row)
}
console.log(JSON.stringify({ format: 'cave.exact-gcd-strategies', version: 1, node: process.version, measurements }, null, 2))
