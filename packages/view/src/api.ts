/**
 * View models (spec §30.2) — pure reads from a store into the JSON the
 * page renders. Every function here is a read; nothing in this package
 * ever writes. Semantics are the ones defined elsewhere: current belief
 * is §9.1's latest-tx, the belief series is §9.1's history, lineage is
 * the §13.2/§24.3 edge table, health is the §20.2 report — the view
 * renders them, it never reinterprets them.
 *
 * Claims are returned *structured* (subject, verb, payload, contexts,
 * tags as columns), not re-parsed from text: the page renders and links
 * from row data, so no second grammar exists to drift out of sync, and
 * `line` keeps the claim as authored for the places text is the point.
 */

import { maximumSensitivity } from './sensitivity.ts'
import { Key, SourceSpan, Uuidv7, Verb, Version } from '@cavelang/core'
import type { SourceReference } from '@cavelang/core'
import { check, defaultStaleDays } from '@cavelang/shape'
import { QuerySql, Row, Sensitivity } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { readSnapshot, withScopedStore } from './scope.ts'

const currentSql = QuerySql.current()

/** One claim row, shaped for rendering (spec §30.2). */
export type ClaimView = {
  readonly id: string
  readonly tx: string
  /** ISO-8601 timestamp decoded from the tx UUIDv7. */
  readonly at: string
  readonly subject: string
  readonly verb: string
  readonly negated: boolean
  readonly object?: string
  readonly attribute?: string
  /** Value as written (`~20B USD/yr`), attribute and metric payloads. */
  readonly value?: string
  readonly delta?: string
  /** Non-default sigma level; omitted means the semantic default of 2. */
  readonly sigmaLevel?: number
  readonly conf: number
  readonly importance: boolean
  readonly comment?: string
  /** Context strings as stored (`src:cli`, `production`) — no `@` prefix. */
  readonly contexts: readonly string[]
  /** Parsed source identities and line links (spec §9.8). */
  readonly sources: readonly SourceReference[]
  readonly tags: readonly { readonly key: string, readonly value?: string }[]
  /** The claim key — the fact whose belief series this row belongs to (§9.2). */
  readonly key: string
  /** The line as authored. */
  readonly line: string
  /** Rows this row cites (outgoing BECAUSE/VIA/WHEN… edges, §13.2). */
  readonly cites: number
  /** Rows citing this row (incoming edges) — its dependents. */
  readonly citedBy: number
}

export type Options = {
  /** Match entities through the §13.6 alias closure (default `false`). */
  readonly aliases?: boolean
  /** Highest sensitivity level allowed to leave the store (default `internal`, spec §9.7). */
  readonly maxSensitivity?: Sensitivity.Level
}

const maximumOf = (options: { maxSensitivity?: Sensitivity.Level }): Sensitivity.Level =>
  maximumSensitivity(options.maxSensitivity)

const aliasesOf = (value: unknown): boolean => {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError('aliases must be a boolean')
  return value
}

const rows = (store: Store, sql: string, ...params: (string | number)[]): Row.t[] =>
  store.db.prepare(sql).all(...params) as unknown as Row.t[]

