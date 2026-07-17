/**
 * CAVE-Q → SQL compilation (spec §12).
 *
 * Patterns run over *current beliefs* by default — the latest transaction
 * per claim key (spec §9.1) — pass `all` to match the full history,
 * `asOf` to resolve the belief state at a past moment (spec §12.3),
 * `resolve` to match only the winners the §26 contradiction-resolution
 * policy picks among contested facts, or `at` to anchor in valid time
 * (spec §32.4): claims whose time contexts don't cover the instant drop
 * out and trajectory values interpolate.
 * Inverse verbs compile to the same physical query as their primary
 * (spec §12.1): `?x PART-OF monorepo` and `monorepo CONTAINS ?x` produce
 * identical SQL against canonical rows, with the pattern's subject binding
 * on the object side.
 *
 * Transitive patterns (`terrier EXTENDS+ animal`) compile to a recursive
 * CTE over current, positive, non-retracted edges. Recursive state is the
 * reachable endpoint pair itself, so SQL `UNION` deduplication terminates
 * cycles without an arbitrary semantic depth cap.
 */

import { Time, Value } from '@cavelang/core'
import { Registry } from '@cavelang/canonical'
import { QuerySql, Resolve, Row } from '@cavelang/store/adapter'
import type { Store } from '@cavelang/store/adapter'
import * as Pattern from './pattern.ts'

/**
 * One storage-oriented query solution. `row`/`rows` expose SQLite-shaped
 * data for in-process reasoning engines; use `queryRecords()` for versioned
 * public JSON and cross-process integrations.
 */
export type Match = {
  readonly bindings: Readonly<Record<string, string>>
  readonly row?: Row.t
  /**
   * Supporting edge rows of a transitive match — present only under
   * `support`: the visible positive edges of the pattern's verb lying
   * on some path between the matched endpoints.
   */
  readonly rows?: readonly Row.t[]
  /**
   * The row's trajectory value evaluated at the query's `at` instant by
   * linear interpolation (spec §32.3) — present only when `at` is set,
   * the row's value is a trajectory and its contexts carry exactly one
   * closed time range. `text` is canonical CAVE value text.
   */
  readonly at?: { readonly num: number, readonly unit?: string, readonly text: string }
}

export type Options = {
  /** Maximum rows SQLite may return. Prefer the snapshot-aware page API for continuations. */
  readonly limit?: number
  /** Internal SQL offset used by the snapshot-aware page API. */
  readonly offset?: number
  /** Match all appended rows, not only current beliefs. */
  readonly all?: boolean
  /**
   * Resolve entity terms through the alias closure — current positive
   * `ALIAS` claims read as undirected edges (spec §13.6). Union-of-rows:
   * matching widens to aliased names; bindings and rows keep the stored
   * names untouched.
   */
  readonly aliases?: boolean
  /**
   * Resolve beliefs as of a past moment (spec §12.3): a date
   * (`2026-01-15`, the whole UTC day included), a timestamp (the whole
   * second included), or an exact transaction id (UUIDv7, included).
   * Rows recorded after the boundary are invisible — current-belief
   * resolution, the alias closure and transitive hops all reconstruct
   * the belief state at that boundary. Composes with `all`, which then
   * matches the full history up to the boundary.
   */
  readonly asOf?: string
  /**
   * Match resolved winners only (spec §26): when several series assert
   * one fact — actor stamps, content sources, polarity — the resolution
   * policy (precedence class, reliability-weighted confidence, tx)
   * picks one and the rest are invisible. A positive pattern whose fact
   * resolved to a negated winner matches nothing. Composes with
   * `aliases` (groups widen through the closure) and `asOf` (candidates
   * and policy reconstruct at the boundary); incompatible with `all`.
   */
  readonly resolve?: boolean
  /**
   * Valid-time anchor (spec §32.4): a date-like period — read as its
   * start instant — or a timestamp. Claims whose time contexts (bare or
   * `time:`-prefixed date-like points and `..` ranges, spec §32.2) do
   * not cover the instant are invisible; timeless claims always match.
   * A matched trajectory value with one closed range context evaluates
   * by linear interpolation at the instant, surfacing as the match's
   * `at` and substituting into value-slot bindings. Orthogonal to
   * `asOf`: `asOf` picks which rows are believed (transaction time),
   * `at` picks when in the world the claims apply (valid time) — set
   * both for "what did we believe then about that moment". Transitive
   * patterns reject `at` (hop edges are not valid-time filtered).
   */
  readonly at?: string
  /**
   * Attach supporting edge rows to transitive matches: each match's
   * `rows` lists the visible positive edges of the verb on some path
   * between its endpoints (alias links widen the paths under `aliases`
   * but are not edges themselves). Off by default — the support join
   * costs more than pair enumeration, and most callers need only
   * bindings. `@cavelang/automate` opts in so its event filter can see
   * which edge rows a trigger solution stands on (spec §29.2).
   * Non-transitive patterns are unaffected.
   */
  readonly support?: boolean
}

