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
 *   lines via FTS5;
 * - appends can stamp actor provenance (spec §9.5): pass `source` and every
 *   claim without a `src:` context gets `@src:<actor>` — applied before the
 *   claim key is computed, so different actors keep separate belief series.
 */

import { DatabaseSync } from 'node:sqlite'
import { Claim, Context, Key, Uuidv7, Verb } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import * as Row from './row.ts'
import * as Schema from './schema.ts'

const currentSql = `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

/**
 * Alias closure (spec §13.6): current positive `ALIAS` claims as undirected
 * edges (`ALIAS` has no `REVERSE`, so each written direction is its own
 * claim key — both assert the same link), walked recursively from a seed
 * entity. Retraction unmerges: `a ALIAS b @ 0%` drops that direction's edge.
 * The seed is the query's single positional parameter.
 */
const aliasClosureSql = `
WITH RECURSIVE alias_edge(a, b) AS (
  SELECT c.subject, c.object FROM (${currentSql}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
  UNION
  SELECT c.object, c.subject FROM (${currentSql}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
), alias_closure(name) AS (
  SELECT ?
  UNION
  SELECT e.b FROM alias_closure s JOIN alias_edge e ON e.a = s.name
)
`

export type IngestResult = {
  /** ids of inserted claim rows, in document order. */
  readonly ids: readonly string[]
  readonly edges: number
  readonly problems: readonly Canonical.Problem[]
}

export type AppendOptions = {
  /**
   * Actor provenance (spec §9.5): stamp `@src:<source>` on every appended
   * claim that carries no `src:` context — e.g. `cli`, `agent/claude-code`,
   * `ingest/93a01c626b3f`. Applied before the claim key is computed, so the
   * stamp is part of claim identity; claims that already name a source keep
   * it untouched. Omit for interchange replay (`cave import`), which must
   * preserve claim keys as exported.
   */
  readonly source?: string
}

/** Stamps `@src:<source>` on a claim without a source context (spec §9.5). */
const stampSource = (claim: Claim.t, source: undefined | string): Claim.t =>
  source === undefined || Context.hasSource(claim.contexts) ?
    claim :
    { ...claim, contexts: [...claim.contexts, Context.source(source)] }

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
  /**
   * Match the entity through its alias closure — every name linked by
   * current positive `ALIAS` claims (spec §13.6, default `false`).
   * Union-of-rows: matching widens, returned rows keep their stored names.
   */
  readonly aliases?: boolean
}

export type Store = ReturnType<typeof open>

/**
 * Database path used by CLI surfaces when `--db` is omitted: the `CAVE_DB`
 * environment variable, falling back to `cave.db` in the current directory.
 * Read at call time so tests (and long-lived processes) can change the
 * environment.
 */
export const defaultDbPath = (): string =>
  process.env['CAVE_DB'] ?? 'cave.db'

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
   * mirroring `@cavelang/canonical`'s `applyDeclarations` predicate exactly —
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

  /**
   * Savepoint-based, so transactions nest: a caller can wrap several
   * appends — or an append plus checks against the appended state — and
   * roll the whole group back by throwing (spec §20.3 write gating).
   * Rollback also restores the in-memory verb registry, so declarations
   * from rolled-back claims don't outlive their rows.
   */
  let transactionDepth = 0
  const transaction = <T>(body: () => T): T => {
    const savepoint = `cave_tx_${transactionDepth}`
    transactionDepth += 1
    const savedRegistry = registry
    db.exec(`SAVEPOINT ${savepoint}`)
    try {
      const result = body()
      db.exec(`RELEASE ${savepoint}`)
      return result
    } catch (error) {
      db.exec(`ROLLBACK TO ${savepoint}`)
      db.exec(`RELEASE ${savepoint}`)
      registry = savedRegistry
      throw error
    } finally {
      transactionDepth -= 1
    }
  }

  /** Appends a canonicalization result — one row per claim, per-row tx. */
  const insertResult = (result: Canonical.Result, options_: AppendOptions = {}): IngestResult =>
    transaction(() => {
      const ids: string[] = []
      for (const entry of result.claims) {
        const claim = stampSource(entry.claim, options_.source)
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

  /**
   * Entity-matching fragment for one traversal endpoint: exact by default,
   * `IN` the alias closure when opted in. Either form consumes exactly one
   * positional parameter — the closure seeds from it (`aliasClosureSql`
   * must be prepended when `aliases` is set).
   */
  const entityMatch = (column: string, options: TraverseOptions): string =>
    options.aliases === true ? `${column} IN (SELECT name FROM alias_closure)` : `${column} = ?`

  const withAliases = (options: TraverseOptions): string =>
    options.aliases === true ? aliasClosureSql : ''

  return {
    /** Raw database handle — used by `@cavelang/query`; treat as read-only. */
    db,

    /** Current verb registry (input registry + stored + ingested declarations). */
    registry: (): Canonical.Registry.t => registry,

    /**
     * Runs `body` atomically; throwing rolls everything back, including
     * nested appends and their registry declarations. Nestable
     * (savepoints) — the write gate wraps ingest + check in one of these
     * (spec §20.3).
     */
    transaction,

    /**
     * Parses, canonicalizes and appends CAVE text. Lenient by default —
     * problems are returned, valid lines still land (spec §1.6); pass
     * `strict` to throw instead, `source` to stamp actor provenance
     * (spec §9.5).
     */
    ingest(text: string, options_: { strict?: boolean } & AppendOptions = {}): IngestResult {
      const result = Canonical.canonicalizeText(text, registry)
      if (options_.strict === true && result.problems.length > 0) {
        const detail = result.problems.map(problem => `  line ${problem.line}: ${problem.message}`).join('\n')
        throw new Error(`CAVE ingest failed with ${result.problems.length} problem(s):\n${detail}`)
      }
      return insertResult(result, options_)
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

    /**
     * The alias closure of an entity (spec §13.6): the entity itself plus
     * every name reachable through current positive `ALIAS` claims, read as
     * undirected edges. Unmerge is retraction — appending `a ALIAS b @ 0%`
     * removes that link. The queried name first, the rest sorted.
     */
    aliasesOf(entity: string): string[] {
      const names = db.prepare(`${aliasClosureSql} SELECT name FROM alias_closure WHERE name <> ? ORDER BY name`)
        .all(entity, entity) as { name: string }[]
      return [entity, ...names.map(row => row.name)]
    },

    /** All rows about an entity, both directions, newest first (spec §13.5). */
    claimsAbout(entity: string, options_: { aliases?: boolean } = {}): Row.t[] {
      return options_.aliases === true ?
        rows(
          `${aliasClosureSql} SELECT * FROM cave_claim
           WHERE subject IN (SELECT name FROM alias_closure) OR object IN (SELECT name FROM alias_closure)
           ORDER BY tx DESC`,
          entity
        ) :
        rows('SELECT * FROM cave_claim WHERE subject = ? OR object = ? ORDER BY tx DESC', entity, entity)
    },

    /** Forward reads: current relational facts with `entity` as subject (spec §13.3). */
    forward(entity: string, options_: TraverseOptions = {}): ForwardFact[] {
      return rows(
        `${withAliases(options_)} SELECT * FROM (${currentSql}) WHERE ${entityMatch('subject', options_)} AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
        entity
      ).map(row => ({ verb: row.verb, target: row.object!, row }))
    },

    /**
     * Inverse reads (spec §13.3): current relational facts
     * with `entity` as object, relation named via the registry's inverse
     * when one is declared.
     */
    reverse(entity: string, options_: TraverseOptions = {}): ReverseFact[] {
      return rows(
        `${withAliases(options_)} SELECT * FROM (${currentSql}) WHERE ${entityMatch('object', options_)} AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
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
        `${withAliases(options_)} SELECT * FROM (${currentSql}) WHERE ${entityMatch('subject', options_)} AND verb = 'CONTAINS' AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
        topic
      ).map(row => row.object!)
    },

    /** Topics containing an entity — the inverse `CONTAINS` read (spec §11.2). */
    topicsOf(entity: string, options_: TraverseOptions = {}): string[] {
      return rows(
        `${withAliases(options_)} SELECT * FROM (${currentSql}) WHERE ${entityMatch('object', options_)} AND verb = 'CONTAINS'${traversalFilter(options_)} ORDER BY tx`,
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

    /**
     * Appends edges between *existing* claim rows (spec §13.2) — the
     * derivation-lineage path (§24.3): a derived row points `BECAUSE` at
     * the specific premise rows that fired and `VIA` at the rule's
     * declaration row. `insertResult` covers edges within one appended
     * batch; this covers edges into rows that are already stored. Foreign
     * keys reject unknown ids.
     */
    appendEdges(edges: readonly { parentId: string, role: Canonical.EdgeRole, childId: string }[]): void {
      transaction(() => {
        for (const edge of edges) {
          insertEdge.run(edge.parentId, edge.role, edge.childId)
        }
      })
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
