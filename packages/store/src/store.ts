/**
 * The CAVE store (spec §13) — append-only claim persistence on the Node.js
 * builtin `node:sqlite`.
 *
 * - one row per fact, canonical direction; inverses are query-time views
 *   over existing indexes, never materialized rows (spec §13.3);
 * - current belief = latest tx per claim key (spec §9.1, §13.5);
 * - the verb registry is rebuilt from stored in-band declaration claims on
 *   open, so a reopened database keeps its inverse and lifecycle vocabulary;
 * - full-text search over subjects, objects, values, comments and raw
 *   lines via FTS5;
 * - appends can stamp actor provenance (spec §9.5): pass `source` and every
 *   claim without a `src:` context gets `@src:<actor>` — applied before the
 *   claim key is computed, so different actors keep separate belief series;
 * - contradiction resolution (spec §26): coexisting series about one fact
 *   resolve to one winner by precedence class, reliability-weighted
 *   confidence and tx — `resolvedBeliefs`, `contested`, and the `resolve`
 *   traversal opt-in.
 */

import { DatabaseSync } from 'node:sqlite'
import { Claim, Context, Key, Uuidv7, Verb } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import * as Resolve from './resolve.ts'
import * as Row from './row.ts'
import * as Schema from './schema.ts'
import * as Sensitivity from './sensitivity.ts'

