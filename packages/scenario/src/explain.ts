import { Explain } from '@cavelang/solver'
import type { Binding, Definition, InputRecord, Value } from './model.ts'
import { schema } from './model.ts'
import { definitionDigest, inputDigest } from './bind.ts'
import { captureDefinition } from './capture.ts'

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort(compareText)

const authored = (value: Value): Explain.Json => {
  switch (value.kind) {
    case 'boolean': return value.value
    case 'integer': return value.authored ?? value.value
    case 'number': return value.authored ?? `${value.value.numerator}/${value.value.denominator}`
    case 'enum': return value.value
    case 'text': return value.value
  }
}

const authoredValue = (value: Value | readonly Value[] | undefined): Explain.Json | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value.map(authored) : authored(value as Value)

const bindingInput = (
  binding: Binding,
  result: InputRecord['bindings'][number]
): Explain.Input => {
  const evidence = result.candidates.flatMap(candidate => candidate.evidence)
  const value = result.value
  const authoredInput = authoredValue(value)
  return {
    id: result.id,
    query: binding.query,
    ...(value === undefined ? {} : { value: value as Explain.Json }),
    ...(authoredInput === undefined ? {} : { authoredValue: authoredInput }),
    evidenceRowIds: unique(evidence.flatMap(item => item.origin === 'belief' ? item.rowIds : [])),
    scenarioClaimIds: unique(evidence.flatMap(item => item.origin === 'scenario' ? item.claimIds : []))
  }
}

/** Convert a frozen scenario binding into solver-neutral run provenance. */
export const explanationContext = (definition: Definition, record: InputRecord): Explain.Context => {
  definition = captureDefinition(definition)
  record = structuredClone(record)
  if (record.schema !== schema) {
    throw new TypeError(`unsupported scenario input schema ${JSON.stringify(record.schema)}`)
  }
  if (record.scenarioId !== definition.id) {
    throw new TypeError(`scenario record ${JSON.stringify(record.scenarioId)} does not match ${JSON.stringify(definition.id)}`)
  }
  if (record.modelDigest !== definition.modelDigest) {
    throw new TypeError(`scenario record model digest does not match its definition`)
  }
  if (record.definitionDigest !== definitionDigest(definition)) {
    throw new TypeError('scenario record definition digest is missing or does not match; bind the intended definition again')
  }
  const { digest, ...contents } = record
  if (digest !== inputDigest(contents)) {
    throw new TypeError('scenario record input digest does not match its contents')
  }
  const definitions = new Map(definition.bindings.map(binding => [binding.id, binding]))
  const seen = new Set<string>()
  const inputs = record.bindings.map(result => {
    const binding = definitions.get(result.id)
    if (binding === undefined) throw new TypeError(`scenario record contains unknown binding ${JSON.stringify(result.id)}`)
    if (seen.has(result.id)) throw new TypeError(`scenario record contains duplicate binding ${JSON.stringify(result.id)}`)
    seen.add(result.id)
    return bindingInput(binding, result)
  })
  for (const id of definitions.keys()) {
    if (!seen.has(id)) throw new TypeError(`scenario record is missing binding ${JSON.stringify(id)}`)
  }
  return {
    modelDigest: record.modelDigest,
    scenario: {
      id: record.scenarioId,
      inputDigest: record.digest,
      overlayDigest: record.overlay.digest
    },
    snapshot: {
      transactionTime: record.snapshot.transactionTime,
      ...(record.snapshot.at === undefined ? {} : { validTime: record.snapshot.at }),
      aliases: record.snapshot.aliases,
      resolution: record.snapshot.resolution,
      minimumConfidence: record.snapshot.minimumConfidence
    },
    inputs
  }
}
