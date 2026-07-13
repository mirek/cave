/**
 * File selection for ingestion: glob expansion, batching, and the
 * incremental-skip bookkeeping.
 *
 * Ingestion provenance is recorded as ordinary CAVE claims —
 * `<path> HAS ingest-digest: <sha256/12> @src:cave-ingest` — so "which
 * files are already ingested at which content version" lives in the same
 * append-only store as the knowledge itself, and re-running `cave ingest`
 * over a monorepo only processes files whose content changed.
 */

import { createHash } from 'node:crypto'
import { globSync, readFileSync, statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { Key, Claim, Value } from '@cavelang/core'
import type { Store } from '@cavelang/store'

/** Digest attribute name used in provenance claims. */
export const digestAttribute = 'ingest-digest'

/** Context marking provenance claims. */
export const provenanceContext = 'src:cave-ingest'

/** @returns matching regular-file paths — globs expanded, directories dropped, deduplicated, sorted. */
export const expand = (patterns: readonly string[], cwd: string = process.cwd()): string[] => {
  const matched = patterns.flatMap(pattern => globSync(pattern, { cwd }))
  return [...new Set(matched)]
    .filter(path => statSync(resolvePath(cwd, path)).isFile())
    .sort()
}

/** @returns first 12 hex chars of the content's sha256. */
export const digestOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 12)

/** Claim key of a file's provenance claim (value excluded by design, §9.2). */
const provenanceKey = (path: string): string =>
  Key.of(Claim.of({
    subject: Claim.entity(path),
    verb: 'HAS',
    payload: Claim.attribute(digestAttribute, Value.parse('x')),
    contexts: [provenanceContext]
  }))

export type Selected = {
  readonly path: string
  readonly digest: string
  /** Pre-fetched content (URL sources); files are read from disk instead. */
  readonly content?: string
}

export type Selection = {
  readonly files: readonly Selected[]
  /** Files skipped because their current digest claim matches. */
  readonly skipped: readonly string[]
}

/** @returns whether the source's current `ingest-digest` belief matches. */
export const isIngested = (store: Store, path: string, digest: string): boolean => {
  const known = store.currentBelief(provenanceKey(path))
  return known !== undefined && known.value_text === digest && known.conf > 0
}

/**
 * Reads and digests candidate files (paths relative to `cwd`), skipping
 * the ones whose current `ingest-digest` belief already matches (pass
 * `force` to re-ingest all).
 */
export const select = (
  store: Store,
  paths: readonly string[],
  options: { force?: boolean, cwd?: string } = {}
): Selection => {
  const files: Selected[] = []
  const skipped: string[] = []
  const cwd = options.cwd ?? process.cwd()
  for (const path of paths) {
    const digest = digestOf(readFileSync(resolvePath(cwd, path), 'utf8'))
    if (options.force !== true && isIngested(store, path, digest)) {
      skipped.push(path)
    } else {
      files.push({ path, digest })
    }
  }
  return { files, skipped }
}

/** Records provenance claims for successfully ingested files. */
export const recordDigests = (store: Store, files: readonly Selected[]): void => {
  if (files.length === 0) {
    return
  }
  const text = files
    .map(file => `${file.path} HAS ${digestAttribute}: ${file.digest} @${provenanceContext}`)
    .join('\n')
  store.ingest(text)
}

/** @returns `files` split into batches of at most `size`. */
export const batch = <T>(files: readonly T[], size: number): T[][] => {
  if (!(size >= 1)) {
    throw new Error(`batch size must be >= 1, got ${size}`)
  }
  const batches: T[][] = []
  for (let at = 0; at < files.length; at += size) {
    batches.push(files.slice(at, at + size))
  }
  return batches
}
