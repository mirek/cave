/**
 * Existing-knowledge context for an ingestion batch.
 *
 * Neither extreme works: dumping the whole database into every prompt
 * stops scaling almost immediately, and tools-only leaves the model blind
 * to established naming conventions and prone to duplicates. The middle
 * road injected here is a small *relevant* slice — store statistics, the
 * most-connected entities (naming anchors), and claims matching the batch
 * files' path tokens — while the agent keeps full API access through the
 * `cave_*` MCP tools for anything deeper.
 */

import { emitClaim } from '@cave/canonical'
import type { Store } from '@cave/store'

/** Tokens worth searching for, derived from a file path. */
export const pathTokens = (path: string): string[] => {
  const parts = path
    .split(/[/\\]/)
    .flatMap(segment => segment.split('.'))
    .filter(token => token.length >= 3 && !/^(src|test|index|json|md|ts|js|tsx|jsx|txt|yaml|yml)$/.test(token))
  return [...new Set(parts)]
}

/**
 * @returns a compact knowledge-context block for the batch, capped at
 * `limit` claim lines; `undefined` for an empty store.
 */
export const contextFor = (store: Store, paths: readonly string[], limit = 40): undefined | string => {
  const current = store.currentBeliefs()
  if (current.length === 0) {
    return undefined
  }
  const degree = new Map<string, number>()
  for (const row of current) {
    degree.set(row.subject, (degree.get(row.subject) ?? 0) + 1)
    if (row.object !== null) {
      degree.set(row.object, (degree.get(row.object) ?? 0) + 1)
    }
  }
  const topEntities = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([entity, count]) => `${entity} (${count})`)
  const related = new Map<string, string>()
  for (const token of paths.flatMap(pathTokens)) {
    for (const row of store.search(token).slice(0, 5)) {
      if (related.size >= limit) {
        break
      }
      related.set(row.claim_key, emitClaim(store.toClaim(row)))
    }
  }
  return [
    `The database currently holds ${current.length} current belief(s).`,
    `Established entities (use these names, do not invent variants): ${topEntities.join(', ')}`,
    ...related.size > 0 ?
      ['Existing claims related to this batch:', ...[...related.values()].map(line => `  ${line}`)] :
      []
  ].join('\n')
}
