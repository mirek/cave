import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { entity, overview, topics } from '@cavelang/view'
import {
  clearScopedStoreCache,
  scopedStoreCacheStats,
  withScopedStore
} from '../src/scope.ts'

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
