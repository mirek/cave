import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareRules } from '@cavelang/rules'
import { declareAutomations, settle, watchCycle, type SettleOptions } from '@cavelang/automate'

for (const [field, values, message] of [
  ...['derive', 'check', 'aliases'].map(field => [field, ['true', 'false', null, 0, 1, [], {}], `${field} must be a boolean`] as const),
  ['maxPasses', [null, '20', false], 'maxPasses must be a positive safe integer'],
  ['hookTimeoutSeconds', [null, '1', false, 1n, Symbol('timeout')], 'hookTimeoutSeconds must resolve to whole milliseconds']
] as const) {
  test(`settle rejects malformed ${field} before durable work`, async () => {
    const store = open()
    try {
      declareRules(store, '?x IS service => ?x IS monitored')
      store.ingest('api IS service')
      const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = history()
      for (const value of values) {
        await assert.rejects(settle(store, { [field]: value } as SettleOptions), new RegExp(message))
        assert.equal(history(), before)
      }
      await settle(store, { derive: false })
      assert.equal(history(), before)
      await settle(store)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'monitored'))
    } finally { store.close() }
  })
}

test('settle rejects coercible timeout objects without invoking their conversion', async () => {
  const store = open()
  let coercions = 0
  try {
    const hookTimeoutSeconds = { [Symbol.toPrimitive]() { coercions++; throw new Error('unexpected conversion') } }
    await assert.rejects(settle(store, { hookTimeoutSeconds: hookTimeoutSeconds as unknown as number }),
      /hookTimeoutSeconds must resolve to whole milliseconds/)
    assert.equal(coercions, 0)
  } finally { store.close() }
})

test('watchCycle rejects malformed configuration before reports and completion, then recovers', async () => {
  const store = open()
  let completions = 0, reports = 0
  const complete = async () => { completions++; return 'api IS reviewed' }
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS service => "Review ?x"`')
    store.ingest('api IS service')
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    for (const [field, values] of [
      ...['derive', 'check', 'aliases'].map(field => [field, ['true', 'false', null, 0, 1, [], {}]] as const),
      ['maxPasses', [null, '20', false]],
      ['hookTimeoutSeconds', [null, '1', false, 1n, Symbol('timeout')]]
    ] as const) {
      for (const value of values) {
        await assert.rejects(watchCycle(store, { [field]: value, complete } as SettleOptions,
          () => { reports++ }), new RegExp(`${field} must`))
        assert.equal(history(), before)
        assert.equal(completions, 0)
        assert.equal(reports, 0)
      }
    }
    await watchCycle(store, { complete }, () => { reports++ })
    assert.equal(completions, 1)
    assert.ok(reports > 0)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'reviewed'))
    const committed = history()
    await watchCycle(store, { complete }, () => {})
    assert.equal(completions, 1)
    assert.equal(history(), committed)
  } finally { store.close() }
})
