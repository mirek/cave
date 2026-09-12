/**
 * The §18 store contract over `@cavelang/store`'s SQLite store — one
 * adapter shared by the MCP `cave_reconstruct` tool and the CLI
 * `cave reconstruct` command.
 *
 * Reads are current-belief only, and negated / retracted rows are not
 * edges — the store's own traversal defaults, matching `memoryStore`.
 */

import type { Row, Store } from '@cavelang/store'
import { QuerySql } from '@cavelang/store'
import type { CaveStore } from './store.ts'
import { readSnapshot } from './read-snapshot.ts'

// Claim identity includes endpoints, so every relevant series is in this scope.
const entityCurrentSql = `${QuerySql.current(
  '(SELECT * FROM cave_claim WHERE subject = ? OR object = ?)'
)} ORDER BY c.tx`

/** `@cavelang/loop` store contract over an open SQLite store (spec §18). */
export const sqliteStore = (store: Store): CaveStore => ({
  forward: entity => readSnapshot(store, () =>
    store.forward(entity).map(fact => ({
      from: entity,
      to: fact.target,
      verb: fact.verb,
      rel: fact.verb,
      conf: fact.row.conf,
      claim: store.toClaim(fact.row)
    }))),
  reverse: entity => readSnapshot(store, () =>
    store.reverse(entity).map(fact => ({
      from: entity,
      to: fact.source,
      verb: fact.verb,
      ...fact.rel === undefined ? {} : { rel: fact.rel },
      conf: fact.row.conf,
      claim: store.toClaim(fact.row)
    }))),
  claimsAbout: entity => readSnapshot(store, () => {
    if (/[\uD800-\uDFFF]/u.test(entity)) {
      throw new TypeError('CAVE read: unpaired UTF-16 surrogate cannot be queried as UTF-8')
    }
    const current = store.db.prepare(entityCurrentSql).all(entity, entity) as Row.t[]
    return current.map(row => store.toClaim(row))
  }),
  expandTopic: topic => store.topicMembers(topic),
  topicsOf: entity => store.topicsOf(entity)
})
