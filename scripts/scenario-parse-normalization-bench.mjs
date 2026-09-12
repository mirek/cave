/** Run alone; timings describe this machine, not a test threshold. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { parse } from '../packages/scenario/src/exact.ts'
for (const digits of [1000, 10000, 100000]) {
  const authored = `0.${'1234567890'.repeat(digits / 10 - 1)}1234567891 ms`
  const expected = { numerator: authored.slice(2, -3), denominator: '1' + '0'.repeat(digits) }
  const samples = []
  for (let i = 0; i < 6; i++) {
    const start = performance.now()
    const result = parse(authored, 'fixture')
    const elapsed = performance.now() - start
    assert.deepEqual(result, { exact: expected, unit: 'ms', approximate: false })
    if (i) samples.push(elapsed)
  }
  samples.sort((a,b) => a-b)
  console.log(JSON.stringify({ node: process.version, digits, medianMs: samples[2] }))
}
