/**
 * Knowledge health checks (spec §20).
 *
 * Everything here is a *read* over a store: expectations come from current
 * positive `EXPECTS` claims (§20.1), targets bind through the `EXTENDS`
 * taxonomy, and the report (§20.2) lists shape violations, stale beliefs,
 * review candidates, alias disagreements and coverage stats. Nothing is
 * written — enforcement is the opt-in gate in `gate.ts` (§20.3).
 */

import { Uuidv7, Verb } from '@cavelang/core'
import { Registry } from '@cavelang/canonical'
import type { Row, Store } from '@cavelang/store'

const currentSql = `
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
`

/** One in-band shape declaration — `type EXPECTS name` (spec §20.1). */
export type Expectation = {
  /** The type entity the shape targets. */
  readonly type: string
  /** UPPERCASE object → relation expectation; otherwise attribute. */
  readonly kind: 'attribute' | 'relation'
  /** Expected attribute name or verb. */
  readonly name: string
  /** `some` preserves the original one-or-more presence check; `one` requires exactly one current value. */
  readonly cardinality: 'some' | 'one'
  /** Exact normalized unit required on attribute values; absent means units are unconstrained. */
  readonly unit?: string
  /** The declaring row. */
  readonly row: Row.t
}

/** One unsatisfied (instance, expectation) pair (spec §20.2). */
export type Violation = {
  readonly entity: string
  /** The type the entity `IS`-ed into — `expectation.type` or an `EXTENDS+` descendant. */
  readonly via: string
  readonly expectation: Expectation
  /** Number of current positive values or relation endpoints observed in the expected slot. */
  readonly actualCount: number
  /** Distinct normalized units observed on attribute values; `null` denotes no unit. */
  readonly actualUnits: readonly (string | null)[]
}

/** A current belief older than the staleness horizon (spec §20.2). */
export type Stale = {
  readonly row: Row.t
  readonly ageDays: number
}

/** A cross-series conflict inside one alias closure group (spec §20.2). */
export type Disagreement = {
  /** `value`: same verb+attribute, different values. `polarity`: same verb+object, asserted and negated. */
  readonly kind: 'value' | 'polarity'
  /** What the series disagree about — `HAS version` / `IS production`. */
  readonly about: string
  /** The aliased names carrying the disagreeing series, sorted. */
  readonly entities: readonly string[]
  readonly rows: readonly Row.t[]
}

/** Aggregate knowledge-quality stats — the §17.6 precursor (spec §20.2). */
export type Coverage = {
  /** All appended rows. */
  readonly rows: number
  /** Distinct claim keys — facts with a belief series. */
  readonly facts: number
  /** Current positive beliefs (`conf > 0`, not negated). */
  readonly current: number
  /** Facts whose current belief is retracted (`conf = 0`). */
  readonly retracted: number
  /** Current negative facts (`VERB NOT` at `conf > 0`). */
  readonly negated: number
  /** Mean confidence over current believed rows, `null` on an empty store. */
  readonly averageConfidence: null | number
  /** Current believed rows below `conf 0.3`. */
  readonly lowConfidence: number
  /** Distinct entity names in current believed claims (negated included). */
  readonly entities: number
  /** Entities carrying a current positive `IS` claim. */
  readonly typedEntities: number
  readonly expectations: number
  /** Distinct entities targeted by at least one expectation. */
  readonly instances: number
  /** (instance, expectation) pairs checked. */
  readonly checks: number
  readonly satisfied: number
}

export type Report = {
  readonly expectations: readonly Expectation[]
  readonly violations: readonly Violation[]
  readonly stale: readonly Stale[]
  readonly review: readonly Row.t[]
  readonly disagreements: readonly Disagreement[]
  readonly coverage: Coverage
}

export type Options = {
  /** Staleness horizon in days (spec §20.2), default {@link defaultStaleDays}. */
  readonly staleDays?: number
  /** Clock, injectable for tests. */
  readonly now?: () => number
}

export const defaultStaleDays = 90