const currentSql = `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

/**
 * Alias edges (spec §13.6): current positive `ALIAS` claims read as
 * undirected (`ALIAS` has no `REVERSE`, so each written direction is its
 * own claim key — both assert the same link). Retraction unmerges:
 * `a ALIAS b @ 0%` drops that direction's edge. Both endpoints must be
 * entity-form — the closure is defined for entity terms only, so a row
 * naming a `"…"`/`` `…` `` literal contributes no edge and two entities
 * aliasing one literal never link through it.
 */
const aliasEdgeSql = `alias_edge(a, b) AS (
  SELECT c.subject, c.object FROM (${currentSql}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
    AND ${Row.entityTermSql('c.subject')} AND ${Row.entityTermSql('c.object')}
  UNION
  SELECT c.object, c.subject FROM (${currentSql}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
    AND ${Row.entityTermSql('c.subject')} AND ${Row.entityTermSql('c.object')}
)`

/**
 * The closure walked from a seed entity — the seed is the query's first
 * positional parameter. Requires `alias_edge` in scope.
 */
const aliasSeedSql = `alias_closure(name) AS (
  SELECT ?
  UNION
  SELECT e.b FROM alias_closure s JOIN alias_edge e ON e.a = s.name
)`

/**
 * The full transitive closure as ordered pairs — every two names currently
 * believed to denote one entity. Resolution grouping widens through it
 * (spec §26.1). Requires `alias_edge` in scope.
 */
const aliasPairSql = `alias_pair(a, b) AS (
  SELECT a, b FROM alias_edge
  UNION
  SELECT p.a, e.b FROM alias_pair p JOIN alias_edge e ON e.a = p.b
)`

/** Seeded alias closure (spec §13.6), ready to prefix a SELECT. */
const aliasClosureSql = `
WITH RECURSIVE ${aliasEdgeSql}, ${aliasSeedSql}
`

export type IngestResult = {
  /** ids of the batch's claim rows, in document order — for a row skipped as already present (`ids` replay, spec §28.1), the existing id. */
  readonly ids: readonly string[]
  /** Edges actually inserted (an identity replay skips edges already stored). */
  readonly edges: number
  /** Rows skipped because their explicit id already exists (spec §28.1); always 0 without `ids`. */
  readonly skipped: number
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
  /**
   * Lifecycle stamping (spec §9.5): stamp `@src:<source>` even when the
   * claim already names a source. Connect records, rule conclusions and
   * action effects are found for retraction and attribution by their
   * stamp, so an authored `src:` context must not displace it — both are
   * kept (multi-source rows resolve per §26.3). The exact stamp context
   * is never duplicated. Without this flag an authored source suppresses
   * the stamp.
   */
  readonly lifecycle?: boolean
  /**
   * Explicit row identity (spec §28.1), index-aligned with the result's
   * claims: a claim with an id here is replayed under it — inserted with
   * `id = tx = ids[i]` when absent, skipped when the store already has the
   * row — and the generator observes it (spec §28.2). Claims without an
   * entry mint fresh ids as usual. Edges deduplicate against stored edges
   * in this mode, so replaying a sync export is idempotent end to end.
   */
  readonly ids?: readonly (undefined | string)[]
}

/**
 * Stamps `@src:<source>` on a claim without a source context (spec §9.5);
 * with `lifecycle`, on any claim not already carrying that exact stamp.
 */
const stampSource = (claim: Claim.t, source: undefined | string, lifecycle: boolean): Claim.t => {
  if (source === undefined) {
    return claim
  }
  const context = Context.source(source)
  return claim.contexts.includes(context) || (!lifecycle && Context.hasSource(claim.contexts)) ?
    claim :
    { ...claim, contexts: [...claim.contexts, context] }
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
  /**
   * Match the entity through its alias closure — every name linked by
   * current positive `ALIAS` claims (spec §13.6, default `false`).
   * Union-of-rows: matching widens, returned rows keep their stored names.
   */
  readonly aliases?: boolean
  /**
   * Traverse resolved winners only (spec §26, default `false`): when
   * several series assert one fact — actor stamps, content sources,
   * polarity — the resolution policy picks one and the rest are
   * invisible. Composes with `aliases`, which widens resolution groups
   * through the closure.
   */
  readonly resolve?: boolean
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
  // Concurrent writers wait for the database allocation lock instead of
  // failing immediately with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  Schema.init(db)

  // The receive rule (spec §28.2): the store, not the wall clock, is the
  // monotonic authority — every append outsorts every tx already stored,
  // merged history from fast-clocked origins included.
  const selectMaxTx = db.prepare('SELECT MAX(tx) AS tx FROM cave_claim')
  const observeMaxTx = (): void => {
    const maxTx = selectMaxTx.get() as undefined | { tx: null | string }
    if (maxTx?.tx != null) {
      Uuidv7.observe(maxTx.tx)
    }
  }
  observeMaxTx()

  const baseRegistry = options.registry ?? Canonical.standardRegistry
  let registry = baseRegistry

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
      WHERE negated = 0 AND object IS NOT NULL AND verb IN ('REVERSE', 'RENAMED-TO', 'IS')
        AND id NOT IN (SELECT child_id FROM cave_edge WHERE role IN ('WHEN', 'VIA', 'BECAUSE'))
      ORDER BY tx
    `).all() as { subject: string, verb: string, object: string }[]
    for (const declaration of declarations) {
      if (!Verb.isVerbToken(declaration.subject)) {
        continue
      }
      if (declaration.verb === 'REVERSE' && Verb.isVerbToken(declaration.object)) {
        registry = Canonical.Registry.declareReverse(registry, declaration.subject, declaration.object).registry
      } else if (declaration.verb === 'RENAMED-TO' && Verb.isVerbToken(declaration.object)) {
        registry = Canonical.Registry.declareRename(registry, declaration.subject, declaration.object).registry
      } else if (declaration.verb === 'IS' && declaration.object === 'verb') {
        registry = Canonical.Registry.declareVerb(registry, declaration.subject)
      }
    }
  }
  rebuildRegistry()

  /**
   * The outer transaction takes SQLite's write-reservation lock before any
   * transaction id is allocated, serializing concurrent processes. Nested
   * transactions use savepoints, so a caller can still wrap several appends
   * and checks and roll the group back by throwing (spec §20.3 write gating).
   * Rollback also restores the in-memory verb registry.
   */
  let transactionDepth = 0
  const transaction = <T>(body: () => T): T => {
    const outer = transactionDepth === 0
    const savepoint = `cave_tx_${transactionDepth}`
    transactionDepth += 1
    const savedRegistry = registry
    let started = false
    try {
      db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
      started = true
      const result = body()
      db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`)
      return result
    } catch (error) {
      if (started) {
        if (outer) {
          db.exec('ROLLBACK')
        } else {
          db.exec(`ROLLBACK TO ${savepoint}`)
          db.exec(`RELEASE ${savepoint}`)
        }
      }
      registry = savedRegistry
      throw error
    } finally {
      transactionDepth -= 1
    }
  }

  const claimExists = db.prepare('SELECT 1 FROM cave_claim WHERE id = ?')
  const edgeExists = db.prepare('SELECT 1 FROM cave_edge WHERE parent_id = ? AND role = ? AND child_id = ?')

  /** Appends a canonicalization result — one row per claim, per-row tx. */
  const insertResult = (result: Canonical.Result, options_: AppendOptions = {}): IngestResult =>
    transaction(() => {
      const ids: string[] = []
      const replay = options_.ids !== undefined
      let skipped = 0
      // BEGIN IMMEDIATE makes this read and all following inserts one
      // database-serialized allocation step. A process that opened before a
      // fast-clock peer wrote now observes that peer before minting (§28.2).
      if (result.claims.some((_, index) => options_.ids?.[index] === undefined)) {
        observeMaxTx()
      }
      result.claims.forEach((entry, index) => {
        const explicit = options_.ids?.[index]
        if (explicit !== undefined) {
          // Identity replay (spec §28.1): the id is the row — present means
          // merged already; either way subsequent mints outsort it (§28.2).
          Uuidv7.observe(explicit)
          if (claimExists.get(explicit) !== undefined) {
            skipped += 1
            ids.push(explicit)
            return
          }
        }
        const claim = stampSource(entry.claim, options_.source, options_.lifecycle === true)
        const id = explicit ?? Uuidv7.next()
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
      })
      let edges = 0
      for (const edge of result.edges) {
        const parentId = ids[edge.parent]!
        const childId = ids[edge.child]!
        if (replay && edgeExists.get(parentId, edge.role, childId) !== undefined) {
          continue
        }
        insertEdge.run(parentId, edge.role, childId)
        edges += 1
      }
      registry = result.registry
      return { ids, edges, skipped, problems: result.problems }
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
    options.aliases === true ?
      // Resolution grouping needs the pair closure too (spec §26.1).
      (options.resolve === true ?
        `\nWITH RECURSIVE ${aliasEdgeSql}, ${aliasPairSql}, ${aliasSeedSql}\n` :
        aliasClosureSql) :
      ''

  const readPolicy = (): Resolve.Entry[] =>
    Resolve.readPolicy(db, currentSql)

  /**
   * Row universe of a traversal: current beliefs, or the §26 resolved
   * winners among them when `resolve` is set.
   */
  const universe = (options: TraverseOptions): string =>
    options.resolve === true ?
      Resolve.resolvedSql(readPolicy(), currentSql, { aliases: options.aliases === true }) :
      currentSql

  return {
    /** Raw database handle — used by `@cavelang/query`; treat as read-only. */
    db,

    /** Current verb registry (input registry + stored + ingested declarations). */
    registry: (): Canonical.Registry.t => registry,

    /** Configured registry before any in-band declarations are applied. */
    baseRegistry: (): Canonical.Registry.t => baseRegistry,

    /**
     * Rebuilds the registry from the base plus stored declarations — after
     * rows arrive outside `ingest`/`insertResult` (a §28 merge writes
     * through SQL), merged in-band declarations take effect without
     * reopening.
     */
    reloadRegistry(): void {
      registry = baseRegistry
      rebuildRegistry()
    },

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
     * The effective resolution policy (spec §26.3): the built-in ladder
     * merged with current in-band `source[/<path>] HAS precedence:` /
     * `HAS reliability:` declarations, sorted by prefix.
     */
    resolutionPolicy(): Resolve.Entry[] {
      return readPolicy()
    },

    /**
     * Resolved current beliefs (spec §26): one winner per resolution
     * group — coexisting series about one fact (actor stamps, content
     * sources, polarity) collapse to the row the policy picks; the rest
     * are invisible. Oldest first, rows returned verbatim. With
     * `aliases`, groups widen through the alias closure (spec §26.1).
     */
    resolvedBeliefs(options_: { aliases?: boolean } = {}): Row.t[] {
      const aliases = options_.aliases === true
      const prefix = aliases ? `WITH RECURSIVE ${aliasEdgeSql}, ${aliasPairSql}\n` : ''
      return rows(`${prefix}SELECT * FROM (${Resolve.resolvedSql(readPolicy(), currentSql, { aliases })}) ORDER BY tx`)
    },

    /**
     * Contested facts (spec §26.4): resolution groups where more than one
     * candidate currently speaks, each candidate scored (`res_class`,
     * `res_conf`) and ranked — the winner first. The feed for fusion
     * (§10.1 combines a contested group's numeric estimates instead of
     * picking) and for the `cave resolve` view.
     */
    contested(options_: { aliases?: boolean } = {}): Resolve.Contested[] {
      const aliases = options_.aliases === true
      const prefix = aliases ? `WITH RECURSIVE ${aliasEdgeSql}, ${aliasPairSql}\n` : ''
      const ranked = rows(
        `${prefix}SELECT * FROM (${Resolve.rankedSql(readPolicy(), currentSql, { aliases })}) ORDER BY res_group, res_rank`
      ) as Resolve.Ranked[]
      const groups: { group: string, rows: Resolve.Ranked[] }[] = []
      for (const row of ranked) {
        const last = groups[groups.length - 1]
        if (last !== undefined && last.group === row.res_group) {
          last.rows.push(row)
        } else {
          groups.push({ group: row.res_group, rows: [row] })
        }
      }
      return groups.filter(group => group.rows.length > 1)
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
        `${withAliases(options_)} SELECT * FROM (${universe(options_)}) WHERE ${entityMatch('subject', options_)} AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
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
        `${withAliases(options_)} SELECT * FROM (${universe(options_)}) WHERE ${entityMatch('object', options_)} AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
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
        `${withAliases(options_)} SELECT * FROM (${universe(options_)}) WHERE ${entityMatch('subject', options_)} AND verb = 'CONTAINS' AND object IS NOT NULL${traversalFilter(options_)} ORDER BY tx`,
        topic
      ).map(row => row.object!)
    },

    /** Topics containing an entity — the inverse `CONTAINS` read (spec §11.2). */
    topicsOf(entity: string, options_: TraverseOptions = {}): string[] {
      return rows(
        `${withAliases(options_)} SELECT * FROM (${universe(options_)}) WHERE ${entityMatch('object', options_)} AND verb = 'CONTAINS'${traversalFilter(options_)} ORDER BY tx`,
        entity
      ).map(row => row.subject)
    },

    /**
     * Full-text search, newest first. The query is treated as a literal
     * phrase by default (safe for terms like `token-expiry`, which FTS5
     * would otherwise parse as a column filter); pass `raw` to use full
     * FTS5 MATCH syntax. `limit` caps the rows inside the query itself,
     * so a broad search never materializes more than the caller reads.
     */
    search(query: string, options_: { raw?: boolean, limit?: number, maxSensitivity?: Sensitivity.Level } = {}): Row.t[] {
      const match = options_.raw === true ? query : `"${query.replaceAll('"', '""')}"`
      const sql = `
        SELECT c.* FROM cave_claim c JOIN cave_fts f ON c.id = f.claim_id
        WHERE cave_fts MATCH ?${options_.maxSensitivity === undefined ? '' : ` AND ${Sensitivity.sql('c', options_.maxSensitivity)}`}
        ORDER BY c.tx DESC`
      return options_.limit === undefined ?
        rows(sql, match) :
        rows(`${sql} LIMIT ?`, match, options_.limit)
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
     * order, or only current beliefs with `current`. With `tx`, every
     * claim line is preceded by its §28.4 transaction annotation
     * (`;@ <tx>`), so the text carries row identity: `cave sync` replays
     * it idempotently, plain `cave import` reads it unchanged.
     *
     * In current-only export an edge endpoint may be a superseded row;
     * dropping such edges would silently un-condition current claims and
     * promote orphaned WHEN conditions to top-level facts. Instead each
     * endpoint resolves to the *current row of its claim key*, and the
     * resulting edges are deduplicated.
     */
    exportText(options_: { current?: boolean, tx?: boolean, maxSensitivity?: Sensitivity.Level } = {}): string {
      const current = options_.current === true
      const maximum = options_.maxSensitivity ?? Sensitivity.defaultMaximum
      const claimRows = current ?
        rows(`${currentSql} WHERE ${Sensitivity.sql('c', maximum)} ORDER BY c.tx`) :
        rows(`SELECT c.* FROM cave_claim c WHERE ${Sensitivity.sql('c', maximum)} ORDER BY c.tx`)
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
      return Canonical.emit(
        { claims, edges },
        options_.tx === true ? { annotate: index => Canonical.txComment(claimRows[index]!.tx) } : {}
      )
    },

    close(): void {
      db.close()
    }
  }
}
