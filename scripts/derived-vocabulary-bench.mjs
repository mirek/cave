/** Run alone: deriving one inverse with unrelated vocabulary already present. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { query } from '../packages/query/src/index.ts'
import { declareRules, derive } from '../packages/rules/src/index.ts'
const letters = index => {
  let text = ''
  do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) } while (index > 0)
  return text
}
for (const declarations of [100, 1000, 3000]) {
  const samples = []
  for (let sample = 0; sample < 5; sample++) {
    const store = open()
    try {
      store.ingest(Array.from({ length: declarations }, (_, index) => `CUSTOM-${letters(index)} IS verb`).join('\n'))
      store.ingest('HOSTS IS verb\nHOSTED-BY IS verb\nhost HOSTS service\ntrigger EXISTS')
      assert.equal(declareRules(store, 'trigger EXISTS => HOSTS REVERSE HOSTED-BY').declared, 1)
      const start = performance.now()
      const result = derive(store)
      samples.push(performance.now() - start)
      assert.ok(result.complete && result.appended === 1)
      assert.equal(query(store, 'service HOSTED-BY host').length, 1)
      assert.equal(derive(store).appended, 0)
    } finally { store.close() }
  }
  samples.sort((a, b) => a - b)
  console.log(JSON.stringify({ node: process.version, declarations, medianMs: samples[2] }))
}