/** Entity test for coverage/targets: not a verb token, not a stored literal. */
const isEntityName = (name: string): boolean =>
  !Verb.isVerbToken(name) && !name.startsWith('"') && !name.startsWith('`')

const all = (store: Store, sql: string, ...params: (string | number)[]): Row.t[] =>
  store.db.prepare(sql).all(...params) as unknown as Row.t[]

type ShapeState = {
  /** Every current belief, materialized once in transaction order. */
  readonly rows: readonly Row.t[]
  readonly tags: ReadonlyMap<string, ReadonlyMap<string, null | string>>
  readonly excludedDeclarations: ReadonlySet<string>
}

/**
 * One evaluation snapshot. Query count is constant: current beliefs, tags,
 * and declaration-excluding qualifier edges, independent of shape size.
 */
const shapeState = (store: Store): ShapeState => {
  const rows = all(store, `SELECT c.* FROM (${currentSql}) c ORDER BY c.tx`)
  const currentIds = new Set(rows.map(row => row.id))
  const tags = new Map<string, Map<string, null | string>>()
  const tagRows = store.db.prepare(
    "SELECT claim_id, key, value FROM cave_tag WHERE key IN ('unit', 'cardinality') ORDER BY rowid"
  ).all() as { claim_id: string, key: string, value: null | string }[]
  for (const tag of tagRows) {
    if (!currentIds.has(tag.claim_id)) continue
    const byKey = tags.get(tag.claim_id) ?? new Map<string, null | string>()
    if (!byKey.has(tag.key)) byKey.set(tag.key, tag.value)
    tags.set(tag.claim_id, byKey)
  }
  const excludedDeclarations = new Set((store.db.prepare(`
    SELECT DISTINCT child_id FROM cave_edge WHERE role IN ('WHEN', 'VIA', 'BECAUSE')
  `).all() as { child_id: string }[]).map(row => row.child_id))
  return { rows, tags, excludedDeclarations }
}

const tagValue = (state: ShapeState, row: Row.t, key: string): undefined | string =>
  state.tags.get(row.id)?.get(key) ?? undefined

const expectationOf = (state: ShapeState, row: Row.t): undefined | Expectation => {
  if (!isEntityName(row.subject) || row.object === null || row.object.startsWith('"') || row.object.startsWith('`')) {
    return undefined
  }
  const kind = Verb.isVerbToken(row.object) ? 'relation' as const : 'attribute' as const
  const unit = kind === 'attribute' ? tagValue(state, row, 'unit') : undefined
  return {
    type: row.subject,
    kind,
    name: row.object,
    cardinality: tagValue(state, row, 'cardinality') === 'one' ? 'one' : 'some',
    ...unit === undefined ? {} : { unit },
    row
  }
}

const expectationsOf = (state: ShapeState): Expectation[] =>
  state.rows.flatMap(row => {
    if (row.verb !== 'EXPECTS' || row.negated !== 0 || row.conf <= 0 || row.object === null ||
        state.excludedDeclarations.has(row.id)) return []
    const expectation = expectationOf(state, row)
    return expectation === undefined ? [] : [expectation]
  })

/**
 * Current positive `EXPECTS` declarations (spec §20.1), oldest first.
 * Qualifier condition rows never declare, mirroring the registry's
 * treatment of in-band declarations; verb-token and literal subjects are
 * not types.
 */
export const expectations = (store: Store): Expectation[] =>
  expectationsOf(shapeState(store))

/**
 * Instances of a type (spec §20.1): entities with a current positive `IS`
 * claim into the type or any `EXTENDS+` descendant — the taxonomy is the
 * binding surface. Returns instance → the `IS` object it bound through.
 */
type TargetIndexes = {
  readonly children: ReadonlyMap<string, readonly string[]>
  readonly typings: readonly { readonly entity: string, readonly via: string }[]
}