const viewMapper = (store: Store, maximum?: Sensitivity.Level): ((row: Row.t) => ClaimView) => {
  const contextsQuery = store.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?')
  const tagsQuery = store.db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ?')
  const visibleChild = maximum === undefined ? '' :
    ` JOIN cave_claim visible ON visible.id = cave_edge.child_id AND ${Sensitivity.sql('visible', maximum)}`
  const visibleParent = maximum === undefined ? '' :
    ` JOIN cave_claim visible ON visible.id = cave_edge.parent_id AND ${Sensitivity.sql('visible', maximum)}`
  const citesQuery = store.db.prepare(`SELECT COUNT(*) AS n FROM cave_edge${visibleChild} WHERE parent_id = ?`)
  const citedByQuery = store.db.prepare(`SELECT COUNT(*) AS n FROM cave_edge${visibleParent} WHERE child_id = ?`)
  return row => {
    // Validate primary fields before shaping raw columns, including search paths
    // that do not otherwise reconstruct a claim. Metadata is fetched below.
    const claim = Row.toClaim(row, [], [])
    if (typeof row.id !== 'string' || !Uuidv7.is(row.id) || row.tx !== row.id) {
      throw new Error(`CAVE view failed for claim ${row.id}: stored transaction identity must be a canonical lowercase UUIDv7 with id = tx`)
    }
    const contexts = (contextsQuery.all(row.id) as
      { context: string }[]).map(entry => entry.context)
    if (Key.of({ ...claim, contexts }) !== row.claim_key) {
      throw new Error(`CAVE view failed for claim ${row.id}: stored claim key does not agree with its semantic identity`)
    }
    const tags = (tagsQuery.all(row.id) as
      { key: string, value: null | string }[])
      .map(tag => {
        // SQLite TEXT affinity still permits blobs. Keep the JSON contract
        // explicit instead of returning binary objects as tag strings.
        if (typeof tag.key !== 'string') {
          throw new Error(`CAVE view failed for claim ${row.id}: stored tag key must be a string`)
        }
        if (tag.value !== null && typeof tag.value !== 'string') {
          throw new Error(`CAVE view failed for claim ${row.id}: stored tag value must be a string or null`)
        }
        return tag.value === null ? { key: tag.key } : { key: tag.key, value: tag.value }
      })
    const cites = (citesQuery.get(row.id) as { n: number }).n
    const citedBy = (citedByQuery.get(row.id) as { n: number }).n
    return {
      id: row.id,
      tx: row.tx,
      at: new Date(Uuidv7.msOf(row.tx)).toISOString(),
      subject: row.subject,
      verb: row.verb,
      negated: row.negated !== 0,
      ...row.object === null ? {} : { object: row.object },
      ...row.attribute === null ? {} : { attribute: row.attribute },
      ...row.value_text === null ? {} : { value: row.value_text },
      ...row.delta_text === null ? {} : { delta: row.delta_text },
      ...row.sigma_level === null || row.sigma_level === 2 ? {} : { sigmaLevel: row.sigma_level },
      conf: row.conf,
      importance: row.importance !== 0,
      ...row.comment === null ? {} : { comment: row.comment },
      contexts,
      sources: SourceSpan.ofContexts(contexts),
      tags,
      key: row.claim_key,
      line: row.raw_line,
      cites,
      citedBy
    }
  }
}

const toView = (store: Store, row: Row.t, maximum?: Sensitivity.Level): ClaimView =>
  viewMapper(store, maximum)(row)

const views = (store: Store, list: readonly Row.t[], maximum?: Sensitivity.Level): ClaimView[] =>
  list.length === 0 ? [] : list.map(viewMapper(store, maximum))

/** Entity test mirroring §20.2's: not a verb token, not a stored literal. */
const isEntityName = (name: string): boolean =>
  !Verb.isVerbToken(name) && !name.startsWith('"') && !name.startsWith('`')

export type Topic = {
  readonly name: string
  /** Current positive `CONTAINS` members (spec §11.2). */
  readonly members: number
}

/** Topics — subjects of current positive `CONTAINS` claims, largest first. */
const topicsRaw = (store: Store): Topic[] =>
  (store.db.prepare(`
    SELECT c.subject AS name, COUNT(*) AS members FROM (${currentSql}) c
    WHERE c.verb = 'CONTAINS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
    GROUP BY c.subject ORDER BY members DESC, name
  `).all() as { name: string, members: number }[])
    .filter(topic => isEntityName(topic.name))
    .map(({ name, members }) => ({ name, members }))

export const topics = (store: Store, options: Pick<Options, 'maxSensitivity'> = {}): Topic[] =>
  withScopedStore(store, maximumOf(options), topicsRaw)

/** A §20.2 section capped for the page, with the uncapped count. */
export type Capped<T> = {
  readonly total: number
  readonly items: readonly T[]
}

const cap = <T, U>(list: readonly T[], limit: number, map: (item: T) => U): Capped<U> =>
  ({ total: list.length, items: list.slice(0, limit).map(map) })

export type Overview = {
  readonly version: string
  /** The §20.2 coverage stats verbatim. */
  readonly coverage: ReturnType<typeof check>['coverage']
  readonly violations: Capped<{
    readonly entity: string
    readonly via: string
    readonly kind: string
    readonly name: string
    readonly type: string
    readonly cardinality: 'some' | 'one'
    readonly unit?: string
    readonly actualCount: number
    readonly actualUnits: readonly (string | null)[]
  }>
  readonly stale: Capped<{ readonly ageDays: number, readonly row: ClaimView }>
  readonly review: Capped<ClaimView>
  readonly disagreements: Capped<{ readonly kind: string, readonly about: string, readonly entities: readonly string[], readonly rows: readonly ClaimView[] }>
  readonly topics: readonly Topic[]
  readonly recent: readonly ClaimView[]
}

/**
 * The dashboard (spec §30.2): §20.2 coverage and frontier — violations,
 * review candidates, stale beliefs, alias disagreements — plus topics
 * and the latest appends. Long sections are capped (the report is the
 * uncapped surface); `total` counts what the store has.
 */
