/**
 * Knowledge health checks (spec §20).
 *
 * Everything here is a *read* over a store: expectations come from current
 * positive `EXPECTS` claims (§20.1), targets bind through the `EXTENDS`
 * taxonomy, and the report (§20.2) lists shape violations, stale beliefs,
 * review candidates, alias disagreements and coverage stats. Nothing is
 * written — enforcement is the opt-in gate in `gate.ts` (§20.3).
 */

import { readSnapshot } from './snapshot.ts'
import { Uuidv7, Verb } from '@cavelang/core'
import { Registry } from '@cavelang/canonical'
import { QuerySql } from '@cavelang/store'
import type { Row, Store } from '@cavelang/store'
import { aliasRoot } from './alias-root.ts'
import { constraintProblem, type ConstraintTag } from './constraints.ts'

const currentSql = QuerySql.current()

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
  /** Finite non-negative horizon in days (spec §20.2), default {@link defaultStaleDays}. */
  readonly staleDays?: number
  /** Clock returning a finite millisecond timestamp, injectable for tests. */
  readonly now?: () => number
}

export const defaultStaleDays = 90

/** Entity test for coverage/targets: not a verb token, not a stored literal. */
const isEntityName = (name: string): boolean =>
  !Verb.isVerbToken(name) && !name.startsWith('"') && !name.startsWith('`')

const all = (store: Store, sql: string, ...params: (string | number)[]): Row.t[] =>
  store.db.prepare(sql).all(...params) as unknown as Row.t[]

type ShapeState = DeclarationState & {
  /** SQL has already excluded negations/retractions; only index fields cross into JS. */
  readonly rows: readonly Pick<Row.t, 'subject' | 'verb' | 'object' | 'attribute' | 'value_unit'>[]
}

type DeclarationState = {
  readonly declarations: readonly Row.t[]
  readonly tags: ReadonlyMap<string, readonly ConstraintTag[]>
  readonly excludedDeclarations: ReadonlySet<string>
}

/**
 * One evaluation snapshot. Query count is constant: narrow current facts, full
 * declaration rows, tags and qualifier edges, independent of shape size.
 */
const shapeState = (store: Store, registry: () => Registry.t, declarations: DeclarationState, declared: readonly Expectation[]): ShapeState => {
  const verbs = new Set(['IS', 'EXTENDS'])
  const attributes = new Set<string>()
  for (const expectation of declared) {
    if (expectation.kind === 'attribute') attributes.add(expectation.name)
    else verbs.add(Registry.primaryOf(registry(), expectation.name).primary)
  }
  // Check each candidate against its complete history so a disabled latest
  // version cannot revive an older value from the same claim key.
  const rows = store.db.prepare(`SELECT c.subject, c.verb, c.object, c.attribute, c.value_unit
    FROM cave_claim c
    WHERE (c.verb IN (SELECT value FROM json_each(?))
      OR (c.verb = 'HAS' AND c.attribute IN (SELECT value FROM json_each(?))))
      AND c.conf > 0 AND c.negated = 0
      AND c.tx = (SELECT MAX(latest.tx) FROM cave_claim latest WHERE latest.claim_key = c.claim_key)
    ORDER BY c.tx`)
    .all(JSON.stringify([...verbs]), JSON.stringify([...attributes])) as unknown as ShapeState['rows']
  return { rows, ...declarations }
}

/** Declarations and their constraint/qualifier metadata, without ordinary facts. */
const declarationState = (store: Store): DeclarationState => {
  return readSnapshot(store, 'cave_shape_declarations', () => readDeclarationState(store))
}

const readDeclarationState = (store: Store): DeclarationState => {
  // Verb is part of claim identity, so filtering it before latest-row grouping
  // retains complete current EXPECTS series, including disabled declarations.
  const declarations = all(store, `${QuerySql.current("(SELECT * FROM cave_claim WHERE verb = 'EXPECTS')")} ORDER BY c.tx`)
  const declarationIds = JSON.stringify(declarations.map(row => row.id))
  const tags = new Map<string, ConstraintTag[]>()
  const tagRows = store.db.prepare(
    `SELECT claim_id, key, value FROM cave_tag
      WHERE claim_id IN (SELECT value FROM json_each(?))
        AND key IN ('unit', 'cardinality') ORDER BY rowid`
  ).all(declarationIds) as { claim_id: string, key: string, value: null | string }[]
  for (const tag of tagRows) {
    const entries = tags.get(tag.claim_id) ?? []
    entries.push(tag)
    tags.set(tag.claim_id, entries)
  }
  const excludedDeclarations = new Set((store.db.prepare(`
    SELECT DISTINCT child_id FROM cave_edge
    WHERE child_id IN (SELECT value FROM json_each(?)) AND role IN ('WHEN', 'VIA', 'BECAUSE')
  `).all(declarationIds) as { child_id: string }[]).map(row => row.child_id))
  return { declarations, tags, excludedDeclarations }
}

