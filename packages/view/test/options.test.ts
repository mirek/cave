import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { entity, history, lineage, overview, report, search, topic, topics } from '@cavelang/view'
import type { Options } from '@cavelang/view'

for (const name of ['entity', 'history', 'lineage', 'overview', 'report', 'search', 'topic', 'topics'] as const) {
  test(`${name} rejects invalid sensitivity ceilings before database work`, () => {
    const store = open()
    const id = store.ingest('api IS service #sensitivity:public').ids[0]!
    const key = store.currentBeliefs()[0]!.claim_key
    const invoke = (options: Options) => {
      switch (name) {
        case 'entity': return entity(store, 'api', options)
        case 'history': return history(store, key, options)
        case 'lineage': return lineage(store, id, options)
        case 'overview': return overview(store, options)
        case 'report': return report(store, '`cave-q: ?x IS service`', options)
        case 'search': return search(store, 'service', options)
        case 'topic': return topic(store, 'platform', options)
        case 'topics': return topics(store, options)
      }
    }
    try {
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.deepEqual(invoke({}), invoke({ maxSensitivity: 'internal' }))
      invoke({ maxSensitivity: 'public' })
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
    for (const value of [null, '', 'unknown', 'PUBLIC', false, 0, [], {}]) {
      assert.throws(() => invoke({ maxSensitivity: value as Options['maxSensitivity'] }), /maxSensitivity must be one of:/)
    }
  })
}
