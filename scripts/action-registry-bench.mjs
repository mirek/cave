/** Run alone: unchanged actions should reuse unchanged vocabulary. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { act, declareActions } from '../packages/act/src/index.ts'

const letters = index => {
  let text = ''
  do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) } while (index > 0)
  return text
}
for (const declarations of [100, 1000, 3000]) {
  const store = open()
  try {
    assert.deepEqual(store.ingest(Array.from({ length: declarations }, (_, index) => `CUSTOM-${letters(index)} IS verb`).join('\n')).problems, [])
    assert.equal(declareActions(store, 'action/ready HAS action: `=> sensor IS ready`').declared, 1)
    const initial = act(store, 'ready')
    assert.ok(initial.ok && initial.appended === 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const result = act(store, 'ready')
      samples.push(performance.now() - start)
      assert.ok(result.ok && result.unchanged === 1 && result.appended === 0)
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, declarations, medianMs: samples[2] }))
  } finally { store.close() }
}