const tagValue = (state: DeclarationState, row: Row.t, key: string): undefined | string =>
  state.tags.get(row.id)?.find(tag => tag.key === key)?.value ?? undefined

const expectationOf = (state: DeclarationState, row: Row.t): undefined | Expectation => {
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

const expectationsOf = (state: DeclarationState): Expectation[] =>
  state.declarations.flatMap(row => {
    if (row.verb !== 'EXPECTS' || row.negated !== 0 || row.conf <= 0 || row.object === null ||
        state.excludedDeclarations.has(row.id)) return []
    const expectation = expectationOf(state, row)
    return expectation === undefined ? [] : [expectation]
  })

/**
 * Current positive `EXPECTS` declarations (spec §20.1), oldest first.
 * Qualifier condition rows never declare, mirroring the registry's
 * treatment of in-band declarations; verb-token and literal subjects are
 * not types. Internal reader for generators that collect validation problems.
 */
export const declarationSnapshot = (store: Store): {
  readonly expectations: readonly Expectation[]
  readonly tags: DeclarationState['tags']
} => {
  const state = declarationState(store)
  return { expectations: expectationsOf(state), tags: state.tags }
}

const checkedExpectations = (state: DeclarationState): Expectation[] => {
  const declared = expectationsOf(state)
  const problems = declared.flatMap(expectation => {
    const problem = constraintProblem(expectation, state.tags.get(expectation.row.id) ?? [])
    return problem === undefined ? [] : [problem]
  })
  if (problems.length > 0) throw new TypeError(`invalid shape declaration: ${problems.join('; ')}`)
  return declared
}

/** Current shape declarations, rejecting malformed constraint tags. */
export const expectations = (store: Store): Expectation[] =>
  checkedExpectations(declarationState(store))

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
    if (row.object === null) continue
    if (row.verb === 'EXTENDS') {
      const descendants = children.get(row.object) ?? []
      descendants.push(row.subject)
      children.set(row.object, descendants)
    } else if (row.verb === 'IS' && isEntityName(row.subject)) {
      typings.push({ entity: row.subject, via: row.object })
    }
  }
  return { children, typings }
}

