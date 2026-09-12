/** Run alone: registry history cost in idle governed operations. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { declareRules, derive } from '../packages/rules/src/index.ts'
import { declareActions } from '../packages/act/src/index.ts'
import { declareAutomations, settle, settled } from '../packages/automate/src/index.ts'
const letters = index => {
  let text = ''
  do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) } while (index > 0)
  return text
}
const rule = 'missing IS source => output IS derived'
const action = 'action/ready HAS action: `=> sensor IS ready`'
const automation = 'automation/review HAS automation: `clock EXISTS => "review"`'
for (const declarations of [100, 1000, 3000]) {
  const store = open()
  try {
    assert.deepEqual(store.ingest(Array.from({ length: declarations }, (_, index) => `CUSTOM-${letters(index)} IS verb`).join('\n')).problems, [])
    declareRules(store, rule)
    declareActions(store, action)
    declareAutomations(store, automation)
    const operations = [
      ['derive', () => derive(store), result => assert.equal(result.appended, 0)],
      ['settle', () => settle(store), result => assert.ok(settled(result))],
      ['declare-rules', () => declareRules(store, rule), result => assert.equal(result.unchanged, 1)],
      ['declare-actions', () => declareActions(store, action), result => assert.equal(result.unchanged, 1)],
      ['declare-automations', () => declareAutomations(store, automation), result => assert.equal(result.unchanged, 1)],
    ]
    for (const [operation, run, check] of operations) {
      check(await run())
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const samples = []
      for (let sample = 0; sample < 5; sample++) {
        const start = performance.now()
        const result = await run()
        samples.push(performance.now() - start)
        check(result)
      }
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      samples.sort((a, b) => a - b)
      console.log(JSON.stringify({ node: process.version, declarations, operation, medianMs: samples[2] }))
    }
  } finally { store.close() }
}
