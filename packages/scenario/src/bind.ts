import { createHash } from 'node:crypto'
import * as Canonical from '@cavelang/canonical'
import { Uuidv7 } from '@cavelang/core'
import { Pattern, query, type Match, type Options as QueryOptions } from '@cavelang/query'
import { Exact } from '@cavelang/solver'
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

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const invalid = (message: string, bindingId?: string): never => {
  throw new ScenarioInputError('invalid-definition', message, bindingId)
}

const validateBinding = (binding: Binding): void => {
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
  if (binding.expected.kind === 'enum') {
    if (binding.expected.values.length === 0 || new Set(binding.expected.values).size !== binding.expected.values.length) {
      invalid('enum values must be non-empty and unique', binding.id)
    }
  }
  if (binding.expected.kind === 'number' || binding.expected.kind === 'integer') {
    for (const conversion of binding.expected.conversions ?? []) {
      if (conversion.from === conversion.to) invalid('unit conversion must change the unit', binding.id)
      if (Exact.compare(conversion.factor, '0') <= 0) invalid('unit conversion factor must be positive', binding.id)
    }
  }
  const pattern: Pattern.t = (() => {
    try {
      return Pattern.parse(binding.query)
    } catch (error) {
      return invalid(`invalid CAVE-Q pattern: ${error instanceof Error ? error.message : String(error)}`, binding.id)
    }
  })()
  if (pattern.verb.kind === 'verb' && pattern.verb.transitive) {
    invalid('transitive bindings are deferred until snapshot-aware shared query primitives are available', binding.id)
  }
}

const validateDefinition = (definition: Definition): void => {
  if (!identifierPattern.test(definition.id)) invalid('scenario identifier must use letters, numbers, dot, underscore, slash, or dash')
  if (!/^sha256:[0-9a-f]{64}$/.test(definition.modelDigest)) invalid('modelDigest must be a lowercase SHA-256 digest')
  if (!Number.isFinite(definition.snapshot.minimumConfidence) ||
      definition.snapshot.minimumConfidence < 0 || definition.snapshot.minimumConfidence > 1) {
    invalid('minimumConfidence must be between 0 and 1')
  }
  const ids = new Set<string>()
  for (const binding of definition.bindings) {
    if (ids.has(binding.id)) invalid(`duplicate binding identifier ${JSON.stringify(binding.id)}`)
    ids.add(binding.id)
    validateBinding(binding)
  }
}

const boundaryUpper = (text: string): string => {
  const start = Date.parse(text.includes('T') ? text : `${text}T00:00:00Z`)
  if (Number.isNaN(start)) throw new ScenarioInputError('invalid-definition', `cannot parse as-of boundary ${JSON.stringify(text)}`)
  return Uuidv7.at(start + (text.includes('T') ? 1_000 : 86_400_000), 0, new Uint8Array(8))
}

const transactionTime = (store: Store, asOf: string | undefined): string | null => {
  if (asOf === undefined) {
    return (store.db.prepare('SELECT MAX(tx) AS tx FROM cave_claim').get() as { tx: string | null }).tx
  }
  const id = asOf.toLowerCase()
  return Uuidv7.is(id) ?
    (store.db.prepare('SELECT MAX(tx) AS tx FROM cave_claim WHERE tx <= ?').get(id) as { tx: string | null }).tx :
    (store.db.prepare('SELECT MAX(tx) AS tx FROM cave_claim WHERE tx < ?').get(boundaryUpper(asOf)) as { tx: string | null }).tx
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
  const unresolved = query(store, pattern, queryOptions(snapshot, false))
  const winners = query(store, pattern, queryOptions(snapshot, true))
  const winnerIds = new Set(winners.flatMap(supportIds))
  const selected = snapshot.resolution === 'winner' ? winners : unresolved
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

const valueOf = (candidate: RawCandidate, binding: Binding): Value => {
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
      const authored = candidate.match.at?.text ?? candidate.match.row?.value_text ?? text
      if (authored === undefined) throw new ScenarioInputError('invalid-value', 'matched row has no numeric value', binding.id)
      const parsed = Numeric.convert(Numeric.parse(authored, binding.id), expected.unit, expected.conversions, binding.id)
      const uncertainty_ = uncertainty(candidate, expected, binding.id)
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

const publicCandidate = (candidate: RawCandidate, binding: Binding): Candidate => ({
  value: valueOf(candidate, binding),
  confidence: candidate.match.row?.conf ?? 1,
  evidence: evidenceOf(candidate)
})

const evidenceKey = (candidate: RawCandidate): string => candidate.origin === 'scenario' ?
  `scenario:${candidate.scenarioClaimId}` : `belief:${supportIds(candidate.match).join(',')}`

const reduce = (values: readonly Value[], binding: Binding): Value | readonly Value[] => {
  if (binding.cardinality !== 'many' || binding.reduce === 'all') return values
  const numeric = values as readonly Extract<Value, { kind: 'number' | 'integer' }>[]
  if (binding.reduce === 'sum') {
    const exact = numeric.reduce(
      (total, value) => Numeric.add(total, value.kind === 'integer' ? { numerator: value.value, denominator: '1' } : value.value),
      { numerator: '0', denominator: '1' }
    )
    const unit = numeric[0]?.unit
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

  const candidates = selected.map(candidate => publicCandidate(candidate, binding))
  if (selected.length === 0 && binding.policies.missing === 'omit') return { id: binding.id, candidates }
  if (selected.length === 0) return { id: binding.id, candidates, value: [] }
  const values = candidates.map(candidate => candidate.value)
  if (binding.cardinality === 'many') return { id: binding.id, candidates, value: reduce(values, binding) }
  return { id: binding.id, candidates, ...(values[0] === undefined ? {} : { value: values[0] }) }
}

export const bind = (store: Store, definition: Definition): InputRecord => {
  validateDefinition(definition)

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
  const overlay = overlayResult(store, { ...definition, snapshot: effectiveSnapshot }, canonical, claimIds)
  const bindings = definition.bindings.map(binding => bindOne(
    binding,
    base[binding.id] ?? [],
    overlay[binding.id] ?? [],
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
    snapshot: { ...definition.snapshot, transactionTime: frozenTx },
    overlay: { digest: overlayDigest, source: `scenario/${definition.id}`, claimIds },
    values,
    bindings,
    supportingRowIds,
    scenarioClaimIds
  }
  const digest = sha256(stableStringify(withoutDigest as unknown as Json))
  return { ...withoutDigest, digest }
}

/** Materializes and rolls back inputs before `evaluate` is invoked. */
export const run = async <Result>(
  store: Store,
  definition: Definition,
  evaluate: (inputs: InputRecord) => Result | Promise<Result>
): Promise<Result> => evaluate(bind(store, definition))
