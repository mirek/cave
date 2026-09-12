import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, Record } from '@cavelang/store'

test('annotated export rejects a historical key that disagrees with the claim', () => {
  const store = open()
  try {
    store.ingest('visible IS retained #sensitivity:public\nsecret IS retained #sensitivity:restricted')
    const row = store.currentBeliefs().find(row => row.subject === 'secret')!
    const original = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('historical-wrong-key', row.id)
    const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all())
    for (const current of [false, true]) {
      assert.match(store.exportText({ current, tx: true, maxSensitivity: 'public' }), /visible IS retained/)
      assert.throws(() => store.exportText({ current, tx: true, maxSensitivity: 'restricted' }), error => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(row.id))
        assert.match(error.message, /stored claim key/)
        assert.doesNotMatch(error.message, /secret|historical-wrong-key/)
        assert.ok(error.cause instanceof Error)
        return true
      })
      assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()), before)
    }
    store.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(row.claim_key, row.id)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), original)
  } finally { store.close() }
})

for (const raw of ['historical-atom', '9'.repeat(400)]) test(`export identifies an invalid stored row (${raw.length > 100 ? 'decode' : 'emit'})`, () => {
  const store = open()
  try {
    store.ingest('parent EXISTS\n  WHEN metric IS 42\nother IS retained')
    const row = store.currentBeliefs().find(row => row.subject === 'metric')!
    // Simulate historical data which predates structured-input validation.
    store.db.prepare('UPDATE cave_claim SET value_text = ?, value_num = NULL WHERE id = ?').run(raw, row.id)
    const snapshot = () => JSON.stringify({ claims: store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), edges: store.db.prepare('SELECT * FROM cave_edge').all() })
    const before = snapshot()
    for (const current of [false, true]) for (const tx of [false, true]) {
      assert.throws(() => store.exportText({ current, tx }), error => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(row.id), error.message)
        assert.match(error.message, /export.*claim/)
        assert.ok(error.cause instanceof Error)
        assert.match(error.cause.message, /metric|finite/)
        return true
      })
      assert.equal(snapshot(), before)
    }
    // Repair only the deliberately corrupted test fixture, then verify usability.
    store.db.prepare('UPDATE cave_claim SET value_text = ?, value_num = 42 WHERE id = ?').run('42', row.id)
    assert.match(store.exportText(), /metric/)
  } finally { store.close() }
})

for (const corruption of ['object-and-value', 'object-and-attribute', 'attribute-without-value']) {
  test(`export rejects inconsistent historical payload columns (${corruption})`, () => {
    const store = open()
    try {
      store.ingest('visible IS retained #sensitivity:public\nsecret IS retained #sensitivity:restricted')
      const row = store.currentBeliefs().find(row => row.subject === 'secret')!
      if (corruption === 'object-and-value') {
        store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run('42', row.id)
      } else if (corruption === 'object-and-attribute') {
        store.db.prepare('UPDATE cave_claim SET attribute = ? WHERE id = ?').run('count', row.id)
      } else {
        store.db.prepare('UPDATE cave_claim SET object = NULL, attribute = ? WHERE id = ?').run('count', row.id)
      }
      const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all())
      for (const current of [false, true]) for (const tx of [false, true]) {
        assert.match(store.exportText({ current, tx, maxSensitivity: 'public' }), /visible IS retained/)
        assert.throws(() => store.exportText({ current, tx, maxSensitivity: 'restricted' }), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(row.id))
          assert.match(error.message, /payload/)
          return true
        })
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()), before)
      }
      store.db.prepare('UPDATE cave_claim SET object = ?, attribute = NULL, value_text = NULL WHERE id = ?').run('retained', row.id)
      assert.match(store.exportText({ maxSensitivity: 'restricted' }), /secret IS retained/)
    } finally { store.close() }
  })
}

for (const field of ['subject', 'object', 'context', 'tag'] as const) {
  test(`malformed historical ${field} is diagnosed only when export includes its sensitivity`, () => {
    const store = open()
    try {
      store.ingest('visible IS retained #sensitivity:public\nsecret IS retained #sensitivity:restricted')
      const row = store.currentBeliefs().find(row => row.subject === 'secret')!
      if (field === 'subject' || field === 'object') {
        store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run('broken\nfield', row.id)
      } else if (field === 'context') {
        store.db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(row.id, 'broken\ncontext')
      } else {
        store.db.prepare('INSERT INTO cave_tag (claim_id, key, value) VALUES (?, ?, ?)').run(row.id, 'note', 'broken\nvalue')
      }
      const snapshot = () => JSON.stringify(['cave_claim', 'cave_context', 'cave_tag', 'cave_edge']
        .map(table => store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
      const before = snapshot()
      for (const current of [false, true]) for (const tx of [false, true]) {
        const publicText = store.exportText({ current, tx, maxSensitivity: 'public' })
        assert.match(publicText, /visible IS retained/)
        assert.ok(!publicText.includes(row.id))
        assert.ok(!publicText.includes('broken'))
        assert.throws(() => store.exportText({ current, tx, maxSensitivity: 'restricted' }), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(row.id), error.message)
          assert.ok(error.cause instanceof Error)
          return true
        })
        assert.equal(snapshot(), before)
      }
    } finally { store.close() }
  })
}

for (const invalid of ['', new Uint8Array([0xff])]) test(`annotated export rejects malformed stored provenance (${typeof invalid === 'string' ? 'empty' : 'blob'})`, () => {
  for (const dimension of ['actor', 'source', 'run', 'domain']) {
    const store = open()
    try {
      store.ingest('visible IS retained #sensitivity:public')
      const id = store.ingest('private-subject IS retained #sensitivity:restricted').ids[0]!
      store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, dimension, invalid)
      const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_provenance ORDER BY rowid').all())
      const row = store.currentBeliefs().find(row => row.id === id)!
      assert.throws(() => store.recordOf(row), /malformed.*provenance/)
      for (const current of [false, true]) {
        assert.match(store.exportText({ current, tx: true, maxSensitivity: 'public' }), /visible IS retained/)
        assert.throws(() => store.exportText({ current, tx: true, maxSensitivity: 'restricted' }), error => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes(id))
          assert.match(error.message, /stored provenance/)
          assert.doesNotMatch(error.message, /private-subject/)
          assert.ok(error.cause instanceof Error)
          return true
        })
        assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_provenance ORDER BY rowid').all()), before)
      }
      store.db.prepare('UPDATE cave_provenance SET value = ? WHERE claim_id = ? AND dimension = ?').run('repaired', id, dimension)
      assert.match(store.exportText({ tx: true, maxSensitivity: 'restricted' }), /repaired/)
      const repaired = store.recordOf(row)
      assert.deepEqual(Record.decode(Record.encode(repaired)), repaired)
    } finally { store.close() }
  }
})
