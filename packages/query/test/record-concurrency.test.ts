import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { queryRecords } from '@cavelang/query'

for (const support of [false, true]) {
  test(`record projection retains selected rows across peer appends (support=${support})`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-query-record-concurrency-'))
    const writer = open(join(dir, 'knowledge.db'))
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest(support
      ? 'a EXTENDS b @src:first #reviewed\nb EXTENDS c @src:second'
      : 'api HAS status: ready @src:manual #reviewed')
    const reader = open(join(dir, 'knowledge.db'), { access: 'read-only' })
    const input = support ? 'a EXTENDS+ ?ancestor' : 'api HAS status: ?status'
    const read = (store: typeof reader) => queryRecords(store, input, { support })
    try {
      const before = read(reader)
      assert.equal(before.length, support ? 2 : 1)
      const recordOf = reader.recordOf.bind(reader)
      let injected = false
      t.mock.method(reader, 'recordOf', (row: Parameters<typeof recordOf>[0]) => {
        if (!injected) {
          injected = true
          writer.ingest(support ? 'a EXTENDS d @src:third' : 'api HAS status: paused @src:manual #reviewed')
        }
        return recordOf(row)
      })
      assert.deepEqual(read(reader), before)
      assert.equal(injected, true)
      const after = read(reader)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, read(writer))
      assert.deepEqual(after.map(result => Object.values(result.bindings)[0]), support ? ['b', 'c', 'd'] : ['paused'])
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const support of [false, true]) {
  test(`record projection retains one snapshot across peer metadata changes (support=${support})`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-query-record-metadata-'))
    const writer = open(join(dir, 'knowledge.db'))
    writer.db.exec('PRAGMA journal_mode = WAL')
    writer.ingest(support
      ? 'a EXTENDS b @src:first #phase:before\nb EXTENDS c @src:second #phase:before'
      : 'api HAS status: ready @src:manual #phase:before')
    const reader = open(join(dir, 'knowledge.db'), { access: 'read-only' })
    const input = support ? 'a EXTENDS+ ?ancestor' : 'api HAS status: ?status'
    const read = (store: typeof reader) => queryRecords(store, input, { support })
    try {
      const before = read(reader)
      assert.equal(before.length, support ? 2 : 1)
      const recordOf = reader.recordOf.bind(reader)
      let injected = false
      t.mock.method(reader, 'recordOf', (row: Parameters<typeof recordOf>[0]) => {
        if (!injected) {
          injected = true
          writer.db.exec("BEGIN; UPDATE cave_tag SET value = 'after' WHERE key = 'phase'; UPDATE cave_provenance SET value = 'updated-source' WHERE dimension = 'source'; COMMIT")
        }
        return recordOf(row)
      })
      assert.deepEqual(read(reader), before)
      assert.equal(injected, true)
      const after = read(reader)
      assert.notDeepEqual(after, before)
      assert.deepEqual(after, read(writer))
    } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const cleanupFails of [false, true]) {
  test(`record projection failure preserves caller ownership and retry (cleanup=${cleanupFails})`, t => {
    const store = open()
    const failure = Object.create(null)
    const cleanup = new Error('record snapshot release failed')
    const rollback = new Error('rollback caller transaction')
    try {
      assert.throws(() => store.transaction(() => {
        store.ingest('staged IS service')
        const before = queryRecords(store, '?x IS service')
        assert.equal(before.length, 1)
        let failed = false, releases = 0
        const projection = t.mock.method(store, 'recordOf', () => { failed = true; throw failure })
        const exec = store.db.exec.bind(store.db)
        const release = t.mock.method(store.db, 'exec', (sql: string) => {
          exec(sql)
          if (failed && sql === 'RELEASE cave_query_read') {
            releases++
            if (cleanupFails) throw cleanup
          }
        })
        try {
          assert.throws(() => queryRecords(store, '?x IS service'), error => {
            if (!cleanupFails) return error === failure
            assert.ok(error instanceof AggregateError)
            assert.equal(error.cause, failure)
            assert.deepEqual(error.errors, [failure, cleanup])
            assert.match(error.message, /unprintable thrown value/)
            assert.match(error.message, /record snapshot release failed/)
            return true
          })
          assert.equal(releases, 1)
        } finally { projection.mock.restore(); release.mock.restore() }
        assert.deepEqual(queryRecords(store, '?x IS service'), before)
        throw rollback
      }), error => error === rollback)
      assert.deepEqual(queryRecords(store, '?x IS service'), [])
      store.ingest('retry IS service')
      assert.equal(queryRecords(store, '?x IS service').length, 1)
    } finally { store.close() }
  })
}

test('query records capture limit and historical boundary before snapshot callbacks', t => {
  const store = open()
  try {
    const boundary = store.ingest('first IS service').ids[0]!
    store.ingest('second IS service')
    let limit = 1, asOf: string | undefined = boundary
    let limitReads = 0, boundaryReads = 0
    const options = {
      get limit() { limitReads++; return limit },
      get asOf() { boundaryReads++; return asOf }
    }
    const exec = store.db.exec.bind(store.db)
    let changed = false
    const mocked = t.mock.method(store.db, 'exec', (sql: string) => {
      if (!changed && sql.startsWith('SAVEPOINT')) {
        changed = true
        limit = 2
        asOf = undefined
      }
      exec(sql)
    })
    const records = queryRecords(store, '?x IS service', options)
    mocked.mock.restore()
    assert.equal(changed, true)
    assert.equal(limitReads, 1)
    assert.equal(boundaryReads, 1)
    assert.deepEqual(records.map(record => record.bindings.x), ['first'])
    assert.deepEqual(queryRecords(store, '?x IS service', options).map(record => record.bindings.x), ['first', 'second'])
    assert.equal(limitReads, 2)
    assert.equal(boundaryReads, 2)
  } finally { store.close() }
})

for (const support of [false, true]) test(`malformed stored provenance preserves query snapshot and caller ownership (support=${support})`, () => {
  const store = open()
  const rollback = new Error('rollback staged evidence')
  const input = support ? 'a EXTENDS+ c' : '?x IS service'
  const read = () => queryRecords(store, input, { support })
  try {
    assert.throws(() => store.transaction(() => {
      store.ingest(support ? 'a EXTENDS b\nb EXTENDS c' : 'a IS service')
      const before = read()
      assert.equal(before.length, 1)
      const id = store.currentBeliefs()[0]!.id
      store.db.prepare("INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, 'source', '')").run(id)
      const malformed = store.db.prepare('SELECT * FROM cave_provenance').all()
      assert.throws(read, /malformed.*provenance/)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_provenance').all(), malformed)
      store.db.prepare("DELETE FROM cave_provenance WHERE claim_id = ? AND value = ''").run(id)
      assert.deepEqual(read(), before)
      throw rollback
    }), error => error === rollback)
    assert.deepEqual(read(), [])
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_provenance').all(), [])
    store.ingest(support ? 'a EXTENDS c' : 'retry IS service')
    assert.equal(read().length, 1)
  } finally { store.close() }
})
