import { booleanOption, sourceList, sourcePath } from './options.ts'
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
import { decodeText, digestBytes, withSourceError } from './content.ts'

/** Digest attribute name used in provenance claims. */
export const digestAttribute = 'ingest-digest'

/** Context marking provenance claims. */
export const provenanceContext = 'src:cave-ingest'

/**
 * File paths normally remain entity atoms for compatibility with existing
 * provenance. Paths that would be split or interpreted as metadata use a
 * code literal so their exact spelling round-trips through CAVE text.
 */
const provenanceSubject = (path: string): Claim.Term => {
  // Newlines cannot appear inside a single-line provenance claim, even in literals.
  if (path.includes('\n')) return Claim.code(`percent-encoded:${encodeURIComponent(path)}`)
  const isEntityAtom = path !== '' &&
    !/[\s"`;]/u.test(path) &&
    !/^(?:[@#]|\+\/-|!$|\(\d+(?:\.\d+)?σ\)$)/u.test(path)
  if (isEntityAtom) {
    return Claim.entity(path)
  }
  // Prefer a code literal for path-like data; use text when the path itself
  // contains a backtick. CAVE has no literal escape syntax, so a path with
  // both delimiters needs a deterministic encoded representation to remain
  // valid through canonical export/import.
  if (path.includes('`')) {
    return path.includes('"') ? Claim.code(`percent-encoded:${encodeURIComponent(path)}`) : Claim.text(path)
  }
  return Claim.code(path)
}

/** One construction path keeps digest lookup and storage identities identical. */
const provenanceClaim = (path: string, digest: string): Claim.t =>
  Claim.of({
    subject: provenanceSubject(path),
    verb: 'HAS',
    payload: Claim.attribute(digestAttribute, Value.parse(digest)),
    contexts: [provenanceContext]
  })

/** @returns matching regular-file paths — globs expanded, directories dropped, deduplicated, sorted. */
export const expand = (patterns: readonly string[], cwd: string = process.cwd()): string[] => {
  sourcePath(cwd, 'cwd')
  const matched = sourceList(patterns, 'patterns').flatMap(pattern => withSourceError(pattern, 'expand pattern', () => globSync(pattern, { cwd })))
  return [...new Set(matched)]
    .filter(path => withSourceError(path, 'inspect source', () => statSync(resolvePath(cwd, path)).isFile()))
    .sort()
}

/** @returns first 12 hex chars of the content's sha256. */
export const digestOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 12)

/** Claim key of a file's provenance claim (value excluded by design, §9.2). */
const provenanceKey = (path: string): string =>
  Key.of(provenanceClaim(path, 'x'))

export type Selected = {
  readonly path: string
  readonly digest: string
  /** Selected content for URL sources and embedded local files. */
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
 * `force` to re-ingest all). With `embed`, retain the same text for prompts
 * so later file changes cannot separate source content from its digest.
 */
export const select = (
  store: Store,
  paths: readonly string[],
  options: { force?: boolean, cwd?: string, embed?: boolean } = {}
): Selection => {
  const force = booleanOption(options.force, 'force')
  const embed = booleanOption(options.embed, 'embed')
  const files: Selected[] = []
  const skipped: string[] = []
  const suppliedCwd = options.cwd
  const cwd = suppliedCwd === undefined ? process.cwd() : sourcePath(suppliedCwd, 'cwd')
  for (const path of sourceList(paths, 'paths')) {
    const bytes = withSourceError(path, 'read source', () => readFileSync(resolvePath(cwd, path)))
    const digest = digestBytes(bytes)
    const content = embed ? decodeText(bytes, path) : undefined
    if (!force && isIngested(store, path, digest)) {
      skipped.push(path)
    } else {
      files.push({ path, digest, ...content === undefined ? {} : { content } })
    }
  }
  return { files, skipped }
}

/** Records provenance claims for successfully ingested files. */
export const recordDigests = (store: Store, files: readonly Selected[]): void => {
  if (files.length === 0) {
    return
  }
  try {
    store.insertResult({
      claims: files.map((file, index) => ({
        line: index + 1,
        claim: provenanceClaim(file.path, file.digest)
      })),
      edges: [],
      registry: store.registry(),
      problems: []
    })
  } catch (error) {
    const sources = files.map(file => JSON.stringify(file.path)).join(', ')
    throw new Error(`failed to record ingest digest(s) for ${sources}`, { cause: error })
  }
}

/** @returns `files` split into batches of at most `size`. */
export const batch = <T>(files: readonly T[], size: number): T[][] => {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error(`batch size must be a positive safe integer, got ${size}`)
  }
  const batches: T[][] = []
  for (let at = 0; at < files.length; at += size) {
    batches.push(files.slice(at, at + size))
  }
  return batches
}
