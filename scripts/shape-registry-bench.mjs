/** Run alone: relation-shape evaluation across increasing instance counts. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { evaluate } from '../packages/shape/src/index.ts'
for (const instances of [100, 1000, 5000]) {
  const store = open()
  try {
    assert.deepEqual(store.ingest('HOSTS IS verb\nHOSTS REVERSE HOSTED-BY\nservice EXPECTS HOSTED-BY\n' +
      Array.from({ length: instances }, (_, i) => `service/${i} IS service\nhost HOSTS service/${i}`).join('\n')).problems, [])
    evaluate(store)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now()
      const result = evaluate(store)
      samples.push(performance.now() - start)
      assert.equal(result.checks, instances)
      assert.equal(result.instances, instances)
      assert.deepEqual(result.violations, [])
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, instances, medianMs: samples[2] }))
  } finally { store.close() }
}