/**
 * UUIDv7 interval `[lo, hi)` for a tx filter value: a date-like value covers
 * its whole UTC period and a timestamp covers one second. Interval semantics
 * keep adjacent operators distinguishable (`<=` includes the boundary period
 * that `<` excludes) and make `WHERE tx = 2026-01-01` mean "recorded that day".
 */
const txBounds = (text: string, label = 'tx date'): { lo: string, hi: string } => {
  const bounds = QuerySql.transactionBounds(text)
  if (bounds === undefined) {
    throw new Error(`CAVE-Q: cannot parse ${label} ${JSON.stringify(text)}`)
  }
  return bounds
}

/**
 * SQL tx condition for an as-of boundary (spec §12.3). A UUIDv7 names an
 * exact transaction, included — belief as of that append; a date-like value
 * or timestamp is inclusive of the whole named period/second, the same interval
 * semantics as `WHERE tx <=` (§12.2). Both forms inline as literals: the
 * id is shape-validated hex-and-dashes and the interval bound is a generated
 * UUIDv7 — no free-form text reaches the SQL, and a literal keeps
 * the fragment embeddable in CTEs that positional parameters would
 * complicate.
 */
const asOfBoundary = (asOf: string): QuerySql.AsOfBoundary => {
  const boundary = QuerySql.asOfBoundary(asOf)
  if (boundary === undefined) {
    throw new Error(`CAVE-Q: cannot parse as-of boundary ${JSON.stringify(asOf)}`)
  }
  return boundary
}

/** Row universe under resolution: every appended row, or only rows recorded up to the as-of boundary. */
const claimsSql = (asOf: undefined | string): string =>
  asOf === undefined ? QuerySql.claims() :
    QuerySql.claims(asOfBoundary(asOf))

const currentSql = (asOf: undefined | string): string =>
  QuerySql.current(claimsSql(asOf))

/**
 * Row universe a pattern matches over: the full history under `all`,
 * current beliefs by default, or the §26 resolved winners among them
 * under `resolve` — each reconstructed at the `asOf` boundary when one
 * is set. With `resolve` + `aliases` the winners' group keys widen
 * through the closure, so the compiled statement must have the
 * `alias_pair` CTE in scope — which the alias plumbing already provides.
 */
const baseSql = (options: Options, policy: undefined | readonly Resolve.Entry[]): string => {
  if (options.resolve === true) {
    if (options.all === true) {
      throw new Error('CAVE-Q: resolve picks winners among current beliefs — incompatible with all (spec §26.4)')
    }
    return Resolve.resolvedSql(policy ?? Resolve.builtins, currentSql(options.asOf), { aliases: options.aliases === true })
  }
  return options.all === true ? `SELECT * FROM ${claimsSql(options.asOf)}` : currentSql(options.asOf)
}

/**
 * Alias closure CTEs (spec §13.6): `alias_edge` is the current positive
 * `ALIAS` claims symmetrized (each written direction is its own claim key —
 * both assert the same undirected link); `alias_pair` its transitive
 * closure — every ordered pair of names currently believed to denote one
 * entity. Edges keep entity-form endpoints only: a `"…"`/`` `…` `` literal
 * names a value, not an entity, so it never joins names into one closure.
 * Resolution always reads *current* beliefs, even under `all`:
 * the closure is entity resolution as believed now, not as believed when
 * a row landed — except under `asOf`, where "now" is the boundary itself
 * and the closure reconstructs entity resolution as believed then
 * (spec §12.3).
 */