const targetIndexes = (state: ShapeState): TargetIndexes => {
  const children = new Map<string, string[]>()
  const typings: { entity: string, via: string }[] = []
  for (const row of state.rows) {
    if (row.negated !== 0 || row.conf <= 0 || row.object === null) continue
    if (row.verb === 'EXTENDS') {
      children.set(row.object, [...children.get(row.object) ?? [], row.subject])
    } else if (row.verb === 'IS' && isEntityName(row.subject)) {
      typings.push({ entity: row.subject, via: row.object })
    }
  }
  return { children, typings }
}

const instancesOf = (targets: TargetIndexes, type: string): Map<string, string> => {
  const types = new Set([type])
  let frontier = [type]
  for (let depth = 0; depth < 32 && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const parent of frontier) {
      for (const child of targets.children.get(parent) ?? []) {
        if (types.has(child)) continue
        types.add(child)
        next.push(child)
      }
    }
    frontier = next
  }
  const instances = new Map<string, string>()
  for (const { entity, via } of targets.typings) {
    if (types.has(via) && !instances.has(entity)) {
      instances.set(entity, via)
    }
  }
  return instances
}

type Observed = {
  readonly count: number
  readonly units: readonly (string | null)[]
}

type MutableObserved = { count: number, readonly units: Set<string | null> }
type SlotIndex = Map<string, Map<string, MutableObserved>>

const addObserved = (index: SlotIndex, slot: string, entity: string, unit?: string | null): void => {
  const byEntity = index.get(slot) ?? new Map<string, MutableObserved>()
  const actual = byEntity.get(entity) ?? { count: 0, units: new Set<string | null>() }
  actual.count += 1
  if (unit !== undefined) actual.units.add(unit)
  byEntity.set(entity, actual)
  index.set(slot, byEntity)
}

type ObservedIndexes = {
  readonly attributes: SlotIndex
  readonly forward: SlotIndex
  readonly reverse: SlotIndex
}

const observedIndexes = (state: ShapeState): ObservedIndexes => {
  const attributes: SlotIndex = new Map()
  const forward: SlotIndex = new Map()
  const reverse: SlotIndex = new Map()
  for (const row of state.rows) {
    if (row.negated !== 0 || row.conf <= 0) continue
    if (row.verb === 'HAS' && row.attribute !== null) {
      addObserved(attributes, row.attribute, row.subject, row.value_unit)
    }
    if (row.object !== null) {
      addObserved(forward, row.verb, row.subject)
      addObserved(reverse, row.verb, row.object)
    }
  }
  return { attributes, forward, reverse }
}

const observed = (
  store: Store,
  indexes: ObservedIndexes,
  entity: string,
  expectation: Expectation
): Observed => {
  let actual: undefined | MutableObserved
  if (expectation.kind === 'attribute') {
    actual = indexes.attributes.get(expectation.name)?.get(entity)
  } else {
    // An inverse expectation reads the object side of its stored primary.
    const { primary, isInverse } = Registry.primaryOf(store.registry(), expectation.name)
    actual = (isInverse ? indexes.reverse : indexes.forward).get(primary)?.get(entity)
  }
  if (actual === undefined) return { count: 0, units: [] }
  return {
    count: actual.count,
    units: [...actual.units].sort((a, b) => (a ?? '').localeCompare(b ?? ''))
  }
}

const satisfies = (expectation: Expectation, actual: Observed): boolean =>
  actual.count > 0 &&
  (expectation.cardinality === 'some' || actual.count === 1) &&
  (expectation.unit === undefined || actual.units.every(unit => unit === expectation.unit))

/** Shape evaluation — expectations, targets and violations in one pass. */
export type Evaluation = {
  readonly expectations: readonly Expectation[]
  readonly violations: readonly Violation[]
  /** Distinct entities targeted by at least one expectation. */
  readonly instances: number
  /** (instance, expectation) pairs checked. */
  readonly checks: number
}

