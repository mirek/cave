/**
 * CAVE-Q → SQL compilation (spec §12).
 *
 * Patterns run over *current beliefs* by default — the latest transaction
 * per claim key (spec §9.1) — pass `all` to match the full history, or
 * `asOf` to resolve the belief state at a past moment (spec §12.3).
 * Inverse verbs compile to the same physical query as their primary
 * (spec §12.1): `?x PART-OF monorepo` and `monorepo CONTAINS ?x` produce
 * identical SQL against canonical rows, with the pattern's subject binding
 * on the object side.
 *
 * Transitive patterns (`terrier EXTENDS+ animal`) compile to a recursive
 * CTE over current, positive, non-retracted edges (depth-capped at 32).
 */

import { Uuidv7, Value } from '@cavelang/core'
import { Registry } from '@cavelang/canonical'
import type { Row, Store } from '@cavelang/store'
import * as Pattern from './pattern.ts'

/** One query solution: variable bindings plus the matched row (absent for transitive hops). */
export type Match = {
  readonly bindings: Readonly<Record<string, string>>
  readonly row?: Row.t
}

export type Options = {
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
}

/**
 * UUIDv7 interval `[lo, hi)` for a tx filter value: a bare date covers the
 * whole UTC day, a timestamp covers one second. Interval semantics keep
 * adjacent operators distinguishable (`<=` includes the boundary day that
 * `<` excludes) and make `WHERE tx = 2026-01-01` mean "recorded that day".
 */
const txBounds = (text: string, label = 'tx date'): { lo: string, hi: string } => {
  const hasTime = text.includes('T')
  const start = Date.parse(hasTime ? text : `${text}T00:00:00Z`)
  if (Number.isNaN(start)) {
    throw new Error(`CAVE-Q: cannot parse ${label} ${JSON.stringify(text)}`)
  }
  const end = start + (hasTime ? 1_000 : 86_400_000)
  return { lo: Uuidv7.at(start, 0, new Uint8Array(8)), hi: Uuidv7.at(end, 0, new Uint8Array(8)) }
}

/**
 * SQL tx condition for an as-of boundary (spec §12.3). A UUIDv7 names an
 * exact transaction, included — belief as of that append; a date or
 * timestamp is inclusive of the whole named day/second, the same interval
 * semantics as `WHERE tx <=` (§12.2). Both forms inline as literals: the
 * id is shape-validated hex-and-dashes and the interval bound comes from
 * `Uuidv7.at` — no free-form text reaches the SQL, and a literal keeps
 * the fragment embeddable in CTEs that positional parameters would
 * complicate.
 */
const asOfCondition = (asOf: string): string => {
  const id = asOf.toLowerCase()
  return Uuidv7.is(id) ? `tx <= '${id}'` : `tx < '${txBounds(asOf, 'as-of boundary').hi}'`
}

/** Row universe under resolution: every appended row, or only rows recorded up to the as-of boundary. */
const claimsSql = (asOf: undefined | string): string =>
  asOf === undefined ? 'cave_claim' : `(SELECT * FROM cave_claim WHERE ${asOfCondition(asOf)})`