const aliasPairSql = (asOf: undefined | string): string =>
  QuerySql.aliasPairs(currentSql(asOf))

/** SQL for "these two expressions name the same entity" under the closure. */
const aliasSame = (left: string, right: string): string =>
  QuerySql.aliasSame(left, right)

type Compiled = {
  readonly sql: string
  readonly params: (string | number)[]
  readonly bind: (row: Record<string, unknown>) => Record<string, string>
  readonly transitive: boolean
  /** Variables bound to the value slot — interpolation substitutes these (spec §32.4). */
  readonly valueVars: readonly string[]
}

const bounded = (compiled: Compiled, options: Options): Compiled => {
  if (options.limit === undefined) return compiled
  if (!Number.isInteger(options.limit) || options.limit < 1 ||
      !Number.isInteger(options.offset ?? 0) || (options.offset ?? 0) < 0) {
    throw new Error('CAVE-Q: limit must be positive and offset must be non-negative')
  }
  return {
    ...compiled,
    sql: `${compiled.sql}\nLIMIT ? OFFSET ?`,
    params: [...compiled.params, options.limit, options.offset ?? 0]
  }
}

export const compile = (pattern: Pattern.t, registry: Registry.t, options: Options, policy?: readonly Resolve.Entry[]): Compiled => {
  // Inverse resolution (spec §12.1): swap the pattern's endpoint slots and
  // query the primary verb.
  let verb = pattern.verb
  let subjectSlot = pattern.subject
  let objectSlot: undefined | Pattern.Slot =
    pattern.payload.kind === 'object' ? pattern.payload.object : undefined
  if (verb.kind === 'verb') {
    const { primary, isInverse } = Registry.primaryOf(registry, verb.name)
    if (isInverse) {
      if (pattern.payload.kind === 'attribute') {
        throw new Error(`CAVE-Q: inverse verb ${verb.name} cannot take an attribute pattern`)
      }
      const swapped = objectSlot ?? { kind: 'wildcard' as const }
      objectSlot = subjectSlot
      subjectSlot = swapped
      verb = { kind: 'verb', name: primary, transitive: verb.transitive }
    } else {
      // A lifecycle alias keeps direction but resolves to the stable
      // storage spelling before SQL is compiled (spec §5.8).
      verb = { kind: 'verb', name: primary, transitive: verb.transitive }
    }
  }

  if (verb.kind === 'verb' && verb.transitive) {
    return bounded(compileTransitive(pattern, verb.name, subjectSlot, objectSlot, options, policy), options)
  }

  const aliases = options.aliases === true
  // Alias closure applies to entity columns only: values and attribute
  // names are not entities, and verb aliasing is a separate, undesigned
  // lifecycle question.
  const entityColumns = ['subject', 'object']
  const conditions: string[] = [`c.negated = ${pattern.negated ? 1 : 0}`]
  const params: (string | number)[] = []
  /** var name → row columns it binds; repeated vars add join conditions. */
  const varColumns = new Map<string, string[]>()
  const slot = (value: Pattern.Slot, column: string, requireNotNull: boolean): void => {
    switch (value.kind) {
      case 'term': {
        const match = aliases && entityColumns.includes(column) ? aliasSame('?', `c.${column}`) : `c.${column} = ?`
        const termParams = aliases && entityColumns.includes(column) ? [value.text, value.text] : [value.text]
        // A date/number term in object position must also match metric
        // rows, which store their value in value_text with object NULL
        // (`latency IS 30ms` ⇒ pattern `latency IS 30ms` matches).
        if (column === 'object') {
          const parsed = Value.parse(value.text)
          if (parsed.kind === 'number' || parsed.kind === 'date') {
            conditions.push(`(${match} OR (c.object IS NULL AND c.value_text = ?))`)
            params.push(...termParams, value.text)
            return
          }
        }
        conditions.push(match)
        params.push(...termParams)
        return
      }
      case 'var': {
        const columns = varColumns.get(value.name) ?? []
        columns.push(column)
        varColumns.set(value.name, columns)
        if (requireNotNull) {
          conditions.push(`c.${column} IS NOT NULL`)
        }
        return
      }
      case 'wildcard':
        if (requireNotNull) {
          conditions.push(`c.${column} IS NOT NULL`)
        }
        return
    }
  }

  slot(subjectSlot, 'subject', false)
  if (verb.kind === 'verb') {
    conditions.push('c.verb = ?')
    params.push(verb.name)
  } else if (verb.kind === 'var') {
    const columns = varColumns.get(verb.name) ?? []
    columns.push('verb')
    varColumns.set(verb.name, columns)
  }
  if (objectSlot !== undefined) {
    slot(objectSlot, 'object', true)
  }
  if (pattern.payload.kind === 'attribute') {
    conditions.push('c.attribute = ?')
    params.push(pattern.payload.attribute)
    slot(pattern.payload.value, 'value_text', true)
  }
  for (const columns of varColumns.values()) {
    for (let i = 1; i < columns.length; i++) {
      conditions.push(
        aliases && entityColumns.includes(columns[0]!) && entityColumns.includes(columns[i]!) ?
          aliasSame(`c.${columns[0]}`, `c.${columns[i]}`) :
          `c.${columns[0]} = c.${columns[i]}`
      )
    }
  }
  for (const context of pattern.contexts) {
    conditions.push('EXISTS (SELECT 1 FROM cave_context x WHERE x.claim_id = c.id AND x.context = ?)')
    params.push(context)
  }
  for (const tag of pattern.tags) {
    if (tag.value === undefined) {
      conditions.push('EXISTS (SELECT 1 FROM cave_tag t WHERE t.claim_id = c.id AND t.key = ? AND t.value IS NULL)')
      params.push(tag.key)
    } else {
      conditions.push('EXISTS (SELECT 1 FROM cave_tag t WHERE t.claim_id = c.id AND t.key = ? AND t.value = ?)')
      params.push(tag.key, tag.value)
    }
  }
  for (const filter of pattern.filters) {
    switch (filter.field) {
      case 'conf':
        conditions.push(`c.conf ${filter.op} ?`)
        params.push(filter.value)
        break
      case 'tag':
        if (filter.value === undefined) {
          conditions.push('EXISTS (SELECT 1 FROM cave_tag t WHERE t.claim_id = c.id AND t.key = ?)')
          params.push(filter.key)
        } else {
          conditions.push('EXISTS (SELECT 1 FROM cave_tag t WHERE t.claim_id = c.id AND t.key = ? AND t.value = ?)')
          params.push(filter.key, filter.value)
        }
        break
      case 'context':
        conditions.push('EXISTS (SELECT 1 FROM cave_context x WHERE x.claim_id = c.id AND x.context = ?)')
        params.push(filter.value)
        break
      case 'value':
        conditions.push(`c.value_num ${filter.op} ?`)
        params.push(filter.value)
        if (filter.unit !== undefined) {
          conditions.push('c.value_unit = ?')
          params.push(filter.unit)
        }
        break
      case 'tx': {
        const { lo, hi } = txBounds(filter.value)
        switch (filter.op) {
          case '>':
            conditions.push('c.tx >= ?')
            params.push(hi)
            break
          case '>=':
            conditions.push('c.tx >= ?')
            params.push(lo)
            break
          case '<':
            conditions.push('c.tx < ?')
            params.push(lo)
            break
          case '<=':
            conditions.push('c.tx < ?')
            params.push(hi)
            break
          case '=':
            conditions.push('(c.tx >= ? AND c.tx < ?)')
            params.push(lo, hi)
            break
          case '!=':
            conditions.push('(c.tx < ? OR c.tx >= ?)')
            params.push(lo, hi)
            break
        }
        break
      }
    }
  }

  // Positive patterns match supported beliefs: a retracted (@ 0%) current
  // belief has no current support (§9.3) and is skipped — mirroring the
  // transitive CTE and store traversal — unless the query asks about
  // confidence explicitly or runs over the full history.
  if (options.all !== true && !pattern.filters.some(filter => filter.field === 'conf')) {
    conditions.push('c.conf > 0')
  }

  const base = baseSql(options, policy)
  const withClause = aliases ? `WITH RECURSIVE ${aliasPairSql(options.asOf)} ` : ''
  const sql = `${withClause}SELECT c.* FROM (${base}) c WHERE ${conditions.join(' AND ')} ORDER BY c.tx`
  const bind = (row: Record<string, unknown>): Record<string, string> => {
    const bindings: Record<string, string> = {}
    for (const [name, columns] of varColumns) {
      bindings[name] = String(row[columns[0]!])
    }
    return bindings
  }
  const valueVars = [...varColumns]
    .filter(([, columns]) => columns[0] === 'value_text')
    .map(([name]) => name)
  return bounded({ sql, params, bind, transitive: false, valueVars }, options)
}

