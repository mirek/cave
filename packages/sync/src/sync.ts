/**
 * Store merge (spec §28).
 *
 * A row's UUIDv7 — one value serving as both `id` and `tx` — is its global
 * identity (§28.1): merging copies rows absent by id verbatim (side tables
 * included) and skips matching rows the target already has. A reused id
 * with different content is rejected. Valid replicas are idempotent,
 * transitive and bidirectional —
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

import { errorMessage } from './error-message.ts'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { Claim, Key, Uuidv7 } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { Provenance, Row, Schema, isStoreFile, type Store } from '@cavelang/store'

export { isStoreFile }

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
  /** Source text line, or zero for a database-source problem. */
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
  /** Source identity or text-validation problems; nothing merges when non-empty. */
  readonly problems: readonly SyncProblem[]
}

/**
 * @returns text usable as one entity token in a §28.3 record subject:
 * whitespace, literal delimiters, attribute colons and comment/metadata sigils normalized to `-`, never empty.
 */
export const sanitizeLabel = (text: string): string => {
  const label = text.replaceAll(/[\s;:@#"`]+/g, '-')
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
  const declared = Canonical.Registry.isDeclared(store.registry(), 'SYNCED-INTO')
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

/** Preserve operation failures when releasing a sync-owned SQL resource also fails. */
const withSyncCleanup = <T>(run: () => T, cleanup: () => void): T => {
  let result: T
  try { result = run() } catch (error) {
    try { cleanup() } catch (cleanupError) {
      const messages = [error, cleanupError].map(errorMessage)
      throw new AggregateError([error, cleanupError],
        `database sync failed: ${messages[0]}; cleanup also failed: ${messages[1]}`, { cause: error })
    }
    throw error
  }
  cleanup()
  return result
}

const booleanOption = (value: unknown, name: string, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`)
  return value
}

/**
 * Merges another CAVE store file into `store` (spec §28.1): rows absent by
 * id are copied verbatim — `id`, `tx`, `claim_key`, `raw_line`, contexts,
 * tags, FTS — edges dedupe against stored edges, merged in-band
 * declarations reload the registry, and the generator observes the merged
 * transaction ids (§28.2). Idempotent: a re-run merges nothing and appends
 * no record. Conflicting existing identities reject the whole source before
 * copying, with database problems reported at line zero.
 */
export const syncDb = (store: Store, sourcePath: string, options: SyncOptions = {}): SyncReport => {
  const dryRun = booleanOption(options.dryRun, 'dryRun', false)
  const recordEnabled = booleanOption(options.record, 'record', true)
  if (!existsSync(sourcePath)) {
    // ATTACH would create an empty database at the missing path.
    throw new Error(`${sourcePath}: no such file`)
  }
  const db = store.db
  const from = options.from ?? 'origin'
  const into = options.into ?? 'local'
  const mainFile = (db.prepare("SELECT file FROM pragma_database_list WHERE name = 'main'").get() as { file: string }).file
  const sameFile = (): boolean => {
    if (mainFile === '') return false
    if (realpathSync(sourcePath) === realpathSync(mainFile)) return true
    const source = statSync(sourcePath)
    const main = statSync(mainFile)
    return source.dev === main.dev && source.ino === main.ino
  }
  if (sameFile()) {
    // Attaching the store to itself would deadlock on its own lock; a
    // store trivially holds every row it holds.
    return { merged: 0, skipped: 0, edges: 0, dryRun, problems: [] }
  }
  // SQLite cannot detach an attachment read by an uncommitted outer transaction.
  store.transaction(({ outermost }) => {
    if (!outermost) {
      throw new Error('database sync cannot run inside a caller-owned transaction; sync after it commits or use annotated-text sync')
    }
  })
  try {
    db.prepare('ATTACH DATABASE ? AS cave_sync_src').run(sourcePath)
  } catch (cause) {
    throw new Error(`${sourcePath}: cannot attach sync source: ${errorMessage(cause)}`, { cause })
  }
  return withSyncCleanup(() => {
    let isStore = false
    try {
      isStore = db.prepare(
        "SELECT 1 FROM cave_sync_src.sqlite_master WHERE type = 'table' AND name = 'cave_claim'"
      ).get() !== undefined
    } catch (cause) {
      throw new Error(`${sourcePath}: cannot inspect sync source: ${errorMessage(cause)}`, { cause })
    }
    if (!isStore) {
      throw new Error(`${sourcePath}: not a CAVE store (no cave_claim table)`)
    }
    const sourceVersion = (db.prepare('PRAGMA cave_sync_src.user_version').get() as { user_version: number }).user_version
    if (sourceVersion > Schema.currentVersion) {
      throw new Error(`${sourcePath}: schema version ${sourceVersion} is newer than this runtime supports ` +
        `(${Schema.currentVersion}); upgrade CAVE`)
    }
    if (sourceVersion >= 1) {
      try {
        Schema.validate(db, sourceVersion, 'cave_sync_src')
      } catch (error) {
        throw new Error(`${sourcePath}: ${errorMessage(error)}`, { cause: error })
      }
    }
    const hasProvenance = db.prepare(`
      SELECT 1 FROM cave_sync_src.sqlite_master
      WHERE type = 'table' AND name = 'cave_provenance'
    `).get() !== undefined
    const body = (): SyncReport => {
      const references: readonly (readonly [string, readonly string[]])[] = [
        ['cave_context', ['claim_id']], ['cave_tag', ['claim_id']],
        ['cave_edge', ['parent_id', 'child_id']],
        ...(hasProvenance ? [['cave_provenance', ['claim_id']] as const] : [])
      ]
      for (const [table, fields] of references) {
        // Validate source relationships independently of what the target contains.
        // Explicit queries also cover legacy tables without declared foreign keys.
        const missing = fields.map(field => `NOT EXISTS (SELECT 1 FROM cave_sync_src.cave_claim c WHERE c.id = s.${field})`).join(' OR ')
        if (db.prepare(`SELECT 1 FROM cave_sync_src.${table} s WHERE ${missing} LIMIT 1`).get() !== undefined) {
          return { merged: 0, skipped: 0, edges: 0, dryRun, problems: [{ line: 0,
            message: `source ${table} contains references to missing claims` }] }
        }
      }
      if (db.prepare(`SELECT 1 FROM cave_sync_src.cave_edge
        WHERE role IS NULL OR role NOT IN ('WHEN', 'VIA', 'BECAUSE', 'QUALIFIES') LIMIT 1`).get() !== undefined) {
        return { merged: 0, skipped: 0, edges: 0, dryRun, problems: [{ line: 0,
          message: 'source contains an invalid edge role — expected WHEN, VIA, BECAUSE or QUALIFIES' }] }
      }
      const identities = db.prepare('SELECT id, tx FROM cave_sync_src.cave_claim ORDER BY id').all() as { id: string, tx: string }[]
      const invalid = identities.filter(row => !Uuidv7.is(row.id) || row.tx !== row.id)
      if (invalid.length > 0) {
        return { merged: 0, skipped: 0, edges: 0, dryRun, problems: invalid.map(row => ({
          line: 0,
          message: `row ${JSON.stringify(row.id)} has invalid transaction identity — expected id = tx as a canonical lowercase UUIDv7 (spec §28.1)`,
        })) }
      }
      if (hasProvenance) {
        const malformed = db.prepare(`
          SELECT DISTINCT claim_id AS id FROM cave_sync_src.cave_provenance
          WHERE typeof(value) <> 'text' OR value = '' ORDER BY claim_id
        `).all() as { id: string }[]
        if (malformed.length > 0) {
          return { merged: 0, skipped: 0, edges: 0, dryRun, problems: malformed.map(row => ({
            line: 0,
            message: `row ${JSON.stringify(row.id)} has invalid stored provenance — values must be nonempty text`,
          })) }
        }
      }
      // Compare persisted claim data under the same reservation as the copy.
      // Raw spelling can change during text replay; metadata order is immaterial.
      // Keep normalized value fields and claim_key in the comparison: divergent
      // query data must not hide behind equal emitted text.
      const columns = claimColumns.split(', ').filter(column => column !== 'raw_line')
      const fieldsDiffer = columns.map(column => column === 'sigma_level' ?
        'COALESCE(s.sigma_level, 2) IS NOT COALESCE(t.sigma_level, 2)' :
        `s.${column} IS NOT t.${column}`).join(' OR ')
      const setsDiffer = (table: string, fields: string): string => `
        EXISTS (SELECT ${fields} FROM cave_sync_src.${table} WHERE claim_id = s.id
          EXCEPT SELECT ${fields} FROM main.${table} WHERE claim_id = t.id)
        OR EXISTS (SELECT ${fields} FROM main.${table} WHERE claim_id = t.id
          EXCEPT SELECT ${fields} FROM cave_sync_src.${table} WHERE claim_id = s.id)`
      const conflicts = db.prepare(`
        SELECT s.id FROM cave_sync_src.cave_claim s
        JOIN main.cave_claim t ON t.id = s.id
        WHERE ${fieldsDiffer}
          OR ${setsDiffer('cave_context', 'context')}
          OR ${setsDiffer('cave_tag', 'key, value')}
        ORDER BY s.id
      `).all() as { id: string }[]
      if (hasProvenance) {
        // Sync/backfill can add safely inferred dimensions. Ignore only those
        // differences; explicit provenance on the same identity must agree.
        const differences = db.prepare(`
          SELECT claim_id, dimension, value FROM (
            SELECT p.claim_id, p.dimension, p.value FROM cave_sync_src.cave_provenance p
            JOIN main.cave_claim t ON t.id = p.claim_id
            EXCEPT SELECT claim_id, dimension, value FROM main.cave_provenance
          )
          UNION
          SELECT claim_id, dimension, value FROM (
            SELECT p.claim_id, p.dimension, p.value FROM main.cave_provenance p
            JOIN cave_sync_src.cave_claim s ON s.id = p.claim_id
            EXCEPT SELECT claim_id, dimension, value FROM cave_sync_src.cave_provenance
          )
          ORDER BY claim_id
        `).all() as { claim_id: string, dimension: string, value: string }[]
        const contextsOf = db.prepare('SELECT context FROM main.cave_context WHERE claim_id = ?')
        const inferred = new Map<string, Set<string>>()
        const ids = new Set(conflicts.map(row => row.id))
        for (const difference of differences) {
          let entries = inferred.get(difference.claim_id)
          if (entries === undefined) {
            const contexts = contextsOf.all(difference.claim_id) as { context: string }[]
            entries = new Set(Provenance.entries(contexts.map(row => row.context))
              .map(entry => JSON.stringify([entry.dimension, entry.value])))
            inferred.set(difference.claim_id, entries)
          }
          if (!entries.has(JSON.stringify([difference.dimension, difference.value])) && !ids.has(difference.claim_id)) {
            ids.add(difference.claim_id)
            conflicts.push({ id: difference.claim_id })
          }
        }
      }
      if (conflicts.length > 0) {
        conflicts.sort((a, b) => a.id.localeCompare(b.id))
        return { merged: 0, skipped: 0, edges: 0, dryRun, problems: conflicts.map(({ id }) => ({
          line: 0,
          message: `transaction id ${id} is already stored with different content — a row has one identity (spec §28.1)`,
        })) }
      }
      const sourceClaims = db.prepare('SELECT * FROM cave_sync_src.cave_claim WHERE id > ? ORDER BY id LIMIT 512')
      const sourceContexts = db.prepare('SELECT context FROM cave_sync_src.cave_context WHERE claim_id = ?')
      const sourceTags = db.prepare('SELECT key, value FROM cave_sync_src.cave_tag WHERE claim_id = ?')
      let after = ''
      for (;;) {
        const batch = sourceClaims.all(after) as Row.t[]
        if (batch.length === 0) break
        const problems: SyncReport['problems'][number][] = []
        for (const row of batch) {
          const contexts = sourceContexts.all(row.id).map(entry => entry.context as string)
          const tags = sourceTags.all(row.id) as { key: string, value: null | string }[]
          try {
            const claim = Row.toClaim(row, contexts, tags)
            Canonical.emitClaim(claim)
            if (Key.of(claim) === row.claim_key) continue
          } catch { /* Report malformed stored data without exposing claim contents. */ }
          problems.push({ line: 0, message: `row ${JSON.stringify(row.id)} has an invalid stored claim or inconsistent semantic key` })
        }
        if (problems.length > 0) return { merged: 0, skipped: 0, edges: 0, dryRun, problems }
        after = batch[batch.length - 1]!.id
      }
      db.exec('DROP TABLE IF EXISTS temp.cave_sync_new')
      db.exec(`CREATE TEMP TABLE cave_sync_new AS
        SELECT id FROM cave_sync_src.cave_claim
        WHERE id NOT IN (SELECT id FROM main.cave_claim)`)
      return withSyncCleanup(() => {
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
        if (hasProvenance) {
          db.exec(`INSERT OR IGNORE INTO main.cave_provenance (claim_id, dimension, value)
            SELECT claim_id, dimension, value FROM cave_sync_src.cave_provenance
            WHERE claim_id IN (SELECT id FROM temp.cave_sync_new)`)
        }
        // Only legacy stores without a dimension table need inference.
        // A present table is authoritative, including explicit empty sets.
        const contextRows = hasProvenance ? [] : db.prepare(`
          SELECT n.id, ctx.context FROM temp.cave_sync_new n
          LEFT JOIN main.cave_context ctx ON ctx.claim_id = n.id
          ORDER BY n.id, ctx.rowid
        `).all() as { id: string, context: null | string }[]
        const contexts = new Map<string, string[]>()
        for (const row of contextRows) {
          let values = contexts.get(row.id)
          if (values === undefined) {
            values = []
            contexts.set(row.id, values)
          }
          if (row.context !== null) values.push(row.context)
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
        const record = effective && recordEnabled ?
          appendRecord(store, from, into, merged, edges) :
          undefined
        return {
          merged,
          skipped: total - merged,
          edges,
          dryRun,
          ...record === undefined ? {} : { record },
          problems: []
        }
      }, () => db.exec('DROP TABLE IF EXISTS temp.cave_sync_new'))
    }
    return dryRun ?
      Uuidv7.withStatePreserved(() => rolledBack(store, body)) :
      store.transaction(body)
  }, () => db.exec('DETACH DATABASE cave_sync_src'))
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
  const dryRun = booleanOption(options.dryRun, 'dryRun', false)
  const recordOptions = { record: booleanOption(options.record, 'record', true), from: options.from, into: options.into }
  const body = (): SyncReport => syncTextReserved(store, text, recordOptions, dryRun)
  return dryRun ?
    Uuidv7.withStatePreserved(() => rolledBack(store, body)) :
    store.transaction(body)
}

/** Compare canonical interchange content, independent of raw spelling and metadata order. */
const identityContent = (claim: Claim.t): string => Canonical.emitClaim({
  ...claim,
  contexts: [...claim.contexts].sort(),
  tags: [...claim.tags].sort((a, b) => {
    const left = JSON.stringify([a.key, a.value])
    const right = JSON.stringify([b.key, b.value])
    return left < right ? -1 : left > right ? 1 : 0
  }),
})

/** Validation and identity replay use the same reserved vocabulary snapshot. */
const syncTextReserved = (store: Store, text: string, options: SyncOptions, dryRun: boolean): SyncReport => {
  const problems: SyncProblem[] = []
  const txByLine = new Map<number, string>()
  const provenanceByLine = new Map<number, Provenance.t>()
  text.split(/\r?\n/).forEach((raw, at) => {
    const tx = Canonical.txOfLine(raw)
    if (tx === undefined) {
      // A malformed annotation must not become comment prose merely because
      // a later valid annotation supplies the claim's identity.
      if (/^\s*;@/.test(raw)) {
        problems.push({ line: at + 1, message: 'malformed transaction annotation — expected `;@ <uuidv7>` with optional provenance JSON (spec §28.4)' })
      }
      return
    }
    if (Uuidv7.is(tx)) {
      txByLine.set(at + 1, tx)
      const data = Canonical.txDataOfLine(raw)
      if (data !== undefined) {
        let provenance: undefined | Provenance.t
        try {
          const payload = JSON.parse(data)
          if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) &&
              Object.keys(payload).length === 1 && Object.hasOwn(payload, 'provenance')) {
            provenance = Provenance.parse(payload.provenance)
          }
        } catch { /* Report malformed JSON alongside other source problems. */ }
        if (provenance === undefined) {
          problems.push({ line: at + 1, message: 'malformed provenance annotation — expected a JSON object with complete provenance dimensions (spec §28.4)' })
        } else {
          provenanceByLine.set(at + 1, provenance)
        }
      }
    } else {
      problems.push({ line: at + 1, message: `malformed transaction annotation — expected \`;@ <uuidv7>\` (spec §28.4)` })
    }
  })
  const result = Canonical.canonicalizeText(text, store.registry())
  for (const problem of result.problems) problems.push(problem)
  const consumed = new Set<number>()
  const seen = new Map<string, { line: number, rendered: string, provenance: string }>()
  const newProvenance = new Map<string, Provenance.t>()
  const existingById = store.db.prepare('SELECT * FROM cave_claim WHERE id = ?')
  const stored = new Map<string, { rendered: string, provenance?: string } | undefined>()
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
    const rendered = identityContent(entry.claim)
    const explicitProvenance = provenanceByLine.get(line)
    const provenance = JSON.stringify(explicitProvenance ??
      Provenance.normalize(Provenance.fromEntries(Provenance.entries(entry.claim.contexts))))
    const first = seen.get(tx)
    if (first !== undefined && (first.rendered !== rendered || first.provenance !== provenance)) {
      problems.push({ line: entry.line, message: `transaction annotation repeats line ${first.line}'s id with different content — a row has one identity (spec §28.1)` })
    } else if (first === undefined) {
      seen.set(tx, { line: entry.line, rendered, provenance })
    }
    // Validation runs under one reservation and precedes all writes. Repeated
    // graph references can reuse the stored identity, including absent rows.
    let existing = stored.get(tx)
    if (!stored.has(tx)) {
      const row = existingById.get(tx) as Row.t | undefined
      existing = row === undefined ? undefined : { rendered: identityContent(store.toClaim(row)) }
      stored.set(tx, existing)
    }
    if (existing === undefined && explicitProvenance !== undefined) newProvenance.set(tx, explicitProvenance)
    if (existing !== undefined && existing.rendered === rendered && explicitProvenance !== undefined && existing.provenance === undefined) {
      existing.provenance = JSON.stringify(Provenance.normalize(store.provenanceOf(tx)))
    }
    if (existing !== undefined && (existing.rendered !== rendered ||
        (explicitProvenance !== undefined && existing.provenance !== provenance))) {
      problems.push({ line: entry.line, message: `transaction id ${tx} is already stored with different content — a row has one identity (spec §28.1)` })
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
  const outcome = store.insertResult(result, { ids })
  // Explicit annotation dimensions replace legacy inference only for newly
  // inserted identities. All validation above precedes any mutation.
  const clearProvenance = store.db.prepare('DELETE FROM cave_provenance WHERE claim_id = ?')
  const insertProvenance = store.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)')
  for (const [id, value] of newProvenance) {
    clearProvenance.run(id)
    for (const [key, dimension] of [['actors', 'actor'], ['sources', 'source'], ['runs', 'run'], ['domains', 'domain']] as const) {
      for (const entry of value[key]) insertProvenance.run(id, dimension, entry)
    }
  }
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

/**
 * Merges a source file of either shape: a CAVE store (recognized by the
 * SQLite header) through {@link syncDb}, anything else as §28.4 annotated
 * text through {@link syncText}. The origin label defaults to the file's
 * basename stem.
 */
export const syncFile = (store: Store, sourcePath: string, options: SyncOptions = {}): SyncReport => {
  const withLabel: SyncOptions = {
    from: options.from ?? labelOf(sourcePath),
    into: options.into,
    record: booleanOption(options.record, 'record', true),
    dryRun: booleanOption(options.dryRun, 'dryRun', false)
  }
  if (isStoreFile(sourcePath)) return syncDb(store, sourcePath, withLabel)
  const bytes = readFileSync(sourcePath)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (cause) {
    throw new TypeError(`${sourcePath}: invalid UTF-8 sync text`, { cause })
  }
  return syncText(store, text, withLabel)
}
