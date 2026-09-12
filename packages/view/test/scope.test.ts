import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { openWith } from '@cavelang/store/adapter'
import type { SqliteDatabase } from '@cavelang/store/adapter'
import { Registry } from '@cavelang/canonical'
import { entity, overview, search, topics } from '@cavelang/view'
import {
  clearScopedStoreCache,
  scopedStoreCacheStats,
  withScopedStore
} from '../src/scope.ts'

test('sensitivity projections preserve explicit provenance without reconstructing attribution', () => {
  const store = open()
  try {
    const id = store.ingest('api IS service @src:cli #sensitivity:public', {
      provenance: { actor: 'reviewer', sources: ['file-a', 'file-b'], run: 'run-1', domains: ['audit'] }
    }).ids[0]!
    const hidden = store.ingest('secret IS service #sensitivity:restricted', {
      provenance: { actor: 'private-reviewer', sources: ['private-source'] }
    }).ids[0]!
    const original = store.provenanceOf(id)
    const snapshot = store.db.prepare('SELECT * FROM cave_provenance ORDER BY claim_id, dimension, value').all()
    for (const maximum of ['public', 'internal', 'restricted'] as const) {
      for (let repeat = 0; repeat < 2; repeat++) withScopedStore(store, maximum, scoped => {
        assert.deepEqual(scoped.provenanceOf(id), original)
        if (maximum !== 'restricted') {
          assert.deepEqual(scoped.provenanceOf(hidden), { actors: [], sources: [], runs: [], domains: [] })
        }
      })
    }
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_provenance ORDER BY claim_id, dimension, value').all(), snapshot)
    store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, 'source', 'file-c')
    withScopedStore(store, 'public', scoped => assert.deepEqual(scoped.provenanceOf(id), store.provenanceOf(id)))
    store.db.exec('BEGIN')
    try {
      store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, 'source', 'temporary')
      withScopedStore(store, 'public', scoped => assert.deepEqual(scoped.provenanceOf(id), store.provenanceOf(id)))
    } finally { store.db.exec('ROLLBACK') }
    withScopedStore(store, 'public', scoped => assert.deepEqual(scoped.provenanceOf(id), store.provenanceOf(id)))
    store.db.prepare('DELETE FROM cave_provenance WHERE claim_id = ?').run(id)
    withScopedStore(store, 'public', scoped => assert.deepEqual(scoped.provenanceOf(id), store.provenanceOf(id)))
  } finally { store.close() }
})

test('cache statistics are independent snapshots even before a cache exists', () => {
  const first = open()
  const second = open()
  try {
    const expected = { ...scopedStoreCacheStats(first) }
    const snapshot = scopedStoreCacheStats(first)
    Object.assign(snapshot, { projections: 99, cachedClaims: 99 })
    assert.deepEqual(scopedStoreCacheStats(first), expected)
    assert.deepEqual(scopedStoreCacheStats(second), expected)
    first.ingest('retained IS visible')
    overview(first)
    const populated = scopedStoreCacheStats(first)
    Object.assign(populated, { cachedClaims: 99 })
    assert.equal(scopedStoreCacheStats(first).cachedClaims, 1)
    clearScopedStoreCache(first)
    assert.deepEqual(scopedStoreCacheStats(first), expected)
  } finally { first.close(); second.close() }
})

