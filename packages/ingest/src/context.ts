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

import { emitClaim } from '@cavelang/canonical'
import type { Store } from '@cavelang/store'

/** Tokens worth searching for, derived from a file path or URL. */
export const pathTokens = (path: string): string[] => {
  let searchable = path
  if (/^https?:\/\//i.test(path)) {
    try { searchable = decodeURIComponent(path) } catch { /* Keep malformed escapes literal. */ }
  }
  const parts = searchable
    .split(/[/\\?#&=\0]/)
    .flatMap(segment => segment.split('.'))
    .filter(token => token.length >= 3 &&
      !/^(src|test|index|json|md|ts|js|tsx|jsx|txt|yaml|yml|https?:|www|com|net|org|html|htm)$/.test(token))
  return [...new Set(parts)]
}

/**
 * @returns a compact knowledge-context block for the batch, capped at
 * `limit` claim lines; `undefined` for an empty store.
 */
export const contextFor = (store: Store, paths: readonly string[], limit = 40): undefined | string => {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError('context limit must be a non-negative safe integer')
  }
  const current = store.currentBeliefs().filter(row => row.conf > 0)
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
  const currentIds = new Set(current.map(row => row.id))
  for (const token of new Set(paths.flatMap(pathTokens))) {
    if (related.size >= limit) break
    for (const row of store.search(token, { limit: 5, currentOnly: true })) {
      if (!currentIds.has(row.id)) continue
      if (related.size >= limit) {
        break
      }
      const claim = store.toClaim(row)
      related.set(row.claim_key, emitClaim({ ...claim,
        ...claim.comment === undefined ? {} : { comment: claim.comment.replace(/\r\n|\r/g, '\n') }
      }))
    }
  }
  return [
    `The database currently holds ${current.length} current belief(s).`,
    `Established entities (use these names, do not invent variants): ${topEntities.join(', ')}`,
    ...related.size > 0 ?
      ['Existing claims related to this batch:', ...[...related.values()].map(claim =>
        claim.split('\n').map(line => `  ${line}`).join('\n'))] :
      []
  ].join('\n')
}