export const overview = (store: Store, options: { staleDays?: number, recent?: number, limit?: number, maxSensitivity?: Sensitivity.Level } = {}): Overview => {
  const { limit = 100, recent: recentLimit = 30, staleDays = defaultStaleDays } = options
  for (const [name, value] of [['limit', limit], ['recent', recentLimit]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`)
    }
  }
  if (!Number.isFinite(staleDays) || staleDays < 0) {
    throw new TypeError('staleDays must be finite and non-negative')
  }
  return withScopedStore(store, maximumOf(options), scoped => {
  const report = check(scoped, { staleDays })
  const recent = rows(scoped, 'SELECT * FROM cave_claim ORDER BY tx DESC LIMIT ?', recentLimit)
  return {
    version: Version.current(),
    coverage: report.coverage,
    violations: cap(report.violations, limit, violation => ({
      entity: violation.entity,
      via: violation.via,
      kind: violation.expectation.kind,
      name: violation.expectation.name,
      type: violation.expectation.type,
      cardinality: violation.expectation.cardinality,
      ...violation.expectation.unit === undefined ? {} : { unit: violation.expectation.unit },
      actualCount: violation.actualCount,
      actualUnits: violation.actualUnits
    })),
    stale: cap(report.stale, limit, stale => ({ ageDays: stale.ageDays, row: toView(scoped, stale.row) })),
    review: cap(report.review, limit, row => toView(scoped, row)),
    disagreements: cap(report.disagreements, limit, disagreement => ({
      kind: disagreement.kind,
      about: disagreement.about,
      entities: disagreement.entities,
      rows: views(scoped, disagreement.rows)
    })),
    topics: topicsRaw(scoped),
    recent: views(scoped, recent)
  }
  })
}

export type Entity = {
  readonly name: string
  /** The §13.6 closure — the name itself first; length 1 means no aliases. */
  readonly aliases: readonly string[]
  /** Objects of current positive `IS` claims — what the entity is typed as (§20.1's binding surface). */
  readonly types: readonly string[]
  /** Current attribute / metric / existence claims (object-less payloads). */
  readonly facts: readonly ClaimView[]
  /** Current relations with the entity as subject, negated included. */
  readonly out: readonly ClaimView[]
  /** Current relations with the entity as object — each with the declared inverse name when one exists (§13.3). */
  readonly in: readonly (ClaimView & { readonly rel?: string })[]
  /** Topics containing the entity (spec §11.2). */
  readonly topics: readonly string[]
  /** All rows about the entity, ever. */
  readonly total: number
  /** The newest rows about it — superseded and retracted included. */
  readonly activity: readonly ClaimView[]
}

/**
 * Entity 360 (spec §30.2): everything the store currently believes about
 * one name — object-less facts, both relation directions, topics and the
 * alias closure — plus the raw activity feed underneath. Negated current
 * claims are shown (they are knowledge); retracted ones only appear in
 * the activity feed and in each fact's own history.
 */
export const entity = (store: Store, name: string, options: Options & { activity?: number } = {}): Entity => {
  const maximum = maximumOf(options)
  const useAliases = aliasesOf(options.aliases)
  const { activity = 30 } = options
  if (!Number.isSafeInteger(activity) || activity < 0) {
    throw new TypeError('activity must be a non-negative safe integer')
  }
  return withScopedStore(store, maximum, scoped => {
  const aliases = useAliases ? scoped.aliasesOf(name) : [name]
  const facts = rows(scoped, `
    ${useAliases ? QuerySql.aliasClosure(currentSql) : ''}
    SELECT c.* FROM (${currentSql}) c
    WHERE ${useAliases ? 'c.subject IN (SELECT name FROM alias_closure)' : 'c.subject = ?'}
      AND c.object IS NULL AND c.conf > 0
    ORDER BY c.verb, c.attribute, c.tx
  `, name)
  const traverse = { negated: true, ...useAliases ? { aliases: true } : {} }
  const about = scoped.claimsAbout(name, traverse)
  const out = scoped.forward(name, traverse).map(fact => fact.row)
  return {
    name,
    aliases,
    types: [...new Set(out.filter(row => row.verb === 'IS' && row.negated === 0).map(row => row.object!))],
    facts: views(scoped, facts),
    out: views(scoped, out),
    in: scoped.reverse(name, traverse).map(fact =>
      ({ ...toView(scoped, fact.row), ...fact.rel === undefined ? {} : { rel: fact.rel } })),
    topics: scoped.topicsOf(name, traverse),
    total: about.length,
    activity: views(scoped, about.slice(0, activity))
  }
  })
}

export type TopicPage = {
  readonly name: string
  readonly members: readonly string[]
}

/** One topic's members — the forward `CONTAINS` read (spec §11.2). */
export const topic = (store: Store, name: string, options: Options = {}): TopicPage => {
  const maximum = maximumOf(options)
  const aliases = aliasesOf(options.aliases)
  return withScopedStore(store, maximum, scoped =>
    ({ name, members: scoped.topicMembers(name, { aliases }) }))
}

export type History = {
  readonly key: string
  /** Visible belief events, oldest first (spec §9.1); the last may be a retraction. */
  readonly rows: readonly ClaimView[]
}

/** The belief-history timeline of one claim key (spec §30.2). */
export const history = (store: Store, key: string, options: Pick<Options, 'maxSensitivity'> = {}): History =>
  withScopedStore(store, maximumOf(options), scoped =>
    ({ key, rows: views(scoped, scoped.history(key)) }))

/** One node of a lineage tree (spec §30.2). */
export type LineageNode = {
  /** Edge role that reached this row (§13.2) — absent on the root. */
  readonly role?: string
  readonly row: ClaimView
  /**
   * The row already appeared elsewhere in this tree (shared premises,
   * §24.5 support cycles) — re-stated here, children rendered once,
   * the §28.4 convention.
   */
  readonly repeat?: boolean
  /**
   * The row cites (or is cited by) further rows the walk's depth cap
   * cut off — the explanation continues below this node but is not
   * shown; follow the row's own lineage to keep walking. Never set
   * on a genuine leaf.
   */
  readonly truncated?: boolean
  readonly children: readonly LineageNode[]
}

export type Lineage = {
  readonly row: ClaimView
  /** What this row cites, transitively — its BECAUSE/VIA/WHEN sources (§24.3). */
  readonly cites: readonly LineageNode[]
  /** What cites this row, transitively — its dependents. */
  readonly citedBy: readonly LineageNode[]
}

const maxLineageDepth = 16

/**
 * The lineage of one row (spec §30.2): the §13.2 edge table walked both
 * ways. Down answers "why is this believed" — premise rows and the rule
 * behind a §24 derivation, conditions behind a qualified claim; up
 * answers "what depends on this". Edges form a graph; the tree re-states
 * a repeated row without children (`repeat`), so §24.5 cycles terminate.
 * Depth is capped: a node whose further edges the cap cut off is marked
 * `truncated`, so an incomplete explanation never renders as complete.
 */
export const lineage = (store: Store, id: string, options: Pick<Options, 'maxSensitivity'> = {}): undefined | Lineage =>
  withScopedStore(store, maximumOf(options), scoped => {
  store = scoped
  const root = store.db.prepare('SELECT * FROM cave_claim WHERE id = ?').get(id) as undefined | Row.t
  if (root === undefined) {
    return undefined
  }
  const projected = new Map<string, ClaimView>()
  const project = (row: Row.t): ClaimView => {
    const existing = projected.get(row.id)
    if (existing !== undefined) return existing
    const view = toView(store, row)
    projected.set(row.id, view)
    return view
  }
  const walk = (direction: 'down' | 'up', rowId: string, seen: Set<string>, depth: number): LineageNode[] => {
    const edges = direction === 'down' ?
      store.db.prepare('SELECT role, child_id AS next FROM cave_edge WHERE parent_id = ? ORDER BY rowid') :
      store.db.prepare('SELECT role, parent_id AS next FROM cave_edge WHERE child_id = ? ORDER BY rowid')
    return (edges.all(rowId) as { role: string, next: string }[]).flatMap(edge => {
      const row = store.db.prepare('SELECT * FROM cave_claim WHERE id = ?').get(edge.next) as undefined | Row.t
      if (row === undefined) {
        return []
      }
      const repeat = seen.has(row.id)
      seen.add(row.id)
      const view = project(row)
      // The view's own edge counts say whether the walk would continue —
      // the cut and its marker share one condition, so they cannot drift.
      const deeper = (direction === 'down' ? view.cites : view.citedBy) > 0
      const truncated = !repeat && deeper && depth + 1 >= maxLineageDepth
      return [{
        role: edge.role,
        row: view,
        ...repeat ? { repeat: true } : {},
        ...truncated ? { truncated: true } : {},
        children: repeat || truncated || !deeper ? [] : walk(direction, row.id, seen, depth + 1)
      }]
    })
  }
  return {
    row: project(root),
    cites: walk('down', id, new Set([id]), 0),
    citedBy: walk('up', id, new Set([id]), 0)
  }
  })

/** Full-text search (§13.5's FTS surface), newest first, capped in the query. */
export const search = (store: Store, text: string, options: { limit?: number, maxSensitivity?: Sensitivity.Level } = {}): ClaimView[] => {
  const maximum = maximumOf(options)
  const { limit = 100 } = options
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError('search limit must be a non-negative safe integer')
  }
  return readSnapshot(store, () => views(store, store.search(text, {
    limit,
    maxSensitivity: maximum
  }), maximum))
}