test('search matches and evidence counts share a snapshot at every audience', t => {
  for (const maximum of ['public', 'internal', 'confidential', 'restricted'] as const) {
    const directory = mkdtempSync(join(tmpdir(), 'cave-search-snapshot-'))
    const path = join(directory, 'knowledge.db')
    const writer = open(path)
    writer.db.exec('PRAGMA journal_mode = WAL')
    const root = writer.ingest('matching-before IS evidence #sensitivity:public').ids[0]!
    const reader = open(path, { access: 'read-only' })
    try {
      const original = reader.search.bind(reader)
      let committed = false
      t.mock.method(reader, 'search', (...args: Parameters<typeof original>) => {
        const matches = original(...args)
        if (!committed) {
          committed = true
          const leaf = writer.ingest('matching-after IS evidence #sensitivity:public').ids[0]!
          writer.appendEdges([{ parentId: root, role: 'BECAUSE', childId: leaf }])
        }
        return matches
      })
      const first = search(reader, 'matching', { maxSensitivity: maximum })
      assert.equal(committed, true)
      assert.equal(first.length, 1)
      assert.equal(first[0]!.cites, 0, maximum)
      const next = search(reader, 'matching', { maxSensitivity: maximum })
      assert.equal(next.length, 2)
      assert.equal(next.find(row => row.id === root)!.cites, 1)
    } finally {
      reader.close()
      writer.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

test('search releases failed reads and preserves outer rollback', () => {
  const store = open()
  try {
    store.ingest('matching-retained IS evidence')
    assert.throws(() => search(store, 'matching', { limit: -1 }), /search limit/)
    assert.throws(() => search(store, 'matching\0ignored'), /NUL/)
    store.db.exec('BEGIN')
    store.db.exec('ROLLBACK')
    const rollback = new Error('rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('matching-temporary IS evidence')
      assert.equal(search(store, 'matching').length, 2)
      throw rollback
    }), error => error === rollback)
    assert.equal(search(store, 'matching').length, 1)
  } finally { store.close() }
})

test('restricted dashboards retain one read snapshot across an external commit', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-view-snapshot-'))
  const path = join(directory, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('before IS evidence')
  const reader = open(path, { access: 'read-only' })
  try {
    const prepare = reader.db.prepare.bind(reader.db)
    let committed = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      if (!committed && sql === 'SELECT * FROM cave_claim ORDER BY tx DESC LIMIT ?') {
        committed = true
        writer.ingest('after IS evidence')
      }
      return prepare(sql)
    })
    const first = overview(reader, { maxSensitivity: 'restricted' })
    assert.equal(committed, true)
    assert.equal(first.coverage.rows, 1)
    assert.deepEqual(first.recent.map(row => row.subject), ['before'])
    const next = overview(reader, { maxSensitivity: 'restricted' })
    assert.equal(next.coverage.rows, 2)
    assert.deepEqual(next.recent.map(row => row.subject), ['after', 'before'])
  } finally {
    reader.close()
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('restricted read snapshots release on failure and preserve caller transactions', () => {
  const store = open()
  const failure = new Error('callback failed')
  try {
    store.ingest('retained IS evidence')
    assert.throws(() => withScopedStore(store, 'restricted', scoped => {
      assert.equal(scoped.currentBeliefs().length, 1)
      throw failure
    }), error => error === failure)
    store.db.exec('BEGIN')
    store.db.exec('ROLLBACK')
    assert.throws(() => store.transaction(() => {
      store.ingest('temporary IS evidence')
      assert.equal(overview(store, { maxSensitivity: 'restricted' }).coverage.rows, 2)
      throw failure
    }), error => error === failure)
    assert.equal(overview(store, { maxSensitivity: 'restricted' }).coverage.rows, 1)
  } finally { store.close() }
})

test('snapshot cleanup diagnostics safely retain unprintable errors', t => {
  const store = open()
  const failure = Object.create(null)
  const cleanup = new Error('unreadable')
  Object.defineProperty(cleanup, 'message', { get() { throw new Error('message unavailable') } })
  const exec = store.db.exec.bind(store.db)
  let releases = 0
  t.mock.method(store.db, 'exec', (sql: string) => {
    exec(sql)
    if (sql === 'RELEASE cave_view_read') { releases++; throw cleanup }
  })
  try {
    assert.throws(() => withScopedStore(store, 'restricted', () => { throw failure }), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors[0], failure)
      assert.equal(error.errors[1], cleanup)
      assert.equal(error.cause, failure)
      assert.equal(error.message, 'CAVE view snapshot failed and release also failed: [unprintable thrown value]; [unprintable thrown value]')
      return true
    })
    assert.equal(releases, 1)
    t.mock.restoreAll()
    assert.equal(withScopedStore(store, 'restricted', () => 42), 42)
  } finally { t.mock.restoreAll(); store.close() }
})

test('read snapshots preserve callback and release failures without retrying release', t => {
  const store = open()
  const callbackFailure = new Error('snapshot callback failed')
  const releaseFailure = new Error('snapshot release failed')
  const exec = store.db.exec.bind(store.db)
  let failRelease = true
  let releases = 0
  t.mock.method(store.db, 'exec', (sql: string) => {
    const result = exec(sql)
    if (sql === 'RELEASE cave_view_read') {
      releases += 1
      if (failRelease) throw releaseFailure
    }
    return result
  })
  try {
    assert.throws(() => withScopedStore(store, 'restricted', () => { throw callbackFailure }), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [callbackFailure, releaseFailure])
      assert.equal(error.cause, callbackFailure)
      assert.ok(error.message.includes(callbackFailure.message))
      assert.ok(error.message.includes(releaseFailure.message))
      return true
    })
    assert.equal(releases, 1)
    assert.throws(() => withScopedStore(store, 'restricted', () => 42), error => error === releaseFailure)
    assert.equal(releases, 2)
    failRelease = false
    assert.equal(withScopedStore(store, 'restricted', () => 42), 42)
    store.transaction(() => store.ingest('recovered IS readable'))
    assert.equal(overview(store, { maxSensitivity: 'restricted' }).coverage.rows, 1)
  } finally { store.close() }
})