const compileTransitive = (
  pattern: Pattern.t,
  verb: string,
  subjectSlot: Pattern.Slot,
  objectSlot: undefined | Pattern.Slot,
  options: Options,
  policy?: readonly Resolve.Entry[]
): Compiled => {
  if (pattern.negated || pattern.filters.length > 0 || pattern.contexts.length > 0 || pattern.tags.length > 0 ||
      pattern.payload.kind === 'attribute') {
    throw new Error('CAVE-Q: transitive patterns support subject/object slots only (spec §12.1)')
  }
  const aliases = options.aliases === true
  const base = baseSql(options, policy)
  /** Endpoint equality: exact, or alias-equal under the closure (spec §13.6). */
  const same = (left: string, right: string): string =>
    aliases ? aliasSame(left, right) : `${left} = ${right}`
  const conditions: string[] = []
  const params: (string | number)[] = [verb]
  const pushTerm = (term: string): void => {
    params.push(term)
    if (aliases) params.push(term)
  }
  // A concrete source gives forward recursion its smallest seed. If only the
  // destination is concrete, recurse backwards over the object index. Both
  // forms retain normal (src, dst) orientation in their output.
  const direction = subjectSlot.kind === 'term' ? 'forward' :
    objectSlot?.kind === 'term' ? 'reverse' : 'all-pairs'
  if (subjectSlot.kind === 'term') {
    pushTerm(subjectSlot.text)
  } else if (objectSlot?.kind === 'term') {
    pushTerm(objectSlot.text)
  }
  if (objectSlot?.kind === 'term' && direction !== 'reverse') {
    conditions.push(same('h.dst', '?'))
    pushTerm(objectSlot.text)
  }
  // A repeated variable forces equality here just as in single-hop
  // patterns: `?x EXTENDS+ ?x` asks for nodes on a cycle, not for every
  // reachable pair.
  if (subjectSlot.kind === 'var' && objectSlot?.kind === 'var' && subjectSlot.name === objectSlot.name) {
    conditions.push(same('h.src', 'h.dst'))
  }
  const withRecursive = `WITH RECURSIVE ${aliases ? `${aliasPairSql(options.asOf)}, ` : ''}`
  // Reachable pairs are the complete recursive state. UNION (not UNION ALL)
  // deduplicates each pair before it can be expanded again, so a finite graph
  // reaches a fixed point even with cycles and no hop-depth cutoff.
  const seedSql = direction === 'forward' ?
    `SELECT src, dst FROM cur WHERE ${same('src', '?')}` :
    direction === 'reverse' ?
      `SELECT src, dst FROM cur WHERE ${same('dst', '?')}` :
      'SELECT src, dst FROM cur'
  const recursiveSql = direction === 'reverse' ?
    `SELECT cur.src, h.dst FROM hops h JOIN cur ON ${same('cur.dst', 'h.src')}` :
    `SELECT h.src, cur.dst FROM hops h JOIN cur ON ${same('cur.src', 'h.dst')}`
  const hopsSql = `hops(src, dst) AS (
  ${seedSql}
  UNION
  ${recursiveSql}
)`
  // Support (an opt-in): propagate each edge id with every reachable pair it
  // supports. The triple is finite and UNION-deduplicated like `hops`, while
  // preserving forward/reverse seeding instead of rebuilding all-pairs
  // reachability merely to recover path evidence.
  const supportAddedSql = direction === 'reverse' ?
    `SELECT cur.src, h.dst, cur.edge_id FROM hops h JOIN cur ON ${same('cur.dst', 'h.src')}` :
    `SELECT h.src, cur.dst, cur.edge_id FROM hops h JOIN cur ON ${same('cur.src', 'h.dst')}`
  const supportRecursiveSql = direction === 'reverse' ?
    `SELECT cur.src, s.dst, s.edge_id FROM support s JOIN cur ON ${same('cur.dst', 's.src')}` :
    `SELECT s.src, cur.dst, s.edge_id FROM support s JOIN cur ON ${same('cur.src', 's.dst')}`
  const supportSql = `support(src, dst, edge_id) AS (
  SELECT h.src, h.dst, cur.edge_id FROM hops h JOIN cur
    ON ${same('cur.src', 'h.src')} AND ${same('cur.dst', 'h.dst')}
  UNION
  ${supportAddedSql}
  UNION
  ${supportRecursiveSql}
)`
  const aliasedSelect = (() => {
    if (!aliases) return 'SELECT DISTINCT h.src AS src, h.dst AS dst FROM hops h'
    // Alias widening can produce several physical endpoint pairs with the
    // same visible bindings. Project unbound slots to constants before
    // DISTINCT so SQL-level pagination sees the same solutions match()
    // exposes, rather than duplicate pairs that only collapse afterwards.
    const repeated = subjectSlot.kind === 'var' && objectSlot?.kind === 'var' &&
      subjectSlot.name === objectSlot.name
    const src = subjectSlot.kind === 'var' ? repeated ? 'h.dst' : 'h.src' : "''"
    const dst = objectSlot?.kind === 'var' ? 'h.dst' : "''"
    return `SELECT DISTINCT ${src} AS src, ${dst} AS dst FROM hops h`
  })()
  const sql = options.support === true ? `
${withRecursive}edge AS (
  SELECT c.* FROM (${base}) c
  WHERE c.verb = ? AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
), cur AS (
  SELECT subject AS src, object AS dst, id AS edge_id FROM edge
), ${hopsSql}, ${supportSql}, pair(src, dst) AS (
  SELECT DISTINCT h.src, h.dst FROM hops h
  ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
)
SELECT p.src AS src, p.dst AS dst, e.*
FROM pair p JOIN support s ON ${same('s.src', 'p.src')} AND ${same('s.dst', 'p.dst')}
JOIN edge e ON e.id = s.edge_id
ORDER BY p.src, p.dst, e.tx` : `
${withRecursive}cur AS (
  SELECT c.subject AS src, c.object AS dst
  FROM (${base}) c
  WHERE c.verb = ? AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
), ${hopsSql}
${aliasedSelect}
${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
ORDER BY src, dst`
  const bind = (row: Record<string, unknown>): Record<string, string> => {
    const bindings: Record<string, string> = {}
    if (subjectSlot.kind === 'var') {
      bindings[subjectSlot.name] = String(row['src'])
    }
    if (objectSlot?.kind === 'var') {
      bindings[objectSlot.name] = String(row['dst'])
    }
    return bindings
  }
  return { sql, params, bind, transitive: true, valueVars: [] }
}

