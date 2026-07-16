/**
 * Store merge (spec §28).
 *
 * A row's UUIDv7 — one value serving as both `id` and `tx` — is its global
 * identity (§28.1): merging copies rows absent by id verbatim (side tables
 * included) and skips rows the target already has, which makes sync
 * idempotent, transitive and bidirectional, and can never conflict —
 * coexisting contradictions are legal data (§9.4), resolved at read time
 * (§26). Merged transaction ids feed the generator's receive rule (§28.2),
 * so everything appended after a merge sorts after everything merged,
 * whatever the origin machine's clock read.
 *
 * Two source shapes, one semantic:
 *
 * - {@link syncDb} — another CAVE store file, merged through SQL (`ATTACH`);
 * - {@link syncText} — §28.4 transaction-annotated canonical text
 *   (`cave export --tx`), replayed through the ordinary canonicalization
 *   pipeline under the recorded ids.
 *
 * An effective merge appends a §28.3 record claim in the target —
 * `store/<from> SYNCED-INTO store/<into> @src:sync` — whose belief series
 * is the sync log; a merge that changed nothing appends nothing.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs'
import { Uuidv7 } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { Provenance, Schema, type Store } from '@cavelang/store'

export type SyncOptions = {
  /** Origin label of the §28.3 merge record (default `origin`; `syncFile` defaults to the source's basename stem). */
  readonly from?: string
  /** Target label of the §28.3 merge record (default `local`). */
  readonly into?: string
  /** Append the §28.3 merge record on effective merges (default `true`). */
  readonly record?: boolean
  /** Compute the full report inside a rolled-back transaction (default `false`). */
  readonly dryRun?: boolean
}

export type SyncProblem = {
  readonly line: number
  readonly message: string
}

export type SyncReport = {
  /** Claim rows merged (absent by id, now inserted). */
  readonly merged: number
  /** Source claim rows skipped as already present. */
  readonly skipped: number
  /** Edge rows inserted (edges already stored are skipped). */
  readonly edges: number
  readonly dryRun: boolean
  /** The §28.3 merge record appended, when the merge was effective and records are on. */
  readonly record?: string
  /** Text-source problems (spec §28.4 strictness); nothing merges when non-empty. */
  readonly problems: readonly SyncProblem[]
}

/**
 * @returns text usable as one entity token in a §28.3 record subject:
 * whitespace and comment/metadata sigils normalized to `-`, never empty.
 */