test('temporary projections preserve callback and close failures and release their database', () => {
  const store = open()
  const readFailure = new Error('projection read failed')
  const closeFailure = new Error('projection close failed')
  try {
    store.ingest('retained IS visible #sensitivity:public')
    for (const failRead of [true, false]) {
      let projection: ReturnType<typeof open> | undefined
      let closes = 0
      assert.throws(() => store.transaction(() => withScopedStore(store, 'public', scoped => {
        projection = scoped
        scoped.onClose(() => { closes += 1; throw closeFailure })
        if (failRead) throw readFailure
        return 42
      })), error => {
        if (failRead) {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, [readFailure, closeFailure])
          assert.equal(error.cause, readFailure)
          assert.ok(error.message.includes(readFailure.message))
          assert.ok(error.message.includes(closeFailure.message))
        } else assert.equal(error, closeFailure)
        return true
      })
      assert.equal(closes, 1)
      assert.ok(projection)
      assert.throws(() => projection!.db.prepare('SELECT 1').get())
      assert.equal(scopedStoreCacheStats(store).projections, 0)
      assert.equal(store.transaction(() => withScopedStore(store, 'public', scoped => scoped.currentBeliefs().length)), 1)
    }
  } finally { store.close() }
})

test('views do not retain rows from rolled-back outer transactions or savepoints', () => {
  const store = open()
  try {
    store.ingest('retained IS visible')
    assert.equal(overview(store).coverage.rows, 1)
    const rollback = new Error('rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('temporary IS visible')
      assert.equal(overview(store).coverage.rows, 2)
      throw rollback
    }), error => error === rollback)
    assert.equal(overview(store).coverage.rows, 1)
    store.transaction(() => {
      store.ingest('committed IS visible')
      assert.equal(overview(store).coverage.rows, 2)
      assert.throws(() => store.transaction(() => {
        store.ingest('nested-temporary IS visible')
        assert.equal(overview(store).coverage.rows, 3)
        throw rollback
      }), error => error === rollback)
      assert.equal(overview(store).coverage.rows, 2)
    })
    assert.equal(overview(store).coverage.rows, 2)
  } finally { store.close() }
})

test('views recover vocabulary after an edge-only savepoint rollback', () => {
  const store = open()
  try {
    const { ids } = store.ingest('CUSTOM IS verb\nreview IS complete')
    const declared = () => withScopedStore(store, 'internal', scoped => Registry.isDeclared(scoped.registry(), 'CUSTOM'))
    assert.equal(declared(), true)
    store.transaction(() => {
      const rollback = new Error('rollback edge')
      assert.throws(() => store.transaction(() => {
        store.appendEdges([{ parentId: ids[1]!, role: 'WHEN', childId: ids[0]! }])
        assert.equal(declared(), false)
        throw rollback
      }), error => error === rollback)
      assert.equal(declared(), true)
    })
    assert.equal(declared(), true)
  } finally { store.close() }
})

