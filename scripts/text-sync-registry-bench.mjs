/** Run alone: target vocabulary history cost in repeated small text syncs. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { syncText } from '../packages/sync/src/index.ts'
const letters = index => {
  let text = ''
  do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) } while (index > 0)
  return text
}
for (const declarations of [100, 1000, 3000]) {
  const source = open(), target = open()
  try {
    assert.deepEqual(target.ingest(Array.from({ length: declarations }, (_, index) => `CUSTOM-${letters(index)} IS verb`).join('\n')).problems, [])
    source.ingest('sensor IS ready')
    const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(syncText(target, text, { record: false }).merged, 1)
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const result = syncText(target, text, { record: false })
      samples.push(performance.now() - start)
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 0)
      assert.equal(result.skipped, 1)
    }
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, declarations, medianMs: samples[2] }))
  } finally { source.close(); target.close() }
}
