/** Reusable read-only sensitivity projections for data-leaving views. */

import { Uuidv7 } from '@cavelang/core'
import type { EdgeRole } from '@cavelang/canonical'
import { Sensitivity } from '@cavelang/store'
import type { Row, Store } from '@cavelang/store'
import { openWith } from '@cavelang/store/adapter'

type Projection = {
  readonly revision: string
  readonly store: Store
  readonly claims: number
  readonly edges: number
  readonly bytes: number
}

type Cache = {
  readonly projections: Map<Sensitivity.Level, Projection>
  hits: number
  builds: number
  invalidations: number
  retries: number
}

const caches = new WeakMap<Store, Cache>()

/** Allocation and reuse evidence used by tests and the representative benchmark. */
export type ScopedStoreCacheStats = {
  readonly projections: number
  readonly hits: number
  readonly builds: number
  readonly invalidations: number
  readonly retries: number
  readonly cachedClaims: number
  readonly cachedEdges: number
  readonly cachedBytes: number
}

const emptyStats: ScopedStoreCacheStats = {
  projections: 0,
  hits: 0,
  builds: 0,
  invalidations: 0,
  retries: 0,
  cachedClaims: 0,
  cachedEdges: 0,
  cachedBytes: 0
}

export const scopedStoreCacheStats = (source: Store): ScopedStoreCacheStats => {
  const cache = caches.get(source)
  if (cache === undefined) return emptyStats
  const projections = [...cache.projections.values()]
  return {
    projections: projections.length,
    hits: cache.hits,
    builds: cache.builds,
    invalidations: cache.invalidations,
    retries: cache.retries,
    cachedClaims: projections.reduce((total, projection) => total + projection.claims, 0),
    cachedEdges: projections.reduce((total, projection) => total + projection.edges, 0),
    cachedBytes: projections.reduce((total, projection) => total + projection.bytes, 0)
  }
}

/** Close and forget all projections owned by one source (primarily tests/tools). */
export const clearScopedStoreCache = (source: Store): void => {
  const cache = caches.get(source)
  if (cache === undefined) return
  for (const projection of cache.projections.values()) projection.store.close()
  cache.projections.clear()
  caches.delete(source)
}

/**
 * SQLite's data_version changes after commits from other connections, while
 * total_changes changes after writes through this connection. Together they
 * cheaply invalidate an append-only store projection without scanning rows.
 */
const revisionOf = (source: Store): string => {
  const data = source.db.prepare('PRAGMA data_version').get() as { data_version: number | bigint }
  const local = source.db.prepare('SELECT total_changes() AS total_changes').get() as
    { total_changes: number | bigint }
  return `${data.data_version}:${local.total_changes}`
}

const sizeOf = (store: Store): number => {
  const pages = store.db.prepare('PRAGMA page_count').get() as { page_count: number | bigint }
  const pageSize = store.db.prepare('PRAGMA page_size').get() as { page_size: number | bigint }
  return Number(pages.page_count) * Number(pageSize.page_size)
}

const buildProjection = (source: Store, maximum: Sensitivity.Level, revision: string): Projection =>
  Uuidv7.withStatePreserved(() => {
    const target = openWith(source.adapter, ':memory:', { registry: source.baseRegistry() })
    try {
      const rows = source.db.prepare(`
        SELECT c.* FROM cave_claim c
        WHERE ${Sensitivity.sql('c', maximum)} ORDER BY c.tx
      `).all() as unknown as Row.t[]
      const index = new Map(rows.map((row, at) => [row.id, at]))
      const edges = (source.db.prepare('SELECT parent_id, role, child_id FROM cave_edge ORDER BY rowid').all() as
        { parent_id: string, role: EdgeRole, child_id: string }[]).flatMap(edge => {
          const parent = index.get(edge.parent_id)
          const child = index.get(edge.child_id)
          return parent === undefined || child === undefined ? [] : [{ parent, role: edge.role, child }]
        })
      target.insertResult({
        claims: rows.map(row => ({ claim: source.toClaim(row), line: 0 })),
        edges,
        registry: source.baseRegistry(),
        problems: []
      }, { ids: rows.map(row => row.id) })
      target.reloadRegistry()
      // Cached projections are shared across callbacks. Make their database
      // representation immutable so an accidental write cannot taint later reads.
      target.db.exec('PRAGMA query_only = ON')
      return { revision, store: target, claims: rows.length, edges: edges.length, bytes: sizeOf(target) }
    } catch (error) {
      target.close()
      throw error
    }
  })

const projectionOf = (source: Store, maximum: Sensitivity.Level): Store => {
  let cache = caches.get(source)
  if (cache === undefined) {
    cache = { projections: new Map(), hits: 0, builds: 0, invalidations: 0, retries: 0 }
    caches.set(source, cache)
  }

  // An external writer can commit while a projection is being copied. Retry
  // until the before/after revision agrees; continuous churn fails closed.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = revisionOf(source)
    const existing = cache.projections.get(maximum)
    if (existing?.revision === before) {
      cache.hits += 1
      return existing.store
    }
    const candidate = buildProjection(source, maximum, before)
    if (revisionOf(source) !== before) {
      candidate.store.close()
      cache.retries += 1
      continue
    }
    cache.builds += 1
    if (existing !== undefined) cache.invalidations += 1
    cache.projections.set(maximum, candidate)
    existing?.store.close()
    return candidate.store
  }
  throw new Error('CAVE view: source changed continuously while building a sensitivity projection')
}

/**
 * Runs `body` against rows at or below `maximum`. Restricted includes every
 * row and uses the source directly. Narrower audiences share an immutable,
 * indexed projection keyed by policy and source revision; appends invalidate
 * it before the next read. Hidden rows and edges never enter that projection,
 * preserving the fail-closed boundary for every downstream query.
 */
export const withScopedStore = <T>(source: Store, maximum: Sensitivity.Level, body: (store: Store) => T): T =>
  maximum === 'restricted' ? body(source) : body(projectionOf(source, maximum))