const currentSql = (asOf: undefined | string): string => `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM ${claimsSql(asOf)} GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

/**
 * Alias closure CTEs (spec §13.6): `alias_edge` is the current positive
 * `ALIAS` claims symmetrized (each written direction is its own claim key —
 * both assert the same undirected link); `alias_pair` its transitive
 * closure — every ordered pair of names currently believed to denote one
 * entity. Resolution always reads *current* beliefs, even under `all`:
 * the closure is entity resolution as believed now, not as believed when
 * a row landed — except under `asOf`, where "now" is the boundary itself
 * and the closure reconstructs entity resolution as believed then
 * (spec §12.3).
 */
const aliasPairSql = (asOf: undefined | string): string => `alias_edge(a, b) AS (
  SELECT c.subject, c.object FROM (${currentSql(asOf)}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
  UNION
  SELECT c.object, c.subject FROM (${currentSql(asOf)}) c
  WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
), alias_pair(a, b) AS (
  SELECT a, b FROM alias_edge
  UNION
  SELECT p.a, e.b FROM alias_pair p JOIN alias_edge e ON e.a = p.b
)`

/** SQL for "these two expressions name the same entity" under the closure. */
const aliasSame = (left: string, right: string): string =>
  `(${left} = ${right} OR EXISTS (SELECT 1 FROM alias_pair p WHERE p.a = ${left} AND p.b = ${right}))`

type Compiled = {
  readonly sql: string
  readonly params: (string | number)[]
  readonly bind: (row: Record<string, unknown>) => Record<string, string>
  readonly transitive: boolean
}

const compile = (pattern: Pattern.t, registry: Registry.t, options: Options): Compiled => {
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
    }
  }

  if (verb.kind === 'verb' && verb.transitive) {
    return compileTransitive(pattern, verb.name, subjectSlot, objectSlot, options)
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

  const base = options.all === true ? `SELECT * FROM ${claimsSql(options.asOf)}` : currentSql(options.asOf)
  const withClause = aliases ? `WITH RECURSIVE ${aliasPairSql(options.asOf)} ` : ''
  const sql = `${withClause}SELECT c.* FROM (${base}) c WHERE ${conditions.join(' AND ')} ORDER BY c.tx`
  const bind = (row: Record<string, unknown>): Record<string, string> => {
    const bindings: Record<string, string> = {}
    for (const [name, columns] of varColumns) {
      bindings[name] = String(row[columns[0]!])
    }
    return bindings
  }
  return { sql, params, bind, transitive: false }
}

const compileTransitive = (
  pattern: Pattern.t,
  verb: string,
  subjectSlot: Pattern.Slot,
  objectSlot: undefined | Pattern.Slot,
  options: Options
): Compiled => {
  if (pattern.negated || pattern.filters.length > 0 || pattern.contexts.length > 0 || pattern.tags.length > 0 ||
      pattern.payload.kind === 'attribute') {
    throw new Error('CAVE-Q: transitive patterns support subject/object slots only (spec §12.1)')
  }
  const aliases = options.aliases === true
  const base = options.all === true ? `SELECT * FROM ${claimsSql(options.asOf)}` : currentSql(options.asOf)
  /** Endpoint equality: exact, or alias-equal under the closure (spec §13.6). */
  const same = (left: string, right: string): string =>
    aliases ? aliasSame(left, right) : `${left} = ${right}`
  const conditions: string[] = []
  const params: (string | number)[] = [verb]
  if (subjectSlot.kind === 'term') {
    conditions.push(same('h.src', '?'))
    params.push(subjectSlot.text)
    if (aliases) {
      params.push(subjectSlot.text)
    }
  }
  if (objectSlot?.kind === 'term') {
    conditions.push(same('h.dst', '?'))
    params.push(objectSlot.text)
    if (aliases) {
      params.push(objectSlot.text)
    }
  }
  // A repeated variable forces equality here just as in single-hop
  // patterns: `?x EXTENDS+ ?x` asks for nodes on a cycle, not for every
  // reachable pair.
  if (subjectSlot.kind === 'var' && objectSlot?.kind === 'var' && subjectSlot.name === objectSlot.name) {
    conditions.push(same('h.src', 'h.dst'))
  }
  const sql = `
WITH RECURSIVE ${aliases ? `${aliasPairSql(options.asOf)}, ` : ''}cur AS (
  SELECT c.subject AS src, c.object AS dst
  FROM (${base}) c
  WHERE c.verb = ? AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
), hops(src, dst, depth) AS (
  SELECT src, dst, 1 FROM cur
  UNION
  SELECT h.src, cur.dst, h.depth + 1 FROM hops h JOIN cur ON ${same('cur.src', 'h.dst')}
  WHERE h.depth < 32
)
SELECT DISTINCT h.src AS src, h.dst AS dst FROM hops h
${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
ORDER BY h.src, h.dst`
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
  return { sql, params, bind, transitive: true }
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
export const query = (store: Store, input: string, options: Options = {}): Match[] => {
  const pattern = Pattern.parse(input)
  const compiled = compile(pattern, store.registry(), options)
  const rows = store.db.prepare(compiled.sql).all(...compiled.params) as Record<string, unknown>[]
  if (compiled.transitive && options.aliases === true) {
    // Distinct (src, dst) pairs can repeat a binding set when an endpoint
    // matched through different spellings of one aliased entity; a
    // transitive match carries no row, so identical bindings are identical
    // answers.
    const seen = new Set<string>()
    return rows.flatMap(row => {
      const bindings = compiled.bind(row)
      const key = JSON.stringify(bindings)
      if (seen.has(key)) {
        return []
      }
      seen.add(key)
      return [{ bindings }]
    })
  }
  return rows.map(row =>
    compiled.transitive ?
      { bindings: compiled.bind(row) } :
      { bindings: compiled.bind(row), row: row as unknown as Row.t }
  )
}