const instancesOf = (targets: TargetIndexes, type: string): Map<string, string> => {
  const types = new Set([type])
  let frontier = [type]
  // Visit each reachable type once; cycles terminate without truncating inheritance.
  while (frontier.length > 0) {
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

const observedIndexes = (registry: () => Registry.t, state: ShapeState, declared: readonly Expectation[]): ObservedIndexes => {
  const attributes: SlotIndex = new Map()
  const forward: SlotIndex = new Map()
  const reverse: SlotIndex = new Map()
  const attributeNames = new Set<string>()
  const forwardVerbs = new Set<string>()
  const reverseVerbs = new Set<string>()
  for (const expectation of declared) {
    if (expectation.kind === 'attribute') attributeNames.add(expectation.name)
    else {
      const { primary, isInverse } = Registry.primaryOf(registry(), expectation.name)
      if (isInverse) reverseVerbs.add(primary)
      else forwardVerbs.add(primary)
    }
  }
  for (const row of state.rows) {
    if (row.verb === 'HAS' && row.attribute !== null && attributeNames.has(row.attribute)) {
      addObserved(attributes, row.attribute, row.subject, row.value_unit)
    }
    if (row.object !== null) {
      if (forwardVerbs.has(row.verb)) addObserved(forward, row.verb, row.subject)
      if (reverseVerbs.has(row.verb)) addObserved(reverse, row.verb, row.object)
    }
  }
  return { attributes, forward, reverse }
}

const observed = (
  registry: () => Registry.t,
  indexes: ObservedIndexes,
  entity: string,
  expectation: Expectation
): Observed => {
  let actual: undefined | MutableObserved
  if (expectation.kind === 'attribute') {
    actual = indexes.attributes.get(expectation.name)?.get(entity)
  } else {
    // An inverse expectation reads the object side of its stored primary.
    const { primary, isInverse } = Registry.primaryOf(registry(), expectation.name)
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
  return readSnapshot(store, 'cave_shape_evaluation', () => evaluateSnapshot(store))
}

const evaluateSnapshot = (store: Store): Evaluation => {
  // No declaration can be current if none exists in history. Check on every
  // evaluation: an action may introduce EXPECTS between its before/after gate.
  // Historical declarations still require current-version and qualifier checks.
  if (store.db.prepare("SELECT 1 FROM cave_claim WHERE verb = 'EXPECTS' LIMIT 1").get() === undefined) {
    return { expectations: [], violations: [], instances: 0, checks: 0 }
  }
  const declarations = declarationState(store)
  const declared = checkedExpectations(declarations)
  if (declared.length === 0) {
    return { expectations: [], violations: [], instances: 0, checks: 0 }
  }
  // Attribute-only shapes never need vocabulary; relation checks share one
  // version-aware registry resolved inside this read snapshot on first use.
  let vocabulary: Registry.t | undefined
  const registry = (): Registry.t => vocabulary ??= store.registry()
  const state = shapeState(store, registry, declarations, declared)
  const indexes = observedIndexes(registry, state, declared)
  const targets = targetIndexes(state)
  const byType = new Map<string, Expectation[]>()
  for (const expectation of declared) {
    const group = byType.get(expectation.type) ?? []
    group.push(expectation)
    byType.set(expectation.type, group)
  }
  const violations: Violation[] = []
  const targeted = new Set<string>()
  let checks = 0
  for (const [type, typeExpectations] of byType) {
    for (const [entity, via] of instancesOf(targets, type)) {
      targeted.add(entity)
      for (const expectation of typeExpectations) {
        checks += 1
        const actual = observed(registry, indexes, entity, expectation)
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
  const find = (name: string): string => aliasRoot(parent, name)
  for (const { a, b } of edges) {
    parent.set(find(a), find(b))
  }
  const groups = new Map<string, string[]>()
  for (const name of new Set(edges.flatMap(({ a, b }) => [a, b]))) {
    const root = find(name)
    const group = groups.get(root) ?? []
    group.push(name)
    groups.set(root, group)
  }
  return [...groups.values()].filter(group => group.length >= 2).map(group => group.sort())
}

/**
 * Scope signatures: non-`src:` contexts, sorted. Series scoped
 * to different contexts (`@prod` vs `@staging`) describe different facts
 * and never disagree; actor provenance stamps (spec §9.5) are provenance,
 * not scope, so they don't separate.
 */
const scopesOf = (store: Store, rows: readonly Row.t[]): Map<string, string[]> => {
  const scopes = new Map<string, string[]>()
  if (rows.length === 0) return scopes
  // One JSON parameter avoids both per-row reads and SQLite's variable limit.
  const contexts = store.db.prepare(`SELECT claim_id, context FROM cave_context
    WHERE claim_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(rows.map(row => row.id))) as { claim_id: string, context: string }[]
  for (const { claim_id, context } of contexts) {
    if (context.startsWith('src:')) continue
    const scope = scopes.get(claim_id) ?? []
    scope.push(context)
    scopes.set(claim_id, scope)
  }
  for (const scope of scopes.values()) scope.sort()
  return scopes
}

/** Whether two rows from different alias names actually conflict. */
const hasCrossNamePair = (
  rows: readonly Row.t[],
  valueOf: (row: Row.t) => string | number | null
): boolean => {
  const first = rows[0]
  if (first === undefined) return false
  const value = valueOf(first)
  let differentName = false
  let differentValue = false
  for (const row of rows) {
    differentName ||= row.subject !== first.subject
    differentValue ||= valueOf(row) !== value
    // With two names and two equality classes, some cross-name pair differs,
    // even when the first differing values occur under the same name.
    if (differentName && differentValue) return true
  }
  return false
}

/**
 * Cross-series conflicts inside alias groups (spec §20.2) — the checking
 * half open decision 2 deferred: union-of-rows keeps disagreeing series
 * side by side; this is what looks at them.
 */
const findDisagreements = (store: Store): Disagreement[] => {
  const disagreements: Disagreement[] = []
  const groups = aliasGroups(store)
  if (groups.length === 0) return disagreements
  const groupOf = new Map(groups.flatMap((group, index) => group.map(name => [name, index] as const)))
  const groupedRows: Row.t[][] = groups.map(() => [])
  // One ordered read avoids a bind parameter for every alias-group member.
  for (const row of all(store, `
    SELECT c.* FROM (${currentSql}) c
    WHERE c.verb <> 'ALIAS' AND c.conf > 0 ORDER BY c.tx
  `)) {
    const index = groupOf.get(row.subject)
    if (index !== undefined) groupedRows[index]!.push(row)
  }
  const scopes = scopesOf(store, groupedRows.flat())
  for (const rows of groupedRows) {
    const buckets = new Map<string, Row.t[]>()
    for (const row of rows) {
      const slot = row.attribute !== null ? `attr:${row.attribute}` : row.object !== null ? `obj:${row.object}` : ''
      if (slot === '') {
        continue
      }
      const key = JSON.stringify([row.verb, slot, scopes.get(row.id) ?? []])
      const bucket = buckets.get(key) ?? []
      bucket.push(row)
      buckets.set(key, bucket)
    }
    for (const bucket of buckets.values()) {
      const first = bucket[0]!
      if (first.attribute !== null) {
        const positives = bucket.filter(row => row.negated === 0)
        const subjects = [...new Set(positives.map(row => row.subject))].sort()
        if (hasCrossNamePair(positives, row => row.value_text)) {
          disagreements.push({ kind: 'value', about: `${first.verb} ${first.attribute}`, entities: subjects, rows: positives })
        }
      } else {
        if (hasCrossNamePair(bucket, row => row.negated)) {
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
  const totals = store.db.prepare(`SELECT
    COUNT(*) AS facts,
    COUNT(CASE WHEN c.conf > 0 AND c.negated = 0 THEN 1 END) AS current,
    COUNT(CASE WHEN c.conf = 0 THEN 1 END) AS retracted,
    COUNT(CASE WHEN c.conf > 0 AND c.negated = 1 THEN 1 END) AS negated,
    COUNT(CASE WHEN c.conf > 0 AND c.conf < 0.3 THEN 1 END) AS lowConfidence,
    AVG(CASE WHEN c.conf > 0 THEN c.conf END) AS averageConfidence
    FROM (${currentSql}) c`).get() as Pick<Coverage, 'facts' | 'current' | 'retracted' | 'negated' | 'lowConfidence' | 'averageConfidence'>
  const names = new Set<string>()
  const typed = new Set<string>()
  const entityRows = store.db.prepare(`
    SELECT c.subject, c.object, c.verb, c.negated FROM (${currentSql}) c WHERE c.conf > 0
  `).all() as Pick<Row.t, 'subject' | 'object' | 'verb' | 'negated'>[]
  for (const row of entityRows) {
    if (isEntityName(row.subject)) {
      names.add(row.subject)
      if (row.verb === 'IS' && row.negated === 0 && row.object !== null) typed.add(row.subject)
    }
    if (row.object !== null && isEntityName(row.object)) names.add(row.object)
  }
  return {
    rows: count(store, 'SELECT COUNT(*) AS n FROM cave_claim'),
    ...totals,
    entities: names.size,
    typedEntities: typed.size,
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
  const staleDays = options.staleDays ?? defaultStaleDays
  if (!Number.isFinite(staleDays) || staleDays < 0) {
    throw new TypeError('staleDays must be finite and non-negative')
  }
  const nowMs = (options.now ?? Date.now)()
  if (!Number.isFinite(nowMs)) throw new TypeError('now must return a finite timestamp')
  // A savepoint starts a deferred read transaction or nests within the caller's
  // transaction. Keep every report section on the same snapshot without taking
  // a write reservation, including on read-only connections.
  return readSnapshot(store, 'cave_health_read', () => {
    const evaluation = evaluate(store)
    return {
      expectations: evaluation.expectations,
      violations: evaluation.violations,
      stale: staleRows(store, staleDays, nowMs),
      review: all(store, `
        SELECT c.* FROM (${currentSql}) c
        WHERE c.conf >= 0.3 AND c.conf <= 0.7 ORDER BY c.conf, c.tx
      `),
      disagreements: findDisagreements(store),
      coverage: coverage(store, evaluation)
    }
  })
}
