import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareRules, derive, type DeriveOptions } from '@cavelang/rules'

for (const [field, values, message] of [
  ...['full', 'dryRun', 'aliases'].map(field => [field, ['true', 'false', null, 0, 1, [], {}], `${field} must be a boolean`] as const),
  ['minConf', [null, '0.5', false], 'minConf must be finite and in 0..1'],
  ['maxPasses', [null, '20', false], 'maxPasses must be a positive safe integer']
] as const) {
  test(`derive rejects malformed ${field} before conclusions or bookkeeping`, () => {
    const store = open()
    try {
      declareRules(store, '?x IS service => ?x IS monitored')
      store.ingest('api IS service')
      const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const before = history()
      const edges = store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all()
      for (const value of values) {
        assert.throws(() => derive(store, { [field]: value } as DeriveOptions), new RegExp(message))
        assert.equal(history(), before)
        assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), edges)
      }
      derive(store, { dryRun: true })
      assert.equal(history(), before)
      derive(store)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.object === 'monitored'))
      assert.notEqual(history(), before)
    } finally { store.close() }
  })
}