/**
 * Runs a CAVE-Q query against a store.
 *
 * ```ts
 * query(store, '?x USES jwt')
 * query(store, '?cause CAUSE app/crash\n  WHERE conf >= 0.7')
 * query(store, 'terrier EXTENDS+ animal')
 * query(store, 'server IS compromised', { asOf: '2026-01-15' })
 * ```
 */
export const query = (store: Store, input: string, options: Options = {}): Match[] =>
  match(store, Pattern.parse(input), options)

/**
 * The row's trajectory value evaluated at the instant (spec §32.3):
 * linear interpolation over the single closed time-range context, with
 * endpoint values anchored at the range periods' start instants and the
 * end value held through the end period's tail.
 */
const evaluateAt = (
  row: Record<string, unknown>,
  contexts: readonly string[],
  instant: number
): undefined | Match['at'] => {
  const valueText = row['value_text']
  if (typeof valueText !== 'string') {
    return undefined
  }
  const value = Row.parseValue(valueText)
  if (value.kind !== 'trajectory') {
    return undefined
  }
  const range = Time.closedRangeOf(contexts)
  if (range === undefined) {
    return undefined
  }
  const fraction = Time.fractionAt(range, instant)
  return {
    num: Value.interpolate(value, fraction)!,
    text: Value.formatAt(value, fraction)!,
    ...value.unit === undefined ? {} : { unit: value.unit }
  }
}

