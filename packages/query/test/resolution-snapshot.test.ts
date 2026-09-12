import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { match, Pattern, query } from '@cavelang/query'

for (const resolve of [false, true]) {
test(`queries see staged claims without committing their caller transaction (resolve=${resolve})`, () => {
  const store = open()
  try {
    store.ingest('alice CONTAINS bob')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => store.transaction(() => {
      store.ingest('alice CONTAINS carol')
      assert.equal(query(store, 'alice CONTAINS ?person', { resolve }).length, 2)
      throw new Error('caller rollback')
    }), /caller rollback/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'alice CONTAINS ?person', { resolve }).length, 1)
  } finally { store.close() }
})

for (const phase of ['read', 'release', 'both']) {
  test(`query retains ${phase} failure and releases its snapshot (resolve=${resolve})`, t => {
    const store = open()
    const readError = new Error('query read interrupted'), releaseError = new Error('query release interrupted')
    const prepare = store.db.prepare.bind(store.db), exec = store.db.exec.bind(store.db)
    let active = true, releases = 0
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (active && phase !== 'release') throw readError
      return prepare(sql)
    })
    t.mock.method(store.db, 'exec', (sql: string) => {
      exec(sql)
      if (sql === 'RELEASE cave_query_read') {
        releases++
        if (active && phase !== 'read') throw releaseError
      }
    })
    try {
      assert.throws(() => query(store, '?person IS person', { resolve }), error => {
        if (phase !== 'both') return error === (phase === 'read' ? readError : releaseError)
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors[0], readError)
        assert.equal(error.errors[1], releaseError)
        assert.equal(error.cause, readError)
        assert.ok(error.message.includes(readError.message))
        assert.ok(error.message.includes(releaseError.message))
        return true
      })
      assert.equal(releases, 1)
      active = false
      store.db.exec('BEGIN')
      store.db.exec('ROLLBACK')
      store.ingest('alice IS person')
      assert.equal(query(store, '?person IS person', { resolve }).length, 1)
    } finally { active = false; store.close() }
  })
}

}

for (const method of ['query', 'match'] as const) {
  test(`${method} resolves policy and claims from one read snapshot`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-query-resolution-'))
    const writer = open(join(dir, 'knowledge.db'))
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest('source/first HAS precedence: 10\nsource/second HAS precedence: 0\nalice CONTAINS bob @ 90% @src:first\nalice CONTAINS NOT bob @ 80% @src:second')
    const reader = open(join(dir, 'knowledge.db'), { access: 'read-only' })
    const input = 'alice CONTAINS ?person'
    const read = (store: typeof reader) => method === 'query'
      ? query(store, input, { resolve: true }) : match(store, Pattern.parse(input), { resolve: true })
    try {
      const before = read(reader)
      const prepare = reader.db.prepare.bind(reader.db)
      let injected = false
      t.mock.method(reader.db, 'prepare', (sql: string) => {
        if (!injected && sql.includes('SELECT context') && sql.includes("substr(context, 1, 4) = 'src:'")) {
          injected = true
          writer.ingest('source/first HAS precedence: 0\nsource/second HAS precedence: 10\nalice CONTAINS NOT bob @ 95% @src:second\nalice CONTAINS carol @src:first\nalice CONTAINS NOT carol @src:second')
        }
        return prepare(sql)
      })
      assert.deepEqual(read(reader), before)
      assert.equal(injected, true)
      const after = read(reader)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, read(writer))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
