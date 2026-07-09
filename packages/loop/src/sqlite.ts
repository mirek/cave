/**
 * The §18 store contract over `@cavelang/store`'s SQLite store — one
 * adapter shared by the MCP `cave_reconstruct` tool and the CLI
 * `cave reconstruct` command.
 *
 * Reads are current-belief only, and negated / retracted rows are not
 * edges — the store's own traversal defaults, matching `memoryStore`.
 */

import type { Store } from '@cavelang/store'
import type { CaveStore } from './store.ts'

/** `@cavelang/loop` store contract over an open SQLite store (spec §18). */
export const sqliteStore = (store: Store): CaveStore => ({
  forward: entity =>
    store.forward(entity).map(fact => ({
      from: entity,
      to: fact.target,
      verb: fact.verb,
      rel: fact.verb,
      conf: fact.row.conf,
      claim: store.toClaim(fact.row)
    })),
  reverse: entity =>
    store.reverse(entity).map(fact => ({
      from: entity,
      to: fact.source,
      verb: fact.verb,
      ...fact.rel === undefined ? {} : { rel: fact.rel },
      conf: fact.row.conf,
      claim: store.toClaim(fact.row)
    })),
  claimsAbout: entity =>
    store.currentBeliefs()
      .filter(row => row.subject === entity || row.object === entity)
      .map(row => store.toClaim(row)),
  expandTopic: topic => store.topicMembers(topic),
  topicsOf: entity => store.topicsOf(entity)
})
