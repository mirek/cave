/** Run alone: unchanged replies should not replay unchanged vocabulary history. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { appendReply, Automation } from '../packages/automate/src/index.ts'

const letters = index => {
  let text = ''
  do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) } while (index > 0)
  return text
}
const parsed = Automation.parse('automation/bench', 'clock EXISTS => "review"')
assert.ok(parsed.ok)
for (const declarations of [100, 1000, 3000]) {
  const store = open()
  try {
    assert.deepEqual(store.ingest(Array.from({ length: declarations }, (_, index) => `CUSTOM-${letters(index)} IS verb`).join('\n')).problems, [])
    assert.equal(appendReply(store, parsed.automation, 'sensor IS ready').appended, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const result = appendReply(store, parsed.automation, 'sensor IS ready')
      samples.push(performance.now() - start)
      assert.deepEqual(result, { appended: 0, problems: [] })
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, declarations, medianMs: samples[2] }))
  } finally { store.close() }
}
