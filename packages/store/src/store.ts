/**
 * The CAVE store (spec §13) — append-only claim persistence on the Node.js
 * builtin `node:sqlite`.
 *
 * - one row per fact, canonical direction; inverses are query-time views
 *   over existing indexes, never materialized rows (spec §13.3);
 * - current belief = latest tx per claim key (spec §9.1, §13.5);
 * - the verb registry is rebuilt from stored in-band declaration claims on
 *   open, so a reopened database keeps its inverse vocabulary;
 * - full-text search over subjects, objects, values, comments and raw
 *   lines via FTS5.
 */

import { DatabaseSync } from 'node:sqlite'
import { Claim, Key, Uuidv7, Verb } from '@cave/core'
import * as Canonical from '@cave/canonical'
import * as Row from './row.ts'
import * as Schema from './schema.ts'

const currentSql = `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

export type IngestResult = {
  /** ids of inserted claim rows, in document order. */
  readonly ids: readonly string[]
  readonly edges: number
  readonly problems: readonly Canonical.Problem[]
}

export type ForwardFact = {
  /** Canonical (primary) verb. */
  readonly verb: string
  readonly target: string
  readonly row: Row.t
}

export type ReverseFact = {
  /** Canonical (primary) verb of the stored row. */
  readonly verb: string
  /** Inverse relation name, `undefined` when none is declared (spec §5.5). */
  readonly rel?: string
  readonly source: string
  readonly row: Row.t
}

export type TraverseOptions = {
  /** Include `VERB NOT` rows (default `false`). */
  readonly negated?: boolean
  /** Include rows whose current belief is `@ 0%` (default `false`). */
  readonly retracted?: boolean
}

export type Store = ReturnType<typeof open>

/**
 * Opens (creating if necessary) a CAVE store. The registry defaults to the
 * standard §5.5 prelude pairs and is extended by any declaration claims
 * already stored; pass `Canonical.Registry.empty` for a declaration-free
 * start.
 */
export const open = (path: string = ':memory:', options: { registry?: Canonical.Registry.t } = {}) => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  Schema.init(db)

  let registry = options.registry ?? Canonical.standardRegistry

  const insertClaim = db.prepare(`
    INSERT INTO cave_claim (
      id, tx, subject, verb, negated, object, attribute,
      value_text, value_num, value_unit, value_approx,
      delta_text, delta_num, delta_unit, sigma_level,
      conf, importance, comment, raw_line, claim_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertContext = db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)')
  const insertTag = db.prepare('INSERT INTO cave_tag (claim_id, key, value) VALUES (?, ?, ?)')
  const insertEdge = db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)')
  const insertFts = db.prepare(`
    INSERT INTO cave_fts (claim_id, subject, verb, object, attribute, value_text, comment, raw_line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  /**
   * Rebuilds in-band declarations from stored claims (ordered by tx),
   * mirroring `@cave/canonical`'s `applyDeclarations` predicate exactly —
   * the registry after reopen must equal the registry at close. Qualifier
   * condition rows (children of WHEN/VIA/BECAUSE edges) never declared
   * in-session, so they are excluded here too; `X IS verb` needs a
   * verb-shaped plain-entity subject.
   */
  const rebuildRegistry = (): void => {
    const declarations = db.prepare(`
      SELECT subject, verb, object FROM cave_claim
      WHERE negated = 0 AND object IS NOT NULL AND verb IN ('REVERSE', 'IS')
        AND id NOT IN (SELECT child_id FROM cave_edge WHERE role IN ('WHEN', 'VIA', 'BECAUSE'))
      ORDER BY tx
    `).all() as { subject: string, verb: string, object: string }[]
    for (const declaration of declarations) {
      if (!Verb.isVerbToken(declaration.subject)) {
        continue
      }
      if (declaration.verb === 'REVERSE' && Verb.isVerbToken(declaration.object)) {
        registry = Canonical.Registry.declareReverse(registry, declaration.subject, declaration.object).registry
      } else if (declaration.verb === 'IS' && declaration.object === 'verb') {
        registry = Canonical.Registry.declareVerb(registry, declaration.subject)
      }
    }
  }
  rebuildRegistry()

  const transaction = <T>(body: () => T): T => {
    db.exec('BEGIN')
    try {
      const result = body()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** Appends a canonicalization result — one row per claim, per-row tx. */
  const insertResult = (result: Canonical.Result): IngestResult =>
    transaction(() => {
      const ids: string[] = []
      for (const entry of result.claims) {
        const claim = entry.claim
        const id = Uuidv7.next()
        const columns = Row.toColumns(claim)
        const rawLine = columns.rawLine === '' ? Canonical.emitClaim(claim) : columns.rawLine
        insertClaim.run(
          id, id,
          columns.subject, columns.verb, columns.negated, columns.object, columns.attribute,
          columns.valueText, columns.valueNum, columns.valueUnit, columns.valueApprox,
          columns.deltaText, columns.deltaNum, columns.deltaUnit, columns.sigmaLevel,
          columns.conf, columns.importance, columns.comment,
          rawLine,
          Key.of(claim)
        )
        for (const context of claim.contexts) {
          insertContext.run(id, context)
        }
        for (const tag of claim.tags) {
          insertTag.run(id, tag.key, tag.value ?? null)
        }
        insertFts.run(
          id, columns.subject, columns.verb, columns.object, columns.attribute,
          columns.valueText, columns.comment, rawLine
        )
        ids.push(id)
      }
      for (const edge of result.edges) {
        insertEdge.run(ids[edge.parent]!, edge.role, ids[edge.child]!)
      }
      registry = result.registry
      return { ids, edges: result.edges.length, problems: result.problems }
    })

  const rows = (sql: string, ...params: (string | number)[]): Row.t[] =>
    db.prepare(sql).all(...params) as unknown as Row.t[]

  const contextsOf = (id: string): string[] =>
    (db.prepare('SELECT context FROM cave_context WHERE claim_id = ?').all(id) as { context: string }[])
      .map(row => row.context)

  const tagsOf = (id: string): { key: string, value: null | string }[] =>
    db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ?').all(id) as { key: string, value: null | string }[]

  const toClaim = (row: Row.t): Claim.t =>
    Row.toClaim(row, contextsOf(row.id), tagsOf(row.id))

  const traversalFilter = (options: TraverseOptions): string =>
    (options.negated === true ? '' : ' AND negated = 0') +
    (options.retracted === true ? '' : ' AND conf > 0')

  return {
    /** Raw database handle — used by `@cave/query`; treat as read-only. */
    db,

    /** Current verb registry (input registry + stored + ingested declarations). */
    registry: (): Canonical.Registry.t => registry,

    /**
     * Parses, canonicalizes and appends CAVE text. Lenient by default —
     * problems are returned, valid lines still land (spec §1.6); pass
     * `strict` to throw instead.
     */
    ingest(text: string, options_: { strict?: boolean } = {}): IngestResult {
      const result = Canonical.canonicalizeText(text, registry)
      if (options_.strict === true && result.problems.length > 0) {
        const detail = result.problems.map(problem => `  line ${problem.line}: ${problem.message}`).join('\n')
        throw new Error(`CAVE ingest failed with ${result.problems.length} problem(s):\n${detail}`)
      }
      return insertResult(result)
    },

    /** Appends an already-canonicalized result. */
    insertResult,

    /** Latest row per claim key (spec §13.5), oldest first. */
    currentBeliefs(options_: { minConf?: number } = {}): Row.t[] {
      return options_.minConf === undefined ?
        rows(`${currentSql} ORDER BY c.tx`) :
        rows(`${currentSql} WHERE c.conf >= ? ORDER BY c.tx`, options_.minConf)
    },

    /** Current belief for one claim key, `undefined` if the fact is unknown. */
    currentBelief(claimKey: string): undefined | Row.t {
      const row = db.prepare(
        'SELECT * FROM cave_claim WHERE claim_key = ? ORDER BY tx DESC LIMIT 1'
      ).get(claimKey) as undefined | Row.t
      return row
    },

    /** Full belief series of one claim key, oldest first (spec §9.1). */
    history(claimKey: string): Row.t[] {
      return rows('SELECT * FROM cave_claim WHERE claim_key = ? ORDER BY tx', claimKey)
    },

    /** All rows about an entity, both directions, newest first (spec §13.5). */
    claimsAbout(entity: string): Row.t[] {
      return rows('SELECT * FROM cave_claim WHERE subject = ? OR object = ? ORDER BY tx DESC', entity, entity)
    },

    /** Forward reads: current relational facts with `entity` as subject (spec §13.3). */
    forward(entity: string, options_: TraverseOptions = {}): ForwardFact[] {
      return rows(
        `SELECT * FROM (${currentSql}) WHERE subject = ? AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
        entity
      ).map(row => ({ verb: row.verb, target: row.object!, row }))
    },

    /**
     * Inverse reads — the pre-v3 gap (spec §13.3): current relational facts
     * with `entity` as object, relation named via the registry's inverse
     * when one is declared.
     */
    reverse(entity: string, options_: TraverseOptions = {}): ReverseFact[] {
      return rows(
        `SELECT * FROM (${currentSql}) WHERE object = ? AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
        entity
      ).map(row => {
        const rel = Canonical.Registry.inverseOf(registry, row.verb)
        return { verb: row.verb, ...rel === undefined ? {} : { rel }, source: row.subject, row }
      })
    },

    /** Flat tag (`value` omitted → `value IS NULL`) or scoped tag rows (spec §13.5). */
    byTag(key: string, value?: string): Row.t[] {
      return value === undefined ?
        rows(`
          SELECT c.* FROM cave_claim c JOIN cave_tag t ON c.id = t.claim_id
          WHERE t.key = ? AND t.value IS NULL ORDER BY c.tx`, key) :
        rows(`
          SELECT c.* FROM cave_claim c JOIN cave_tag t ON c.id = t.claim_id
          WHERE t.key = ? AND t.value = ? ORDER BY c.tx`, key, value)
    },

    /** Rows carrying a context (spec §13.5), newest first. */
    byContext(context: string): Row.t[] {
      return rows(`
        SELECT c.* FROM cave_claim c JOIN cave_context ctx ON c.id = ctx.claim_id
        WHERE ctx.context = ? ORDER BY c.tx DESC`, context)
    },

    /** Members of a topic — forward `CONTAINS` traversal (spec §11.2). */
    topicMembers(topic: string, options_: TraverseOptions = {}): string[] {
      return rows(
        `SELECT * FROM (${currentSql}) WHERE subject = ? AND verb = 'CONTAINS' AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
        topic
      ).map(row => row.object!)
    },

    /** Topics containing an entity — the inverse `CONTAINS` read (spec §11.2). */
    topicsOf(entity: string, options_: TraverseOptions = {}): string[] {
      return rows(
        `SELECT * FROM (${currentSql}) WHERE object = ? AND verb = 'CONTAINS'${traversalFilter(options_)} ORDER BY tx`,
        entity
      ).map(row => row.subject)
    },

    /**
     * Full-text search, newest first. The query is treated as a literal
     * phrase by default (safe for terms like `token-expiry`, which FTS5
     * would otherwise parse as a column filter); pass `raw` to use full
     * FTS5 MATCH syntax.
     */
    search(query: string, options_: { raw?: boolean } = {}): Row.t[] {
      const match = options_.raw === true ? query : `"${query.replaceAll('"', '""')}"`
      return rows(`
        SELECT c.* FROM cave_claim c JOIN cave_fts f ON c.id = f.claim_id
        WHERE cave_fts MATCH ? ORDER BY c.tx DESC`, match)
    },

    /** Qualifier/grouping edges of a claim row (spec §13.2). */
    edgesOf(parentId: string): { role: string, child: Row.t }[] {
      return (db.prepare(`
        SELECT e.role AS role, c.* FROM cave_edge e JOIN cave_claim c ON c.id = e.child_id
        WHERE e.parent_id = ?`).all(parentId) as unknown as (Row.t & { role: string })[]
      ).map(({ role, ...child }) => ({ role, child: child as Row.t }))
    },

    /** Reconstructs the full canonical claim of a row (side tables included). */
    toClaim,

    /**
     * Emits the store as canonical CAVE text — all rows in transaction
     * order, or only current beliefs with `current`.
     *
     * In current-only export an edge endpoint may be a superseded row;
     * dropping such edges would silently un-condition current claims and
     * promote orphaned WHEN conditions to top-level facts. Instead each
     * endpoint resolves to the *current row of its claim key*, and the
     * resulting edges are deduplicated.
     */
    exportText(options_: { current?: boolean } = {}): string {
      const current = options_.current === true
      const claimRows = current ?
        rows(`${currentSql} ORDER BY c.tx`) :
        rows('SELECT * FROM cave_claim ORDER BY tx')
      const indexById = new Map(claimRows.map((row, index) => [row.id, index]))
      let resolve = (id: string): undefined | number => indexById.get(id)
      if (current) {
        const indexByKey = new Map(claimRows.map((row, index) => [row.claim_key, index]))
        const keyById = new Map(
          (db.prepare('SELECT id, claim_key FROM cave_claim').all() as { id: string, claim_key: string }[])
            .map(row => [row.id, row.claim_key])
        )
        resolve = id => indexById.get(id) ?? indexByKey.get(keyById.get(id) ?? '')
      }
      const claims = claimRows.map(row => ({ claim: toClaim(row), line: 0 }))
      const edgeRows = db.prepare('SELECT parent_id, role, child_id FROM cave_edge').all() as
        { parent_id: string, role: Canonical.EdgeRole, child_id: string }[]
      const seen = new Set<string>()
      const edges = edgeRows.flatMap(edge => {
        const parent = resolve(edge.parent_id)
        const child = resolve(edge.child_id)
        if (parent === undefined || child === undefined || parent === child) {
          return []
        }
        const dedupe = `${parent}|${edge.role}|${child}`
        if (seen.has(dedupe)) {
          return []
        }
        seen.add(dedupe)
        return [{ parent, role: edge.role, child }]
      })
      return Canonical.emit({ claims, edges })
    },

    close(): void {
      db.close()
    }
  }
}
