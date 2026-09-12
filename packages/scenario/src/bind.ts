import { captureDefinition } from './capture.ts'
import { createHash } from 'node:crypto'
import { Time } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { Pattern, query, type Match, type Options as QueryOptions } from '@cavelang/query'
import { Exact } from '@cavelang/solver'
import { QuerySql } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { ScenarioInputError } from './error.ts'
import * as Numeric from './exact.ts'
import {
  schema,
  type Binding,
  type BindingResult,
  type Candidate,
  type Definition,
  type Evidence,
  type Expected,
  type InputRecord,
  type Snapshot,
  type Uncertainty,
  type Value
} from './model.ts'

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

type RawCandidate = {
  readonly match: Match
  readonly origin: 'belief' | 'scenario'
  readonly contested: boolean
  readonly retracted: boolean
  readonly unresolved: boolean
  readonly scenarioClaimId?: string
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const stableStringify = (value: Json): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Readonly<Record<string, Json>>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key]!)}`).join(',')}}`
}

const sha256 = (text: string): string =>
  `sha256:${createHash('sha256').update(text).digest('hex')}`

/** Freeze owned result data, including shared value/evidence arrays. */
const freezeInputs = (record: InputRecord): InputRecord => {
  const pending: object[] = [record]
  while (pending.length > 0) {
    const value = pending.pop()!
    if (Object.isFrozen(value)) continue
    Object.freeze(value)
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
  return record
}

/** JSON semantics omit undefined optional fields before stable key ordering. */
export const definitionDigest = (definition: Definition): string =>
  sha256(stableStringify(JSON.parse(JSON.stringify(definition)) as Json))

export const inputDigest = (record: Omit<InputRecord, 'digest'>): string =>
  sha256(stableStringify(JSON.parse(JSON.stringify(record)) as Json))

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const invalid = (message: string, bindingId?: string): never => {
  throw new ScenarioInputError('invalid-definition', message, bindingId)
}

const choice = (value: unknown, choices: readonly string[], name: string, bindingId?: string): void => {
  if (typeof value !== 'string' || !choices.includes(value)) {
    invalid(`${name} must be one of ${choices.join(', ')}`, bindingId)
  }
}

const requireObject = (value: unknown, name: string, bindingId?: string): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${name} must be an object`, bindingId)
  }
}

const validateBinding = (binding: Binding): void => {
  requireObject(binding, 'binding')
  if (typeof binding.id !== 'string') invalid('binding identifier must be a string')
  requireObject(binding.expected, 'expected', binding.id)
  requireObject(binding.policies, 'policies', binding.id)
  if (typeof binding.query !== 'string') invalid('query must be a string', binding.id)
  choice(binding.cardinality, ['one', 'optional', 'many'], 'cardinality', binding.id)
  choice(binding.expected.kind, ['boolean', 'integer', 'number', 'enum', 'text'], 'expected.kind', binding.id)
  choice(binding.policies.missing, ['reject', 'omit', 'empty'], 'missing policy', binding.id)
  choice(binding.policies.contested, ['reject', 'allow'], 'contested policy', binding.id)
  choice(binding.policies.retracted, ['reject', 'exclude', 'include'], 'retracted policy', binding.id)
  choice(binding.policies.unresolved, ['reject', 'allow'], 'unresolved policy', binding.id)
  if (typeof binding.scenarioOverride !== 'boolean') invalid('scenarioOverride must be a boolean', binding.id)
  if (binding.cardinality === 'many') choice(binding.reduce, ['all', 'min', 'max', 'sum'], 'reduce', binding.id)
  if (!identifierPattern.test(binding.id)) invalid('identifier must use letters, numbers, dot, underscore, slash, or dash', binding.id)
  if (binding.expected.kind !== 'boolean' && binding.select === undefined) {
    invalid('select is required for non-Boolean inputs', binding.id)
  }
  if (binding.cardinality === 'one' && binding.policies.missing !== 'reject') {
    invalid('cardinality one requires missing: reject', binding.id)
  }
  if (binding.cardinality === 'optional' && binding.policies.missing === 'empty') {
    invalid('cardinality optional supports missing: reject or omit', binding.id)
  }
  if (binding.cardinality === 'many' && binding.policies.missing === 'omit') {
    invalid('cardinality many supports missing: reject or empty', binding.id)
  }
  if (binding.cardinality === 'many' && binding.reduce !== 'all' &&
      binding.expected.kind !== 'number' && binding.expected.kind !== 'integer') {
    invalid(`reduction ${binding.reduce} requires a numeric input`, binding.id)
  }
  if (binding.expected.kind === 'boolean') {
    const { trueValue, falseValue } = binding.expected
    if ((trueValue !== undefined && typeof trueValue !== 'string') ||
        (falseValue !== undefined && typeof falseValue !== 'string')) {
      invalid('Boolean trueValue and falseValue must be strings when supplied', binding.id)
    }
    if ((trueValue ?? 'true') === (falseValue ?? 'false')) {
      invalid('Boolean true and false values must be distinct', binding.id)
    }
  }
  if (binding.expected.kind === 'enum') {
    const values = binding.expected.values
    if (!Array.isArray(values) || values.length === 0) {
      invalid('enum values must be a non-empty array of unique strings', binding.id)
    }
    const seen = new Set<string>()
    for (const value of values) {
      if (typeof value !== 'string' || seen.has(value)) {
        invalid('enum values must be a non-empty array of unique strings', binding.id)
      }
      seen.add(value)
    }
  }
  if (binding.expected.kind === 'number' || binding.expected.kind === 'integer') {
    if (binding.expected.unit !== undefined &&
        (typeof binding.expected.unit !== 'string' || binding.expected.unit === '')) {
      invalid('target unit must be a non-empty string when supplied', binding.id)
    }
    const conversions = binding.expected.conversions
    if (conversions !== undefined && !Array.isArray(conversions)) {
      invalid('unit conversions must be an array', binding.id)
    }
    const pairs = new Set<string>()
    for (const conversion of conversions ?? []) {
      if (conversion === null || typeof conversion !== 'object' ||
          typeof conversion.from !== 'string' || conversion.from === '' ||
          typeof conversion.to !== 'string' || conversion.to === '') {
        invalid('unit conversion endpoints must be non-empty strings', binding.id)
      }
      if (conversion.from === conversion.to) invalid('unit conversion must change the unit', binding.id)
      const pair = JSON.stringify([conversion.from, conversion.to])
      if (pairs.has(pair)) invalid('unit conversion pairs must be unique', binding.id)
      pairs.add(pair)
      let positive = false
      try { positive = Exact.compare(conversion.factor, '0') > 0 } catch {
        invalid('unit conversion factor must be a positive exact rational', binding.id)
      }
      if (!positive) invalid('unit conversion factor must be positive', binding.id)
    }
  }
  const pattern: Pattern.t = (() => {
    try {
      return Pattern.parse(binding.query)
    } catch (error) {
      return invalid(`invalid CAVE-Q pattern: ${error instanceof Error ? error.message : String(error)}`, binding.id)
    }
  })()
  if (binding.select !== undefined) {
    if (typeof binding.select !== 'string') invalid('select must be a variable name string', binding.id)
    const slots = [pattern.subject, pattern.verb,
      ...(pattern.payload.kind === 'object' ? [pattern.payload.object] :
        pattern.payload.kind === 'attribute' ? [pattern.payload.value] : [])]
    if (!slots.some(slot => slot.kind === 'var' && slot.name === binding.select)) {
      invalid('select must name a variable bound by the CAVE-Q pattern', binding.id)
    }
  }
  if (pattern.verb.kind === 'verb' && pattern.verb.transitive) {
    invalid('transitive bindings are deferred until snapshot-aware shared query primitives are available', binding.id)
  }
}

const validateDefinition = (definition: Definition): void => {
  requireObject(definition, 'definition')
  requireObject(definition.snapshot, 'snapshot')
  if (!Array.isArray(definition.bindings)) invalid('bindings must be an array')
  if (definition.overlay !== undefined && typeof definition.overlay !== 'string') {
    invalid('overlay must be a string when supplied')
  }
  choice(definition.snapshot.aliases, ['exact', 'closure'], 'snapshot.aliases')
  choice(definition.snapshot.resolution, ['coexisting', 'winner'], 'snapshot.resolution')
  const { asOf, at } = definition.snapshot
  if (asOf !== undefined && (typeof asOf !== 'string' || QuerySql.asOfBoundary(asOf) === undefined)) {
    invalid('asOf must be a valid date-like period, timestamp or UUIDv7 string')
  }
  if (at !== undefined && (typeof at !== 'string' || Time.parseInstant(at) === undefined)) {
    invalid('at must be a valid date-like period or timestamp string')
  }
  if (typeof definition.id !== 'string' || !identifierPattern.test(definition.id)) {
    invalid('scenario identifier must be a string using letters, numbers, dot, underscore, slash, or dash')
  }
  if (typeof definition.modelDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(definition.modelDigest)) {
    invalid('modelDigest must be a lowercase SHA-256 digest string')
  }
  if (!Number.isFinite(definition.snapshot.minimumConfidence) ||
      definition.snapshot.minimumConfidence < 0 || definition.snapshot.minimumConfidence > 1) {
    invalid('minimumConfidence must be between 0 and 1')
  }
  const ids = new Set<string>()
  for (const binding of definition.bindings) {
    validateBinding(binding)
    if (ids.has(binding.id)) invalid(`duplicate binding identifier ${JSON.stringify(binding.id)}`)
    ids.add(binding.id)
  }
}

const transactionTime = (store: Store, asOf: string | undefined): string | null => {
  if (asOf === undefined) {
    return (store.db.prepare('SELECT MAX(tx) AS tx FROM cave_claim').get() as { tx: string | null }).tx
  }
  const boundary = QuerySql.asOfBoundary(asOf)
  if (boundary === undefined) throw new ScenarioInputError('invalid-definition', `cannot parse as-of boundary ${JSON.stringify(asOf)}`)
  return (store.db.prepare(`SELECT MAX(tx) AS tx FROM cave_claim WHERE tx ${boundary.operator} ?`)
    .get(boundary.tx) as { tx: string | null }).tx
}

const queryOptions = (snapshot: Snapshot, resolve: boolean): QueryOptions => ({
  ...(snapshot.asOf === undefined ? {} : { asOf: snapshot.asOf }),
  ...(snapshot.at === undefined ? {} : { at: snapshot.at }),
  aliases: snapshot.aliases === 'closure',
  resolve,
  support: true
})

/** Explicit confidence filter opts CAVE-Q into returning current `@ 0%` rows. */
const includingRetractions = (input: string): string => `${input}\nWHERE conf >= 0`

const supportIds = (match: Match): readonly string[] =>
  match.row === undefined ? (match.rows ?? []).map(row => row.id) : [match.row.id]

const rawBaseCandidates = (store: Store, binding: Binding, snapshot: Snapshot): RawCandidate[] => {
  const pattern = includingRetractions(binding.query)
  const unresolved = snapshot.resolution === 'coexisting'
    ? query(store, pattern, queryOptions(snapshot, false)) : undefined
  const winners = query(store, pattern, queryOptions(snapshot, true))
  const winnerIds = new Set(winners.flatMap(supportIds))
  const selected = unresolved ?? winners
  return selected.map(match => {
    const ids = supportIds(match)
    return {
      match,
      origin: 'belief',
      contested: snapshot.resolution === 'coexisting' && ids.some(id => !winnerIds.has(id)),
      retracted: match.row?.conf === 0,
      unresolved: ids.length === 0
    }
  })
}

const overlayResult = (
  store: Store,
  definition: Definition,
  canonical: Canonical.Result,
  stableIds: readonly string[]
): Readonly<Record<string, readonly RawCandidate[]>> => {
  if (canonical.claims.length === 0) return {}
  const rolledBack = Symbol('cave-scenario-overlay')
  type Rollback = Error & { readonly [rolledBack]: Readonly<Record<string, readonly RawCandidate[]>> }
  try {
    return store.transaction(() => {
      const inserted = store.insertResult(canonical, {
        source: `scenario/${definition.id}`,
        lifecycle: true
      })
      const stableByRow = new Map(inserted.ids.map((id, index) => [id, stableIds[index]!]))
      const result: Record<string, readonly RawCandidate[]> = {}
      for (const binding of definition.bindings) {
        // Overlay claims are matched as authored. Base aliases and historical
        // rows cannot make a hypothetical claim appear under a different name.
        const matches = query(store, includingRetractions(binding.query), {
          ...(definition.snapshot.at === undefined ? {} : { at: definition.snapshot.at }),
          all: true,
          aliases: false,
          support: true
        }).filter(match => match.row !== undefined && stableByRow.has(match.row.id))
        result[binding.id] = matches.map(match => ({
          match,
          origin: 'scenario',
          contested: false,
          retracted: match.row?.conf === 0,
          unresolved: false,
          scenarioClaimId: stableByRow.get(match.row!.id)!
        }))
      }
      throw Object.assign(new Error('scenario overlay materialized'), { [rolledBack]: result })
    })
  } catch (error) {
    if (error instanceof Error && rolledBack in error) return (error as Rollback)[rolledBack]
    throw error
  }
}

const selectedText = (candidate: RawCandidate, binding: Binding): string | undefined => {
  if (binding.select !== undefined) return candidate.match.bindings[binding.select]
  if (binding.expected.kind === 'boolean') return undefined
  return candidate.match.at?.text ?? candidate.match.row?.value_text ?? undefined
}

const plain = (text: string): string =>
  text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('`') && text.endsWith('`'))) ?
    text.slice(1, -1) : text

const uncertainty = (candidate: RawCandidate, expected: Extract<Expected, { kind: 'number' | 'integer' }>, bindingId: string): Uncertainty | undefined => {
  const row = candidate.match.row
  if (row?.delta_text === null || row?.delta_text === undefined) return undefined
  const parsed = Numeric.convert(Numeric.parse(row.delta_text, bindingId), expected.unit, expected.conversions, bindingId)
  return {
    authored: row.delta_text,
    exact: parsed.exact,
    ...(parsed.unit === undefined ? {} : { unit: parsed.unit }),
    sigmaLevel: row.sigma_level ?? 2
  }
}

const valueOf = (candidate: RawCandidate, binding: Binding, selectsAttributeValue: boolean): Value => {
  const expected = binding.expected
  const text = selectedText(candidate, binding)
  switch (expected.kind) {
    case 'boolean': {
      if (binding.select === undefined) return { kind: 'boolean', value: true }
      if (text === undefined) throw new ScenarioInputError('invalid-value', `query did not bind ?${binding.select}`, binding.id)
      const value = plain(text)
      const yes = expected.trueValue ?? 'true'
      const no = expected.falseValue ?? 'false'
      if (value !== yes && value !== no) {
        throw new ScenarioInputError('invalid-value', `expected ${JSON.stringify(yes)} or ${JSON.stringify(no)}, received ${JSON.stringify(value)}`, binding.id)
      }
      return { kind: 'boolean', value: value === yes }
    }
    case 'enum': {
      if (text === undefined) throw new ScenarioInputError('invalid-value', `query did not bind ?${binding.select}`, binding.id)
      const value = plain(text)
      if (!expected.values.includes(value)) {
        throw new ScenarioInputError('invalid-value', `value ${JSON.stringify(value)} is outside [${expected.values.join(', ')}]`, binding.id)
      }
      return { kind: 'enum', value }
    }
    case 'text':
      if (text === undefined) throw new ScenarioInputError('invalid-value', `query did not bind ?${binding.select}`, binding.id)
      return { kind: 'text', value: plain(text) }
    case 'integer':
    case 'number': {
      const authored = text
      if (authored === undefined) throw new ScenarioInputError('invalid-value', 'matched row has no numeric value', binding.id)
      const parsed = Numeric.convert(Numeric.parse(authored, binding.id), expected.unit, expected.conversions, binding.id)
      const uncertainty_ = selectsAttributeValue ? uncertainty(candidate, expected, binding.id) : undefined
      const common = {
        ...(parsed.unit === undefined ? {} : { unit: parsed.unit }),
        authored,
        approximate: parsed.approximate,
        ...(uncertainty_ === undefined ? {} : { uncertainty: uncertainty_ })
      }
      if (expected.kind === 'integer') {
        if (parsed.exact.denominator !== '1') {
          throw new ScenarioInputError('invalid-value', `expected an integer, received ${JSON.stringify(authored)}`, binding.id)
        }
        return { kind: 'integer', value: parsed.exact.numerator, ...common }
      }
      return { kind: 'number', value: parsed.exact, ...common }
    }
  }
}

const evidenceOf = (candidate: RawCandidate): readonly Evidence[] => candidate.origin === 'scenario' ?
  [{ origin: 'scenario', claimIds: [candidate.scenarioClaimId!] }] :
  [{ origin: 'belief', rowIds: supportIds(candidate.match) }]

const publicCandidate = (candidate: RawCandidate, binding: Binding, selectsAttributeValue: boolean): Candidate => ({
  value: valueOf(candidate, binding, selectsAttributeValue),
  confidence: candidate.match.row?.conf ?? 1,
  evidence: evidenceOf(candidate)
})

const evidenceKey = (candidate: RawCandidate): string => candidate.origin === 'scenario' ?
  `scenario:${candidate.scenarioClaimId}` : `belief:${supportIds(candidate.match).join(',')}`

const reduce = (values: readonly Value[], binding: Binding): Value | readonly Value[] => {
  if (binding.cardinality !== 'many' || binding.reduce === 'all') return values
  const numeric = values as readonly Extract<Value, { kind: 'number' | 'integer' }>[]
  const unit = numeric[0]?.unit
  if (numeric.some(value => value.unit !== unit)) {
    throw new ScenarioInputError('incompatible-unit',
      'numeric reduction requires a common unit; declare a target unit and explicit conversions', binding.id)
  }
  if (binding.reduce === 'sum') {
    const exact = numeric.reduce(
      (total, value) => Numeric.add(total, value.kind === 'integer' ? { numerator: value.value, denominator: '1' } : value.value),
      { numerator: '0', denominator: '1' }
    )
    const approximate = numeric.some(value => value.approximate)
    return binding.expected.kind === 'integer' ?
      { kind: 'integer', value: exact.numerator, ...(unit === undefined ? {} : { unit }), approximate } :
      { kind: 'number', value: exact, ...(unit === undefined ? {} : { unit }), approximate }
  }
  let selected = numeric[0]!
  for (const value of numeric.slice(1)) {
    const left = selected.kind === 'integer' ? { numerator: selected.value, denominator: '1' } : selected.value
    const right = value.kind === 'integer' ? { numerator: value.value, denominator: '1' } : value.value
    const comparison = Numeric.compare(right, left)
    if ((binding.reduce === 'min' && comparison < 0) || (binding.reduce === 'max' && comparison > 0)) selected = value
  }
  return selected
}

const bindOne = (
  binding: Binding,
  base: readonly RawCandidate[],
  overlay: readonly RawCandidate[],
  minimumConfidence: number
): BindingResult => {
  const eligible = (values: readonly RawCandidate[]): RawCandidate[] => values
    .filter(candidate => candidate.retracted && binding.policies.retracted === 'reject' ||
      candidate.match.row === undefined || candidate.match.row.conf >= minimumConfidence)
    .filter(candidate => binding.policies.retracted !== 'exclude' || !candidate.retracted)
  const baseEligible = eligible(base)
  const overlayEligible = eligible(overlay)
  const selected = (binding.scenarioOverride && overlayEligible.length > 0 ? overlayEligible : [...baseEligible, ...overlayEligible])
    .sort((left, right) => compareText(evidenceKey(left), evidenceKey(right)))

  const rejected = selected.find(candidate => candidate.retracted && binding.policies.retracted === 'reject')
  if (rejected !== undefined) throw new ScenarioInputError('retracted-input', 'matched a retracted belief', binding.id)
  if (binding.policies.contested === 'reject' && selected.some(candidate => candidate.contested)) {
    throw new ScenarioInputError('contested-input', 'matched coexisting beliefs that do not win resolution', binding.id)
  }
  if (binding.policies.unresolved === 'reject' && selected.some(candidate => candidate.unresolved)) {
    throw new ScenarioInputError('unresolved-input', 'query result has no supporting claim row', binding.id)
  }

  const countOk = binding.cardinality === 'many' || selected.length <= 1
  if (!countOk) throw new ScenarioInputError('ambiguous-input', `expected ${binding.cardinality}, matched ${selected.length} values`, binding.id)
  if (selected.length === 0 && binding.policies.missing === 'reject') {
    throw new ScenarioInputError('missing-input', 'query matched no eligible value', binding.id)
  }

  const { payload } = Pattern.parse(binding.query)
  const selectsAttributeValue = payload.kind === 'attribute' && payload.value.kind === 'var' &&
    payload.value.name === binding.select
  const candidates = selected.map(candidate => publicCandidate(candidate, binding, selectsAttributeValue))
  if (selected.length === 0 && binding.policies.missing === 'omit') return { id: binding.id, candidates }
  if (selected.length === 0) return { id: binding.id, candidates, value: [] }
  const values = candidates.map(candidate => candidate.value)
  if (binding.cardinality === 'many') return { id: binding.id, candidates, value: reduce(values, binding) }
  return { id: binding.id, candidates, ...(values[0] === undefined ? {} : { value: values[0] }) }
}

const revisionOf = (store: Store): { external: string, local: string } => ({
  external: String(store.db.prepare('PRAGMA data_version').get()!['data_version']),
  local: String(store.db.prepare('SELECT total_changes() AS changes').get()!['changes'])
})

const snapshotChanged = (): never => {
  throw new ScenarioInputError('snapshot-changed', 'store changed while binding scenario inputs; retry binding the scenario')
}


export const bind = (store: Store, definition: Definition): InputRecord => {
  definition = captureDefinition(definition)
  validateDefinition(definition)
  let authoredDigest: string
  try {
    authoredDigest = definitionDigest(definition)
  } catch {
    return invalid('definition must be JSON serializable within the supported serialization depth')
  }
  const initialRevision = revisionOf(store)

  const frozenTx = transactionTime(store, definition.snapshot.asOf)
  const effectiveSnapshot: Snapshot = definition.snapshot.asOf === undefined && frozenTx !== null ?
    { ...definition.snapshot, asOf: frozenTx } : definition.snapshot
  const registry = effectiveSnapshot.asOf === undefined ? store.registry() : store.registryAsOf(effectiveSnapshot.asOf)
  const canonical = Canonical.canonicalizeText(definition.overlay ?? '', registry)
  if (canonical.problems.length > 0) {
    const details = canonical.problems.map(problem => `line ${problem.line}: ${problem.message}`).join('; ')
    throw new ScenarioInputError('invalid-overlay', `overlay has ${canonical.problems.length} problem(s): ${details}`)
  }
  const overlayText = Canonical.emit(canonical)
  const overlayDigest = sha256(overlayText)
  const claimIds = canonical.claims.map((_, index) =>
    `scenario:${definition.id}:${overlayDigest.slice(7)}#${index + 1}`)

  const base = Object.fromEntries(definition.bindings.map(binding => [
    binding.id,
    rawBaseCandidates(store, binding, effectiveSnapshot)
  ])) as Readonly<Record<string, readonly RawCandidate[]>>
  const baseRevision = revisionOf(store)
  if (baseRevision.external !== initialRevision.external || baseRevision.local !== initialRevision.local) snapshotChanged()
  const overlay = overlayResult(store, { ...definition, snapshot: effectiveSnapshot }, canonical, claimIds)
  // Rolled-back overlay inserts advance this connection's total_changes.
  // Peer commits still invalidate the read, including commits below frozenTx.
  const materializedRevision = revisionOf(store)
  if (materializedRevision.external !== initialRevision.external) snapshotChanged()
  const bindings = definition.bindings.map(binding => bindOne(
    binding,
    base[binding.id] ?? [],
    Object.hasOwn(overlay, binding.id) ? overlay[binding.id]! : [],
    definition.snapshot.minimumConfidence
  ))
  const values: Record<string, Value | readonly Value[]> = {}
  for (const binding of bindings) if (binding.value !== undefined) values[binding.id] = binding.value

  const supportingRowIds = [...new Set(bindings.flatMap(binding => binding.candidates.flatMap(candidate =>
    candidate.evidence.flatMap(evidence => evidence.origin === 'belief' ? evidence.rowIds : []))))].sort(compareText)
  const scenarioClaimIds = [...new Set(bindings.flatMap(binding => binding.candidates.flatMap(candidate =>
    candidate.evidence.flatMap(evidence => evidence.origin === 'scenario' ? evidence.claimIds : []))))].sort(compareText)

  const withoutDigest = {
    schema,
    scenarioId: definition.id,
    modelDigest: definition.modelDigest,
    definitionDigest: authoredDigest,
    snapshot: {
      aliases: definition.snapshot.aliases,
      resolution: definition.snapshot.resolution,
      minimumConfidence: definition.snapshot.minimumConfidence,
      ...definition.snapshot.asOf === undefined ? {} : { asOf: definition.snapshot.asOf },
      ...definition.snapshot.at === undefined ? {} : { at: definition.snapshot.at },
      transactionTime: frozenTx
    },
    overlay: { digest: overlayDigest, source: `scenario/${definition.id}`, claimIds },
    values,
    bindings,
    supportingRowIds,
    scenarioClaimIds
  }
  const digest = inputDigest(withoutDigest)
  const finalRevision = revisionOf(store)
  if (finalRevision.external !== materializedRevision.external || finalRevision.local !== materializedRevision.local) snapshotChanged()
  return freezeInputs({ ...withoutDigest, digest })
}

/** Materializes and rolls back inputs before `evaluate` is invoked. */
export const run = async <Result>(
  store: Store,
  definition: Definition,
  evaluate: (inputs: InputRecord) => Result | Promise<Result>
): Promise<Result> => evaluate(bind(store, definition))