/** Evaluates every declared expectation against its instances (spec §20.2). */
export const evaluate = (store: Store): Evaluation => {
  const state = shapeState(store)
  const declared = expectationsOf(state)
  const indexes = observedIndexes(state)
  const targets = targetIndexes(state)
  const byType = new Map<string, Expectation[]>()
  for (const expectation of declared) {
    byType.set(expectation.type, [...byType.get(expectation.type) ?? [], expectation])
  }
  const violations: Violation[] = []
  const targeted = new Set<string>()
  let checks = 0
  for (const [type, typeExpectations] of byType) {
    for (const [entity, via] of instancesOf(targets, type)) {
      targeted.add(entity)
      for (const expectation of typeExpectations) {
        checks += 1
        const actual = observed(store, indexes, entity, expectation)
        if (!satisfies(expectation, actual)) {
          violations.push({
            entity,
            via,
            expectation,
            actualCount: actual.count,
            actualUnits: actual.units
          })
        }
      }
    }
  }
  return { expectations: declared, violations, instances: targeted.size, checks }
}

/** Current believed rows older than the horizon (spec §20.2), oldest first. */
const staleRows = (store: Store, staleDays: number, nowMs: number): Stale[] => {
  const cutoff = nowMs - staleDays * 86_400_000
  return all(store, `SELECT c.* FROM (${currentSql}) c WHERE c.conf > 0 ORDER BY c.tx`)
    .filter(row => Uuidv7.msOf(row.tx) < cutoff)
    .map(row => ({ row, ageDays: Math.floor((nowMs - Uuidv7.msOf(row.tx)) / 86_400_000) }))
}

/** Alias closure groups of size ≥ 2 — union-find over current positive `ALIAS` links (spec §13.6). */
const aliasGroups = (store: Store): string[][] => {
  const edges = store.db.prepare(`
    SELECT c.subject AS a, c.object AS b FROM (${currentSql}) c
    WHERE c.verb = 'ALIAS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
  `).all() as { a: string, b: string }[]
  const parent = new Map<string, string>()
  const find = (name: string): string => {
    const up = parent.get(name)
    if (up === undefined || up === name) {
      return name
    }
    const root = find(up)
    parent.set(name, root)
    return root
  }
  for (const { a, b } of edges) {
    parent.set(find(a), find(b))
  }
  const groups = new Map<string, string[]>()
  for (const name of new Set(edges.flatMap(({ a, b }) => [a, b]))) {
    const root = find(name)
    groups.set(root, [...groups.get(root) ?? [], name])
  }
  return [...groups.values()].filter(group => group.length >= 2).map(group => group.sort())
}

/**
 * Scope signature of a row: its non-`src:` contexts, sorted. Series scoped
 * to different contexts (`@prod` vs `@staging`) describe different facts
 * and never disagree; actor provenance stamps (spec §9.5) are provenance,
 * not scope, so they don't separate.
 */
