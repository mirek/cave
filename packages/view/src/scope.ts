/** Reusable read-only sensitivity projections for data-leaving views. */

import { Key, Uuidv7 } from '@cavelang/core'
import type { EdgeRole } from '@cavelang/canonical'
import { Row, Sensitivity } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { openWith } from '@cavelang/store/adapter'
import { errorMessage } from './error-message.ts'

type Projection = {
  readonly revision: string
  readonly store: Store
  readonly claims: number
  readonly edges: number
  readonly bytes: number
}

type Cache = {
  readonly unsubscribe: () => void
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
  if (cache === undefined) return { ...emptyStats }
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
  cache.unsubscribe()
  caches.delete(source)
  const projections = [...cache.projections.values()]
  cache.projections.clear()
  const errors: unknown[] = []
  for (const projection of projections) {
    try { projection.store.close() } catch (error) { errors.push(error) }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors,
    `CAVE view: projection cleanup failed: ${errors.map(errorMessage).join('; ')}`)
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
      const contextsQuery = source.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?')
      const tagsQuery = source.db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ?')
      target.insertResult({
        claims: rows.map(row => {
          if (typeof row.id !== 'string' || !Uuidv7.is(row.id) || row.tx !== row.id) {
            throw new Error(`CAVE view projection failed for claim ${row.id}: stored transaction identity must be a canonical lowercase UUIDv7 with id = tx`)
          }
          const contexts = (contextsQuery.all(row.id) as { context: string }[]).map(entry => entry.context)
          const tags = tagsQuery.all(row.id) as { key: string, value: null | string }[]
          const claim = Row.toClaim(row, contexts, tags)
          if (Key.of(claim) !== row.claim_key) {
            throw new Error(`CAVE view projection failed for claim ${row.id}: stored claim key does not agree with its semantic identity`)
          }
          return { claim, line: 0 }
        }),
        edges,
        registry: source.baseRegistry(),
        problems: []
      }, { ids: rows.map(row => row.id) })
      // insertResult infers compatibility attribution from contexts. A scoped
      // copy must retain the source's explicit dimensions, including no entries.
      target.db.exec('DELETE FROM cave_provenance')
      const provenance = source.db.prepare(`
        SELECT p.claim_id, p.dimension, p.value FROM cave_provenance p
        JOIN cave_claim c ON c.id = p.claim_id
        WHERE ${Sensitivity.sql('c', maximum)}
      `).all() as { claim_id: string, dimension: string, value: string }[]
      const insertProvenance = target.db.prepare(
        'INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)')
      for (const entry of provenance) insertProvenance.run(entry.claim_id, entry.dimension, entry.value)
      target.reloadRegistry()
      // Cached projections are shared across callbacks. Make their database
      // representation immutable so an accidental write cannot taint later reads.
      target.db.exec('PRAGMA query_only = ON')
      return { revision, store: target, claims: rows.length, edges: edges.length, bytes: sizeOf(target) }
    } catch (error) {
      return withReadCleanup(() => { throw error }, () => target.close(),
        'CAVE view projection construction failed and close also failed')
    }
  })

const projectionOf = (source: Store, maximum: Sensitivity.Level): Store => {
  let cache = caches.get(source)
  if (cache === undefined) {
    cache = { unsubscribe: source.onClose(() => clearScopedStoreCache(source)),
      projections: new Map(), hits: 0, builds: 0, invalidations: 0, retries: 0 }
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
    let published = false
    const ready = withReadCleanup(() => {
      if (revisionOf(source) !== before) {
        cache.retries += 1
        return undefined
      }
      cache.builds += 1
      if (existing !== undefined) cache.invalidations += 1
      cache.projections.set(maximum, candidate)
      published = true
      existing?.store.close()
      return candidate.store
    }, () => { if (!published) candidate.store.close() },
    'CAVE view projection publication failed and close also failed')
    if (ready !== undefined) return ready
  }
  throw new Error('CAVE view: source changed continuously while building a sensitivity projection')
}

/** Preserve the primary failure when releasing an owned read resource also fails. */
const withReadCleanup = <T>(body: () => T, cleanup: () => void, message: string): T => {
  let result: T
  try { result = body() } catch (error) {
    try { cleanup() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError],
        `${message}: ${errorMessage(error)}; ${errorMessage(cleanupError)}`, { cause: error })
    }
    throw error
  }
  cleanup()
  return result
}

/** A synchronous read snapshot that can nest inside a caller-owned transaction. */
export const readSnapshot = <T>(source: Store, body: () => T): T => {
  source.db.exec('SAVEPOINT cave_view_read')
  return withReadCleanup(body, () => source.db.exec('RELEASE cave_view_read'),
    'CAVE view snapshot failed and release also failed')
}

/**
 * Runs `body` against rows at or below `maximum`. Restricted includes every
 * row and uses the source directly within a read snapshot. Narrower audiences share an immutable,
 * indexed projection keyed by policy and source revision; appends invalidate
 * it before the next read. Inside transactions, or without adapter transaction
 * inspection, a disposable projection lives only for the synchronous callback.
 * Hidden rows and edges never enter that projection,
 * preserving the fail-closed boundary for every downstream query.
 */
export const withScopedStore = <T>(source: Store, maximum: Sensitivity.Level, body: (store: Store) => T): T => {
  if (maximum === 'restricted') return readSnapshot(source, () => body(source))
  // total_changes does not rewind on rollback, including ROLLBACK TO a
  // savepoint. Never reuse or retain a projection of uncommitted state.
  if (source.adapter.capabilities.backup?.inTransaction(source.db) !== false) {
    // Without transaction inspection the caller may have no snapshot yet.
    // Keep claims and edges coherent even if a peer commits during copying.
    return readSnapshot(source, () => {
      const projection = buildProjection(source, maximum, revisionOf(source))
      return withReadCleanup(() => body(projection.store), () => projection.store.close(),
        'CAVE view projection failed and close also failed')
    })
  }
  return body(projectionOf(source, maximum))
}