test('adapters without transaction inspection use disposable projections even when callbacks throw', () => {
  const native = open()
  const { backup: _backup, ...capabilities } = native.adapter.capabilities
  const adapter = { ...native.adapter, capabilities }
  native.close()
  const store = openWith(adapter, ':memory:')
  try {
    store.ingest('retained IS visible')
    const failure = new Error('callback failed')
    let temporary: typeof store | undefined
    assert.throws(() => withScopedStore(store, 'internal', scoped => {
      temporary = scoped
      assert.equal(scoped.currentBeliefs().length, 1)
      throw failure
    }), error => error === failure)
    assert.ok(temporary)
    assert.throws(() => temporary!.db.prepare('SELECT 1').get())
    assert.equal(scopedStoreCacheStats(store).projections, 0)
    assert.equal(overview(store).coverage.rows, 1)
  } finally { store.close() }
})

test('disposable projections copy claims and edges from one snapshot without transaction inspection', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-disposable-snapshot-'))
  const path = join(directory, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  const root = writer.ingest('root IS evidence #sensitivity:public').ids[0]!
  const leaf = writer.ingest('leaf IS evidence #sensitivity:public').ids[0]!
  const { backup: _backup, ...capabilities } = writer.adapter.capabilities
  const reader = openWith({ ...writer.adapter, capabilities }, path, { access: 'read-only' })
  try {
    const prepare = reader.db.prepare.bind(reader.db)
    let committed = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      if (!committed && sql === 'SELECT parent_id, role, child_id FROM cave_edge ORDER BY rowid') {
        committed = true
        writer.transaction(() => {
          writer.ingest('after IS evidence #sensitivity:public')
          writer.appendEdges([{ parentId: root, role: 'BECAUSE', childId: leaf }])
        })
      }
      return prepare(sql)
    })
    const first = entity(reader, 'root', { maxSensitivity: 'public' })
    assert.equal(committed, true)
    assert.equal(first.out[0]!.cites, 0)
    assert.equal(entity(reader, 'root', { maxSensitivity: 'public' }).out[0]!.cites, 1)
    assert.equal(overview(reader, { maxSensitivity: 'public' }).coverage.rows, 3)
    assert.equal(scopedStoreCacheStats(reader).projections, 0)
    reader.db.exec('BEGIN')
    reader.db.exec('ROLLBACK')
  } finally {
    reader.close()
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('scoped reads reuse one immutable projection and invalidate after local appends', () => {
  const store = open()
  try {
    store.ingest([
      'public-topic CONTAINS public-item #sensitivity:public',
      'public-item IS visible #sensitivity:public',
      'internal-item IS visible',
      'secret-item IS visible #sensitivity:confidential',
      'unknown-item IS visible #sensitivity:future-level',
      'flat-item IS visible #sensitivity'
    ].join('\n'), { strict: true })

    assert.equal(overview(store).coverage.rows, 3)
    const initial = scopedStoreCacheStats(store)
    assert.deepEqual({ ...initial, cachedBytes: 0 }, {
      projections: 1,
      hits: 0,
      builds: 1,
      invalidations: 0,
      retries: 0,
      cachedClaims: 3,
      cachedEdges: 0,
      cachedBytes: 0
    })
    assert.ok(initial.cachedBytes > 0)

    assert.deepEqual(topics(store), [{ name: 'public-topic', members: 1 }])
    assert.equal(entity(store, 'secret-item').activity.length, 0)
    assert.equal(scopedStoreCacheStats(store).hits, 2, 'later reads reuse the indexed projection')

    assert.equal(overview(store, { maxSensitivity: 'public' }).coverage.rows, 2)
    assert.equal(scopedStoreCacheStats(store).projections, 2, 'audience policies have separate projections')
    assert.equal(scopedStoreCacheStats(store).builds, 2)

    store.ingest('later-item IS visible', { strict: true })
    assert.equal(overview(store).coverage.rows, 4)
    const afterAppend = scopedStoreCacheStats(store)
    assert.equal(afterAppend.builds, 3)
    assert.equal(afterAppend.invalidations, 1)
    assert.equal(afterAppend.cachedClaims, 6, 'the replaced internal projection and cached public projection remain')
    assert.equal(entity(store, 'unknown-item').activity.length, 0, 'malformed labels stay fail-closed after rebuild')
    assert.equal(overview(store, { maxSensitivity: 'restricted' }).coverage.rows, 7,
      'restricted bypass still exposes the complete explicitly requested store')
  } finally {
    clearScopedStoreCache(store)
    store.close()
  }
})

test('external commits invalidate a cached projection before the next read', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-view-scope-'))
  const path = join(directory, 'knowledge.db')
  const reader = open(path)
  const writer = open(path)
  try {
    reader.ingest('platform CONTAINS before #sensitivity:public', { strict: true })
    assert.deepEqual(topics(reader), [{ name: 'platform', members: 1 }])
    assert.equal(scopedStoreCacheStats(reader).builds, 1)

    writer.ingest('platform CONTAINS after #sensitivity:public', { strict: true })
    assert.deepEqual(topics(reader), [{ name: 'platform', members: 2 }])
    assert.equal(scopedStoreCacheStats(reader).builds, 2)
    assert.equal(scopedStoreCacheStats(reader).invalidations, 1)
  } finally {
    clearScopedStoreCache(reader)
    writer.close()
    reader.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('continuous source commits exhaust projection retries without returning stale data and recover', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-view-churn-'))
  const path = join(directory, 'knowledge.db')
  const reader = open(path), writer = open(path)
  const allocated: SqliteDatabase[] = []
  try {
    reader.ingest('before IS visible #sensitivity:public')
    const previous = withScopedStore(reader, 'public', scoped => scoped)
    writer.ingest('after IS visible #sensitivity:public\nsecret IS hidden #sensitivity:restricted')
    const originalOpen = reader.adapter.open.bind(reader.adapter)
    t.mock.method(reader.adapter, 'open', (...args: Parameters<typeof originalOpen>) => {
      const db = originalOpen(...args)
      allocated.push(db)
      return db
    })
    const prepare = reader.db.prepare.bind(reader.db)
    let commits = 0, callbacks = 0
    const duringCopy = t.mock.method(reader.db, 'prepare', (sql: string) => {
      if (sql === 'SELECT parent_id, role, child_id FROM cave_edge ORDER BY rowid') {
        writer.ingest(`churn-${++commits} IS visible #sensitivity:public`)
      }
      return prepare(sql)
    })
    assert.throws(() => withScopedStore(reader, 'public', () => { callbacks++ }), /source changed continuously/)
    assert.equal(callbacks, 0)
    assert.equal(commits, 4)
    assert.equal(allocated.length, 4)
    for (const db of allocated) assert.throws(() => db.prepare('SELECT 1').get())
    assert.equal(scopedStoreCacheStats(reader).retries, 4)
    assert.equal(scopedStoreCacheStats(reader).builds, 1)
    assert.equal(scopedStoreCacheStats(reader).projections, 1)
    assert.equal(previous.currentBeliefs().length, 1)
    duringCopy.mock.restore()
    const history = reader.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
    const replacement = withScopedStore(reader, 'public', scoped => scoped)
    assert.equal(replacement.currentBeliefs().length, 6)
    assert.equal(replacement.currentBeliefs().some(row => row.subject === 'secret'), false)
    assert.equal(scopedStoreCacheStats(reader).builds, 2)
    assert.equal(scopedStoreCacheStats(reader).invalidations, 1)
    assert.throws(() => previous.db.prepare('SELECT 1').get())
    assert.equal(withScopedStore(reader, 'public', scoped => scoped), replacement)
    assert.deepEqual(reader.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), history)
  } finally {
    t.mock.restoreAll()
    writer.close()
    reader.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('failed projection construction preserves its error when unpublished database close also fails', t => {
  for (const stage of ['copy', 'revision']) {
    const store = open()
    const allocated: SqliteDatabase[] = []
    const failure = new Error(`${stage} failed`)
    const cleanupFailure = new Error('unpublished close failed')
    let failClose = true
    const originalOpen = store.adapter.open.bind(store.adapter)
    const openMock = t.mock.method(store.adapter, 'open', (...args: Parameters<typeof originalOpen>) => {
      const db = originalOpen(...args)
      allocated.push(db)
      const close = db.close.bind(db)
      t.mock.method(db, 'close', () => { close(); if (failClose) throw cleanupFailure })
      return db
    })
    try {
      store.ingest('retained IS visible')
      const prepare = store.db.prepare.bind(store.db)
      let revisions = 0
      const prepareMock = t.mock.method(store.db, 'prepare', (sql: string) => {
        if ((stage === 'copy' && sql.includes('SELECT c.* FROM cave_claim c')) ||
            (stage === 'revision' && sql === 'PRAGMA data_version' && ++revisions === 2)) throw failure
        return prepare(sql)
      })
      assert.throws(() => overview(store), error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [failure, cleanupFailure])
        assert.equal(error.cause, failure)
        assert.ok(error.message.includes(failure.message))
        assert.ok(error.message.includes(cleanupFailure.message))
        return true
      })
      assert.equal(allocated.length, 1)
      assert.throws(() => allocated[0]!.prepare('SELECT 1').get())
      assert.equal(scopedStoreCacheStats(store).projections, 0)
      prepareMock.mock.restore()
      failClose = false
      assert.equal(overview(store).coverage.rows, 1)
    } finally {
      failClose = false
      openMock.mock.restore()
      store.close()
    }
  }
})

test('failed post-copy revision reads close unpublished projections and preserve cache recovery', t => {
  const store = open()
  const allocated: SqliteDatabase[] = []
  try {
    store.ingest('before IS visible')
    assert.equal(overview(store).coverage.rows, 1)
    store.ingest('after IS visible')
    const originalOpen = store.adapter.open.bind(store.adapter)
    t.mock.method(store.adapter, 'open', (...args: Parameters<typeof originalOpen>) => {
      const db = originalOpen(...args)
      allocated.push(db)
      return db
    })
    const originalPrepare = store.db.prepare.bind(store.db)
    const failure = new Error('revision read failed')
    let reads = 0
    const prepare = t.mock.method(store.db, 'prepare', (sql: string) => {
      if (sql === 'PRAGMA data_version' && ++reads === 2) throw failure
      return originalPrepare(sql)
    })
    assert.throws(() => withScopedStore(store, 'internal', () => assert.fail('failed projection escaped')), error => error === failure)
    assert.equal(allocated.length, 1)
    assert.throws(() => allocated[0]!.prepare('SELECT 1').get(), 'unpublished projection must be closed')
    assert.equal(scopedStoreCacheStats(store).builds, 1)
    assert.equal(scopedStoreCacheStats(store).projections, 1)
    prepare.mock.restore()
    assert.equal(overview(store).coverage.rows, 2)
    assert.equal(scopedStoreCacheStats(store).builds, 2)
    assert.equal(scopedStoreCacheStats(store).invalidations, 1)
  } finally {
    store.close()
    for (const db of allocated) { try { db.close() } catch { /* Already closed by its owner. */ } }
  }
})

test('replacement projection remains usable when retired projection cleanup fails', () => {
  const store = open()
  const failure = new Error('retired projection cleanup failed')
  let cleanups = 0, callbacks = 0
  try {
    store.ingest('before IS visible #sensitivity:public')
    const previous = withScopedStore(store, 'public', scoped => scoped)
    previous.onClose(() => { cleanups++; throw failure })
    store.ingest('after IS visible #sensitivity:public')
    const history = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
    assert.throws(() => withScopedStore(store, 'public', () => { callbacks++ }), error => error === failure)
    assert.equal(callbacks, 0)
    assert.equal(cleanups, 1)
    assert.throws(() => previous.db.prepare('SELECT 1').get())
    const afterFailure = scopedStoreCacheStats(store)
    assert.equal(afterFailure.builds, 2)
    assert.equal(afterFailure.invalidations, 1)
    assert.equal(afterFailure.projections, 1)
    const replacement = withScopedStore(store, 'public', scoped => scoped)
    assert.notEqual(replacement, previous)
    assert.equal(replacement.currentBeliefs().length, 2)
    assert.equal(scopedStoreCacheStats(store).builds, 2)
    assert.equal(scopedStoreCacheStats(store).hits, afterFailure.hits + 1)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), history)
    store.close()
    assert.equal(cleanups, 1)
    assert.throws(() => replacement.db.prepare('SELECT 1').get())
  } finally { store.close() }
})

