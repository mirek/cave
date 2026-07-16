/** Build a read-only sensitivity-scoped store snapshot for data-leaving views. */

import { Uuidv7 } from '@cavelang/core'
import type { EdgeRole } from '@cavelang/canonical'
import { Sensitivity, open } from '@cavelang/store'
import type { Row, Store } from '@cavelang/store'

/**
 * Runs `body` against rows at or below `maximum`. Restricted includes every
 * row, so it can use the source directly; narrower views get an isolated
 * in-memory store whose counts, aliases, history, search, and lineage cannot
 * observe filtered rows indirectly.
 */
export const withScopedStore = <T>(source: Store, maximum: Sensitivity.Level, body: (store: Store) => T): T => {
  if (maximum === 'restricted') {
    return body(source)
  }
  return Uuidv7.withStatePreserved(() => {
    const target = open(':memory:', { registry: source.baseRegistry() })
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
      return body(target)
    } finally {
      target.close()
    }
  })
}