export const sanitizeLabel = (text: string): string => {
  const label = text.replaceAll(/[\s;@#]+/g, '-')
  return label === '' ? 'store' : label
}

/**
 * @returns merge-record label derived from a file path: basename with the
 * extension dropped, sanitized to one entity token.
 */
export const labelOf = (path: string): string => {
  const base = path.replaceAll('\\', '/').split('/').pop() ?? path
  return sanitizeLabel(base.replace(/\.[^.]+$/, ''))
}

/** SQLite database files begin with this NUL-terminated 16-byte header. */
const sqliteHeader = 'SQLite format 3\u0000'

/** @returns `true` when the file starts with the SQLite header — a store file rather than canonical text. */
export const isStoreFile = (path: string): boolean => {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(16)
    return readSync(fd, head, 0, 16, 0) === 16 && head.toString('latin1') === sqliteHeader
  } finally {
    closeSync(fd)
  }
}

/** Runs `body` in a transaction that always rolls back — the dry-run mode. */
const rolledBack = <T>(store: Store, body: () => T): T => {
  const sentinel = Symbol('cave sync dry run')
  let result: undefined | { value: T }
  try {
    store.transaction(() => {
      result = { value: body() }
      throw sentinel
    })
  } catch (error) {
    if (error !== sentinel) {
      throw error
    }
  }
  return result!.value
}

/**
 * Appends the §28.3 merge record (declaring `SYNCED-INTO` in-band on first
 * use) and returns the record line. Stamped `@src:sync` by the ordinary
 * §9.5 path.
 */
const appendRecord = (store: Store, from: string, into: string, merged: number, edges: number): string => {
  const declared = store.db.prepare(
    "SELECT 1 FROM cave_claim WHERE subject = 'SYNCED-INTO' AND verb = 'IS' AND object = 'verb' AND negated = 0 LIMIT 1"
  ).get() !== undefined
  const line = `store/${sanitizeLabel(from)} SYNCED-INTO store/${sanitizeLabel(into)} ; +${merged} claim(s), +${edges} edge(s)`
  const text = declared ?
    line :
    `SYNCED-INTO IS verb ; an origin store's rows were merged into a target store\n${line}`
  store.ingest(text, { source: 'sync', strict: true })
  return line
}

/** Column list of `cave_claim`, for the verbatim §28.1 row copy. */
const claimColumns = [
  'id', 'tx', 'subject', 'verb', 'negated', 'object', 'attribute',
  'value_text', 'value_num', 'value_unit', 'value_approx',
  'delta_text', 'delta_num', 'delta_unit', 'sigma_level',
  'conf', 'importance', 'comment', 'raw_line', 'claim_key'
].join(', ')

/**
 * Merges another CAVE store file into `store` (spec §28.1): rows absent by
 * id are copied verbatim — `id`, `tx`, `claim_key`, `raw_line`, contexts,
 * tags, FTS — edges dedupe against stored edges, merged in-band
 * declarations reload the registry, and the generator observes the merged
 * transaction ids (§28.2). Idempotent: a re-run merges nothing and appends
 * no record.
 */
export const syncDb = (store: Store, sourcePath: string, options: SyncOptions = {}): SyncReport => {
  if (!existsSync(sourcePath)) {
    // ATTACH would create an empty database at the missing path.
    throw new Error(`${sourcePath}: no such file`)
  }
  const db = store.db
  const dryRun = options.dryRun === true
  const mainFile = (db.prepare("SELECT file FROM pragma_database_list WHERE name = 'main'").get() as { file: string }).file
  if (mainFile !== '' && realpathSync(sourcePath) === realpathSync(mainFile)) {
    // Attaching the store to itself would deadlock on its own lock; a
    // store trivially holds every row it holds.
    return { merged: 0, skipped: 0, edges: 0, dryRun, problems: [] }
  }
  try {
    db.prepare('ATTACH DATABASE ? AS cave_sync_src').run(sourcePath)
  } catch {
    throw new Error(`${sourcePath}: not a CAVE store (not a SQLite database)`)
  }
  try {
    let isStore = false
    try {
      isStore = db.prepare(
        "SELECT 1 FROM cave_sync_src.sqlite_master WHERE type = 'table' AND name = 'cave_claim'"
      ).get() !== undefined
    } catch {
      isStore = false
    }
    if (!isStore) {
      throw new Error(`${sourcePath}: not a CAVE store (no cave_claim table)`)
    }
    const sourceVersion = (db.prepare('PRAGMA cave_sync_src.user_version').get() as { user_version: number }).user_version
    if (sourceVersion > Schema.currentVersion) {
      throw new Error(`${sourcePath}: schema version ${sourceVersion} is newer than this runtime supports ` +
        `(${Schema.currentVersion}); upgrade CAVE`)
    }
    if (sourceVersion === Schema.currentVersion) {
      try {
        Schema.validate(db, sourceVersion, 'cave_sync_src')
      } catch (error) {
        throw new Error(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const body = (): SyncReport => {
      db.exec('DROP TABLE IF EXISTS temp.cave_sync_new')
      db.exec(`CREATE TEMP TABLE cave_sync_new AS
        SELECT id FROM cave_sync_src.cave_claim
        WHERE id NOT IN (SELECT id FROM main.cave_claim)`)
      try {
        const count = (sql: string): number =>
          (db.prepare(sql).get() as { n: number }).n
        const total = count('SELECT COUNT(*) AS n FROM cave_sync_src.cave_claim')
        const merged = count('SELECT COUNT(*) AS n FROM temp.cave_sync_new')
        db.exec(`INSERT INTO main.cave_claim (${claimColumns})
          SELECT ${claimColumns} FROM cave_sync_src.cave_claim
          WHERE id IN (SELECT id FROM temp.cave_sync_new)`)
        db.exec(`INSERT INTO main.cave_context (claim_id, context)
          SELECT claim_id, context FROM cave_sync_src.cave_context
          WHERE claim_id IN (SELECT id FROM temp.cave_sync_new)`)
        const hasProvenance = db.prepare(`
          SELECT 1 FROM cave_sync_src.sqlite_master
          WHERE type = 'table' AND name = 'cave_provenance'
        `).get() !== undefined
        if (hasProvenance) {
          db.exec(`INSERT OR IGNORE INTO main.cave_provenance (claim_id, dimension, value)
            SELECT claim_id, dimension, value FROM cave_sync_src.cave_provenance
            WHERE claim_id IN (SELECT id FROM temp.cave_sync_new)`)
        }
        // Older stores have no dimension table. Derive every safely
        // inferable dimension from their compact contexts after copying;
        // INSERT OR IGNORE also fills gaps in partially upgraded stores.
        const contextRows = db.prepare(`
          SELECT n.id, ctx.context FROM temp.cave_sync_new n
          LEFT JOIN main.cave_context ctx ON ctx.claim_id = n.id
          ORDER BY n.id, ctx.rowid
        `).all() as { id: string, context: null | string }[]
        const contexts = new Map<string, string[]>()
        for (const row of contextRows) {
          contexts.set(row.id, [...contexts.get(row.id) ?? [], ...row.context === null ? [] : [row.context]])
        }
        const insertProvenance = db.prepare(`
          INSERT OR IGNORE INTO main.cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)
        `)
        for (const [id, values] of contexts) {
          for (const entry of Provenance.entries(values)) {
            insertProvenance.run(id, entry.dimension, entry.value)
          }
        }
        db.exec(`INSERT INTO main.cave_tag (claim_id, key, value)
          SELECT claim_id, key, value FROM cave_sync_src.cave_tag
          WHERE claim_id IN (SELECT id FROM temp.cave_sync_new)`)
        db.exec(`INSERT INTO main.cave_fts (claim_id, subject, verb, object, attribute, value_text, comment, raw_line)
          SELECT id, subject, verb, object, attribute, value_text, comment, raw_line
          FROM cave_sync_src.cave_claim
          WHERE id IN (SELECT id FROM temp.cave_sync_new)`)
        // Edges whose endpoints both exist after the row copy and that are
        // not already stored — a re-sync adds none; an incremental sync may
        // add edges into rows merged earlier.
        const edges = Number(db.prepare(`INSERT INTO main.cave_edge (parent_id, role, child_id)
          SELECT e.parent_id, e.role, e.child_id FROM cave_sync_src.cave_edge e
          WHERE EXISTS (SELECT 1 FROM main.cave_claim p WHERE p.id = e.parent_id)
            AND EXISTS (SELECT 1 FROM main.cave_claim c WHERE c.id = e.child_id)
            AND NOT EXISTS (SELECT 1 FROM main.cave_edge m
              WHERE m.parent_id = e.parent_id AND m.role = e.role AND m.child_id = e.child_id)`).run().changes)
        if (!dryRun) {
          // The receive rule (spec §28.2): later local appends outsort
          // everything merged. Dry runs leave the generator untouched.
          const maxTx = db.prepare('SELECT MAX(tx) AS tx FROM cave_sync_src.cave_claim').get() as { tx: null | string }
          if (maxTx.tx !== null) {
            Uuidv7.observe(maxTx.tx)
          }
        }
        // Merged in-band declarations (REVERSE, extension verbs) take
        // effect without reopening; rolled back with the transaction on
        // dry runs and failures.
        store.reloadRegistry()
        const effective = merged + edges > 0
        const record = effective && options.record !== false ?
          appendRecord(store, options.from ?? 'origin', options.into ?? 'local', merged, edges) :
          undefined
        return {
          merged,
          skipped: total - merged,
          edges,
          dryRun,
          ...record === undefined ? {} : { record },
          problems: []
        }
      } finally {
        db.exec('DROP TABLE IF EXISTS temp.cave_sync_new')
      }
    }
    return dryRun ?
      Uuidv7.withStatePreserved(() => rolledBack(store, body)) :
      store.transaction(body)
  } finally {
    db.exec('DETACH DATABASE cave_sync_src')
  }
}

/**
 * Merges §28.4 transaction-annotated canonical text (`cave export --tx`)
 * into `store`: each claim line replays under the id its `;@` annotation
 * carries — present ids skip, absent ids insert — through the ordinary
 * canonicalization pipeline, never stamped (§9.5 interchange replay).
 *
 * Strict by the spec: every claim line must carry a well-formed UUIDv7
 * annotation, every annotation must precede a claim line, and no id may
 * repeat with different content — otherwise the whole text is rejected
 * with line-level problems and nothing merges (plain text belongs to
 * `cave import`). An *identical* repeat is a re-statement — the §28.4
 * rendering of a row cited by several parents — and unions back into one
 * row, contributing its edge.
 */
export const syncText = (store: Store, text: string, options: SyncOptions = {}): SyncReport => {
  const dryRun = options.dryRun === true
  const problems: SyncProblem[] = []
  const txByLine = new Map<number, string>()
  text.split(/\r?\n/).forEach((raw, at) => {
    const tx = Canonical.txOfLine(raw)
    if (tx === undefined) {
      return
    }
    if (Uuidv7.is(tx)) {
      txByLine.set(at + 1, tx)
    } else {
      problems.push({ line: at + 1, message: `malformed transaction annotation — expected \`;@ <uuidv7>\` (spec §28.4)` })
    }
  })
  const result = Canonical.canonicalizeText(text, store.registry())
  problems.push(...result.problems)
  const consumed = new Set<number>()
  const seen = new Map<string, { line: number, rendered: string }>()
  const ids = result.claims.map(entry => {
    const line = entry.line - 1
    const tx = txByLine.get(line)
    if (tx === undefined) {
      problems.push({
        line: entry.line,
        message: 'claim line without a transaction annotation — sync replays identity; use cave import for plain text (spec §28.4)'
      })
      return undefined
    }
    consumed.add(line)
    // A repeated id is a *re-statement* — how annotated text carries a row
    // cited by several parents (§28.4) — and unions back into one row, the
    // same §28.1 rule that makes re-syncs idempotent. Only a repeat that
    // disagrees on content forks identity, and rejects.
    const rendered = Canonical.emitClaim(entry.claim)
    const first = seen.get(tx)
    if (first !== undefined && first.rendered !== rendered) {
      problems.push({ line: entry.line, message: `transaction annotation repeats line ${first.line}'s id with different content — a row has one identity (spec §28.1)` })
    } else if (first === undefined) {
      seen.set(tx, { line: entry.line, rendered })
    }
    return tx
  })
  for (const [line] of txByLine) {
    if (!consumed.has(line)) {
      problems.push({ line, message: 'transaction annotation does not precede a claim line (spec §28.4)' })
    }
  }
  if (problems.length > 0) {
    return { merged: 0, skipped: 0, edges: 0, dryRun, problems: problems.sort((a, b) => a.line - b.line) }
  }
  const body = (): SyncReport => {
    const outcome = store.insertResult(result, { ids })
    const merged = result.claims.length - outcome.skipped
    const effective = merged + outcome.edges > 0
    const record = effective && options.record !== false ?
      appendRecord(store, options.from ?? 'origin', options.into ?? 'local', merged, outcome.edges) :
      undefined
    return {
      merged,
      skipped: outcome.skipped,
      edges: outcome.edges,
      dryRun,
      ...record === undefined ? {} : { record },
      problems: []
    }
  }
  return dryRun ?
    Uuidv7.withStatePreserved(() => rolledBack(store, body)) :
    store.transaction(body)
}

/**
 * Merges a source file of either shape: a CAVE store (recognized by the
 * SQLite header) through {@link syncDb}, anything else as §28.4 annotated
 * text through {@link syncText}. The origin label defaults to the file's
 * basename stem.
 */
export const syncFile = (store: Store, sourcePath: string, options: SyncOptions = {}): SyncReport => {
  const withLabel = { from: labelOf(sourcePath), ...options }
  return isStoreFile(sourcePath) ?
    syncDb(store, sourcePath, withLabel) :
    syncText(store, readFileSync(sourcePath, 'utf8'), withLabel)
}