test('cached projections reject writes so one callback cannot taint later reads', () => {
  const store = open()
  try {
    store.ingest('item IS visible #sensitivity:public', { strict: true })
    assert.throws(() => withScopedStore(store, 'public', scoped =>
      scoped.ingest('leak IS visible #sensitivity:public', { strict: true })))
    assert.equal(overview(store, { maxSensitivity: 'public' }).coverage.rows, 1)
    assert.equal(scopedStoreCacheStats(store).hits, 1)
  } finally {
    clearScopedStoreCache(store)
    store.close()
  }
})

test('closing a source deterministically closes all cached sensitivity projections', () => {
  const store = open()
  store.ingest('item IS visible #sensitivity:public')
  const projections = ['public', 'internal'].map(maximum =>
    withScopedStore(store, maximum as 'public' | 'internal', scoped => scoped))
  assert.equal(scopedStoreCacheStats(store).projections, 2)
  store.close()
  assert.equal(scopedStoreCacheStats(store).projections, 0)
  for (const projection of projections) {
    assert.throws(() => projection.db.prepare('SELECT 1').get())
  }
})

for (const mode of ['evict', 'close'] as const) {
  for (const format of ['readable', 'unprintable']) test(`projection cleanup errors preserve ${mode === 'evict' ? 'cache rebuild' : 'complete source cleanup'}: ${format}`, () => {
    const store = open()
    store.ingest('item IS visible #sensitivity:public')
    const projections = (['public', 'internal'] as const).map(maximum =>
      withScopedStore(store, maximum, scoped => scoped))
    const failures = format === 'readable'
      ? [new Error('cleanup 0'), new Error('cleanup 1')]
      : [Object.create(null), new Error('cleanup 1')]
    const calls: number[] = []
    for (const [index, projection] of projections.entries()) {
      projection.onClose(() => { calls.push(index); throw failures[index] })
    }
    let sourceCleanups = 0
    store.onClose(() => { sourceCleanups++ })
    try {
      assert.throws(() => mode === 'evict' ? clearScopedStoreCache(store) : store.close(),
        (error: unknown) => {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.errors[0], failures[0])
          assert.equal(error.errors[1], failures[1])
          assert.ok(error.message.includes(format === 'readable' ? 'cleanup 0' : '[unprintable thrown value]'))
          assert.ok(error.message.includes('cleanup 1'))
          return true
        })
      assert.deepEqual(calls, [0, 1])
      assert.equal(scopedStoreCacheStats(store).projections, 0)
      for (const projection of projections) assert.throws(() => projection.db.prepare('SELECT 1').get())
      if (mode === 'evict') {
        assert.equal(sourceCleanups, 0)
        const replacement = withScopedStore(store, 'public', scoped => scoped)
        assert.equal(replacement.currentBeliefs().length, 1)
        assert.equal(scopedStoreCacheStats(store).projections, 1)
        store.close()
        assert.throws(() => replacement.db.prepare('SELECT 1').get())
      }
      assert.equal(sourceCleanups, 1, 'later source cleanup runs even after projection errors')
      assert.throws(() => store.db.prepare('SELECT 1').get())
      assert.doesNotThrow(() => store.close())
      assert.deepEqual(calls, [0, 1])
    } finally { store.close() }
  })
}
