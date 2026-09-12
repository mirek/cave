/** Isolated alias-judge recovery profile; run without concurrent builds/tests. */
import assert from 'node:assert/strict'
import { parseJudgeReply } from '../packages/shape/src/index.ts'
for (const depth of [1000, 2000, 4000, 8000]) {
  const source = '['.repeat(depth) + 'invalid' + ']'.repeat(depth) + '\n[1]'
  const samples = []
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now()
    const result = parseJudgeReply(source, 1)
    samples.push(performance.now() - start)
    assert.deepEqual(result, [0])
  }
  samples.sort((a, b) => a - b)
  console.log(JSON.stringify({ node: process.version, depth, bytes: Buffer.byteLength(source), medianMs: samples[1] }))
}
