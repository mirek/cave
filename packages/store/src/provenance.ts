/** Explicit provenance dimensions derived alongside compact claim contexts. */

import type { Database } from './adapter.ts'
import { SourceSpan } from '@cavelang/core'

export type Dimension = 'actor' | 'source' | 'run' | 'domain'

export type t = {
  readonly actors: readonly string[]
  readonly sources: readonly string[]
  readonly runs: readonly string[]
  readonly domains: readonly string[]
}

export type Input = {
  readonly actor?: string
  readonly sources?: readonly string[]
  readonly run?: string
  readonly domains?: readonly string[]
}

export type Entry = {
  readonly dimension: Dimension
  readonly value: string
}

const runPrefixes = ['connect/', 'rule/', 'action/', 'automation/'] as const

const actorSource = (source: string): boolean =>
  source === 'cli' || source === 'sync' || source === 'ingest' || source.startsWith('ingest/') ||
  source.startsWith('agent/') || source.startsWith('suggest/') ||
  source.startsWith('cave-') || runPrefixes.some(prefix => source.startsWith(prefix))

const contextEntries = (contexts: readonly string[], authoredSources: boolean): Entry[] => {
  const result: Entry[] = []
  for (const context of contexts) {
    const reference = SourceSpan.parse(context)
    if (reference !== undefined) {
      if (authoredSources) {
        result.push({ dimension: 'source', value: reference.source })
        continue
      }
      if (runPrefixes.some(prefix => reference.source.startsWith(prefix))) {
        result.push(
          { dimension: 'actor' as const, value: reference.source },
          { dimension: 'run' as const, value: reference.source }
        )
        continue
      }
      result.push(actorSource(reference.source) ?
        { dimension: 'actor', value: reference.source } :
        { dimension: 'source', value: reference.source })
      continue
    }
    if (context.startsWith('scope:') && context.length > 'scope:'.length) {
      result.push({ dimension: 'domain', value: context.slice('scope:'.length) })
    }
  }
  return result
}

const clean = (values: readonly (undefined | string)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== undefined && value !== ''))]

export const entries = (contexts: readonly string[], input: Input = {}): Entry[] => {
  // With an explicit actor, every src: in `contexts` was authored before
  // compatibility stamping and therefore names evidence. During replay or
  // migration, established actor/run prefixes are inferred conservatively.
  const inferred = contextEntries(contexts, input.actor !== undefined)
  return [
    ...clean([input.actor, ...inferred.filter(entry => entry.dimension === 'actor').map(entry => entry.value)])
      .map(value => ({ dimension: 'actor' as const, value })),
    ...clean([...(input.sources ?? []), ...inferred.filter(entry => entry.dimension === 'source').map(entry => entry.value)])
      .map(value => ({ dimension: 'source' as const, value })),
    ...clean([input.run, ...inferred.filter(entry => entry.dimension === 'run').map(entry => entry.value)])
      .map(value => ({ dimension: 'run' as const, value })),
    ...clean([...(input.domains ?? []), ...inferred.filter(entry => entry.dimension === 'domain').map(entry => entry.value)])
      .map(value => ({ dimension: 'domain' as const, value }))
  ]
}

export const fromEntries = (values: readonly Entry[]): t => ({
  actors: values.filter(entry => entry.dimension === 'actor').map(entry => entry.value),
  sources: values.filter(entry => entry.dimension === 'source').map(entry => entry.value),
  runs: values.filter(entry => entry.dimension === 'run').map(entry => entry.value),
  domains: values.filter(entry => entry.dimension === 'domain').map(entry => entry.value)
})

/** Stable set representation for interchange and identity comparison. */
export const normalize = (value: t): t => ({
  actors: [...new Set(value.actors)].sort(),
  sources: [...new Set(value.sources)].sort(),
  runs: [...new Set(value.runs)].sort(),
  domains: [...new Set(value.domains)].sort(),
})

/** Parse a complete explicit provenance object; reject unknown dimensions and malformed entries. */
export const parse = (value: unknown): undefined | t => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const keys = ['actors', 'sources', 'runs', 'domains'] as const
  const fields = Object.keys(object)
  if (fields.length !== keys.length || keys.some(key => !fields.includes(key))) return undefined
  const captured: Record<(typeof keys)[number], string[]> = { actors: [], sources: [], runs: [], domains: [] }
  for (const key of keys) {
    const dimension = object[key]
    if (!Array.isArray(dimension)) return undefined
    const values: unknown[] = Array.from(dimension)
    if (!values.every((entry): entry is string => typeof entry === 'string' && entry.length > 0 &&
      !/[\uD800-\uDFFF]/u.test(entry))) return undefined
    captured[key] = values
  }
  return normalize(captured)
}

/** Idempotently derives dimensions for rows written by older CAVE versions. */
export const backfill = (db: Database): void => {
  const missing = db.prepare(`
    SELECT c.id, ctx.context FROM cave_claim c
    LEFT JOIN cave_context ctx ON ctx.claim_id = c.id
    WHERE NOT EXISTS (SELECT 1 FROM cave_provenance p WHERE p.claim_id = c.id)
    ORDER BY c.tx, ctx.rowid
  `).all() as { id: string, context: null | string }[]
  const grouped = new Map<string, string[]>()
  for (const row of missing) {
    let contexts = grouped.get(row.id)
    if (contexts === undefined) {
      contexts = []
      grouped.set(row.id, contexts)
    }
    if (row.context !== null) contexts.push(row.context)
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)
  `)
  for (const [id, contexts] of grouped) {
    for (const entry of entries(contexts)) {
      insert.run(id, entry.dimension, entry.value)
    }
  }
}
