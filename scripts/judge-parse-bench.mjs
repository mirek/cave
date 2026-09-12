/** Isolated malformed-judge parsing profile; run without concurrent builds/tests. */
import assert from 'node:assert/strict'
import { parsePairs } from '../packages/eval/src/judge.ts'

for (const depth of [1000, 2000, 4000, 8000]) {
  const source = '['.repeat(depth) + 'invalid' + ']'.repeat(depth) + '\n[[1,1]]'
  const samples = []
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now()
    const result = parsePairs(source, 1, 1)
    samples.push(performance.now() - start)
    assert.deepEqual(result, [[0, 0]], 'malformed nesting must not hide the final answer')
  }
  samples.sort((left, right) => left - right)
  console.log(JSON.stringify({ node: process.version, depth, bytes: Buffer.byteLength(source), medianMs: samples[1] }))
}