/**
 * Runs an already-parsed pattern against a store — the programmatic
 * entry point for callers that build or specialize patterns as values
 * (the §24 rules engine substitutes bindings into premise patterns
 * between joins) rather than as text.
 */
export type Window = {
  /** Matches remaining after any valid-time evaluation. */
  readonly matches: Match[]
  /** Rows returned by SQLite before valid-time evaluation. */
  readonly scanned: number
}

const run = (store: Store, pattern: Pattern.t, options: Options = {}): Window => {
  const instant = options.at === undefined ? undefined : Time.parseInstant(options.at)
  if (options.at !== undefined && instant === undefined) {
    throw new Error(
      `CAVE-Q: cannot parse at anchor ${JSON.stringify(options.at)} — a date-like period or a timestamp (spec §32.4)`)
  }
  // The effective policy is read per query so an as-of query reads the
  // in-band declarations as of its boundary (spec §26.3, §12.3).
  const policy = options.resolve === true ?
    Resolve.readPolicy(store.db, currentSql(options.asOf)) :
    undefined
  const compiled = compile(pattern, store.registry(), options, policy)
  if (compiled.transitive && instant !== undefined) {
    throw new Error('CAVE-Q: at does not compose with transitive patterns — hop edges are not valid-time filtered (spec §32.4)')
  }
  const rows = store.db.prepare(compiled.sql).all(...compiled.params) as Record<string, unknown>[]
  if (compiled.transitive && options.support === true) {
    // One match per distinct (src, dst) pair, its supporting edge rows
    // attached; under aliases identical binding sets still collapse to
    // one answer (the rule below), their support unioned.
    const matches = new Map<string, { bindings: Record<string, string>, rows: Row.t[], seen: Set<string> }>()
    for (const row of rows) {
      const key = options.aliases === true ?
        JSON.stringify(compiled.bind(row)) :
        JSON.stringify([row['src'], row['dst']])
      let entry = matches.get(key)
      if (entry === undefined) {
        entry = { bindings: compiled.bind(row), rows: [], seen: new Set() }
        matches.set(key, entry)
      }
      const id = String(row['id'])
      if (!entry.seen.has(id)) {
        entry.seen.add(id)
        entry.rows.push(row as unknown as Row.t)
      }
    }
    return {
      scanned: rows.length,
      matches: [...matches.values()].map(entry => ({ bindings: entry.bindings, rows: entry.rows }))
    }
  }
  if (compiled.transitive && options.aliases === true) {
    // Distinct (src, dst) pairs can repeat a binding set when an endpoint
    // matched through different spellings of one aliased entity; a
    // transitive match carries no row, so identical bindings are identical
    // answers.
    const seen = new Set<string>()
    return { scanned: rows.length, matches: rows.flatMap(row => {
      const bindings = compiled.bind(row)
      const key = JSON.stringify(bindings)
      if (seen.has(key)) {
        return []
      }
      seen.add(key)
      return [{ bindings }]
    }) }
  }
  if (compiled.transitive) {
    return { scanned: rows.length, matches: rows.map(row => ({ bindings: compiled.bind(row) })) }
  }
  if (instant === undefined) {
    return {
      scanned: rows.length,
      matches: rows.map(row => ({ bindings: compiled.bind(row), row: row as unknown as Row.t }))
    }
  }
  // Valid-time pass (spec §32.4): contexts are read per row — coverage
  // needs period interpretation no SQL expression can do.
  const contextsOf = store.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?')
  return { scanned: rows.length, matches: rows.flatMap(row => {
    const contexts = (contextsOf.all(String(row['id'])) as { context: string }[])
      .map(entry => entry.context)
    if (!Time.appliesAt(contexts, instant)) {
      return []
    }
    const at = evaluateAt(row, contexts, instant)
    const bindings = compiled.bind(row)
    if (at === undefined) {
      return [{ bindings, row: row as unknown as Row.t }]
    }
    for (const name of compiled.valueVars) {
      bindings[name] = at.text
    }
    return [{ bindings, row: row as unknown as Row.t, at }]
  }) }
}

/** Execute one SQL window and report how many pre-filter rows it consumed. */
export const window = (store: Store, pattern: Pattern.t, options: Options = {}): Window =>
  run(store, pattern, options)

export const match = (store: Store, pattern: Pattern.t, options: Options = {}): Match[] =>
  run(store, pattern, options).matches
