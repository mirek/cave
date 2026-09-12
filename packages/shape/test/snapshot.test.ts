import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { check, evaluate, expectations, generateClient, judgePrompt, suggestAliases } from '@cavelang/shape'

const readers: readonly [string, (store: Store) => unknown][] = [
  ['cave_shape_declarations', expectations],
  ['cave_shape_evaluation', evaluate],
  ['cave_health_read', store => check(store, { now: () => 0 })],
  ['cave_client_schema', generateClient],
  ['cave_alias_discovery', suggestAliases],
  ['cave_alias_judge', store => judgePrompt(store, suggestAliases(store))],
]

for (const [name, read] of readers) test(`${name} preserves read and release failures`, t => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner\napi IS service\nmaria HAS city: Bern\ngrandma-maria HAS city: Bern')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const expected = read(store)
    const failure = new Error('snapshot read failed')
    const releaseFailure = new Error('snapshot release failed')
    const exec = store.db.exec.bind(store.db), prepare = store.db.prepare.bind(store.db)
    let active = false, releases = 0
    t.mock.method(store.db, 'exec', (sql: string) => {
      exec(sql)
      if (sql === `SAVEPOINT ${name}`) active = true
      if (sql === `RELEASE ${name}`) { active = false; releases++; throw releaseFailure }
    })
    t.mock.method(store.db, 'prepare', (sql: string) => { if (active) throw failure; return prepare(sql) })
    assert.throws(() => read(store), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, failure)
      assert.deepEqual(error.errors, [failure, releaseFailure])
      return true
    })
    assert.equal(releases, 1)
    t.mock.restoreAll()
    assert.deepEqual(read(store), expected)
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('temporary IS evidence')
      read(store)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { t.mock.restoreAll(); store.close() }
})