const scopeOf = (store: Store, row: Row.t): string =>
  (store.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?').all(row.id) as { context: string }[])
    .map(({ context }) => context)
    .filter(context => !context.startsWith('src:'))
    .sort()
    .join(' ')

/** Whether two rows from different alias names actually conflict. */
const hasCrossNamePair = (
  rows: readonly Row.t[],
  differs: (left: Row.t, right: Row.t) => boolean
): boolean => rows.some((left, at) =>
  rows.slice(at + 1).some(right => left.subject !== right.subject && differs(left, right)))

/**
 * Cross-series conflicts inside alias groups (spec §20.2) — the checking
 * half open decision 2 deferred: union-of-rows keeps disagreeing series
 * side by side; this is what looks at them.
 */
const findDisagreements = (store: Store): Disagreement[] => {
  const disagreements: Disagreement[] = []
  for (const group of aliasGroups(store)) {
    const rows = all(store, `
      SELECT c.* FROM (${currentSql}) c
      WHERE c.subject IN (${group.map(() => '?').join(', ')}) AND c.verb <> 'ALIAS' AND c.conf > 0
      ORDER BY c.tx
    `, ...group)
    const buckets = new Map<string, Row.t[]>()
    for (const row of rows) {
      const slot = row.attribute !== null ? `attr:${row.attribute}` : row.object !== null ? `obj:${row.object}` : ''
      if (slot === '') {
        continue
      }
      const key = `${row.verb} ${slot} ${scopeOf(store, row)}`
      buckets.set(key, [...buckets.get(key) ?? [], row])
    }
    for (const bucket of buckets.values()) {
      const first = bucket[0]!
      if (first.attribute !== null) {
        const positives = bucket.filter(row => row.negated === 0)
        const subjects = [...new Set(positives.map(row => row.subject))].sort()
        if (hasCrossNamePair(positives, (left, right) => left.value_text !== right.value_text)) {
          disagreements.push({ kind: 'value', about: `${first.verb} ${first.attribute}`, entities: subjects, rows: positives })
        }
      } else {
        if (hasCrossNamePair(bucket, (left, right) => left.negated !== right.negated)) {
          disagreements.push({
            kind: 'polarity',
            about: `${first.verb} ${first.object}`,
            entities: [...new Set(bucket.map(row => row.subject))].sort(),
            rows: bucket
          })
        }
      }
    }
  }
  return disagreements
}

const count = (store: Store, sql: string): number =>
  (store.db.prepare(sql).get() as { n: number }).n

const coverage = (store: Store, evaluation: Evaluation): Coverage => {
  const average = (store.db.prepare(`SELECT AVG(conf) AS avg FROM (${currentSql}) c WHERE c.conf > 0`)
    .get() as { avg: null | number }).avg
  const names = (store.db.prepare(`
    SELECT c.subject AS name FROM (${currentSql}) c WHERE c.conf > 0
    UNION
    SELECT c.object AS name FROM (${currentSql}) c WHERE c.conf > 0 AND c.object IS NOT NULL
  `).all() as { name: string }[]).map(row => row.name).filter(isEntityName)
  const typed = (store.db.prepare(`
    SELECT DISTINCT c.subject AS name FROM (${currentSql}) c
    WHERE c.verb = 'IS' AND c.negated = 0 AND c.conf > 0 AND c.object IS NOT NULL
  `).all() as { name: string }[]).map(row => row.name).filter(isEntityName)
  return {
    rows: count(store, 'SELECT COUNT(*) AS n FROM cave_claim'),
    facts: count(store, 'SELECT COUNT(DISTINCT claim_key) AS n FROM cave_claim'),
    current: count(store, `SELECT COUNT(*) AS n FROM (${currentSql}) c WHERE c.conf > 0 AND c.negated = 0`),
    retracted: count(store, `SELECT COUNT(*) AS n FROM (${currentSql}) c WHERE c.conf = 0`),
    negated: count(store, `SELECT COUNT(*) AS n FROM (${currentSql}) c WHERE c.conf > 0 AND c.negated = 1`),
    averageConfidence: average,
    lowConfidence: count(store, `SELECT COUNT(*) AS n FROM (${currentSql}) c WHERE c.conf > 0 AND c.conf < 0.3`),
    entities: new Set(names).size,
    typedEntities: typed.length,
    expectations: evaluation.expectations.length,
    instances: evaluation.instances,
    checks: evaluation.checks,
    satisfied: evaluation.checks - evaluation.violations.length
  }
}

/**
 * The knowledge-health report (spec §20.2): shape violations, stale
 * beliefs, review candidates (`conf 0.3–0.7`, §13.5), alias disagreements
 * and coverage. Violations are the failing section; the rest is advisory.
 */
export const check = (store: Store, options: Options = {}): Report => {
  const evaluation = evaluate(store)
  return {
    expectations: evaluation.expectations,
    violations: evaluation.violations,
    stale: staleRows(store, options.staleDays ?? defaultStaleDays, (options.now ?? Date.now)()),
    review: all(store, `
      SELECT c.* FROM (${currentSql}) c
      WHERE c.conf >= 0.3 AND c.conf <= 0.7 ORDER BY c.conf, c.tx
    `),
    disagreements: findDisagreements(store),
    coverage: coverage(store, evaluation)
  }
}
