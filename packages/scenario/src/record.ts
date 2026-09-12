import { Buffer } from 'node:buffer'
import { Validate, type Explain } from '@cavelang/solver'
import { Key } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import type { Row, Store } from '@cavelang/store'
import type { InputRecord } from './model.ts'
import { inputDigest } from './bind.ts'
import { validateExplanationEntries } from './explanation-entries.ts'

export const resultSchema = 'cave.scenario/result@1' as const
export const evaluationSchema = 'cave.scenario/evaluation@1' as const
export const recommendationSchema = 'cave.scenario/recommendation@1' as const
export const decisionSchema = 'cave.scenario/decision@1' as const
export const actionSchema = 'cave.scenario/action@1' as const
export const externalEffectSchema = 'cave.scenario/external-effect@1' as const

export type Result = {
  readonly schema: typeof resultSchema
  /** Stable caller-supplied identity. Reusing it with different content is an error. */
  readonly id: string
  readonly report: Explain.Report
}

/** Ordinary external-evaluator result over one frozen scenario input record. */
export type Evaluation = {
  readonly schema: typeof evaluationSchema
  readonly id: string
  readonly inputs: InputRecord
  readonly evaluator: {
    readonly name: string
    readonly version: string
  }
  readonly output: Explain.Json
}

export type ResultArtifact = Result | Evaluation

export type Recommendation = {
  readonly schema: typeof recommendationSchema
  readonly id: string
  readonly resultId: string
  readonly value: Explain.Json
  readonly rationale?: string
  readonly authoredBy?: string
}

export type Decision = {
  readonly schema: typeof decisionSchema
  readonly id: string
  readonly resultId: string
  readonly recommendationId?: string
  readonly selected: Explain.Json
  readonly decidedBy: string
  readonly rationale?: string
}

/** Audit record only. Creating it never invokes an action or external hook. */
export type Action = {
  readonly schema: typeof actionSchema
  readonly id: string
  readonly decisionId: string
  readonly name: string
  readonly parameters: Explain.Json
  readonly status: 'validated' | 'executed' | 'failed'
  readonly message?: string
}

/** Audit record only. External effects remain owned by governed action execution. */
export type ExternalEffect = {
  readonly schema: typeof externalEffectSchema
  readonly id: string
  readonly actionId: string
  readonly kind: string
  readonly status: 'succeeded' | 'failed' | 'unknown'
  readonly details?: Explain.Json
}

export type Artifact = ResultArtifact | Recommendation | Decision | Action | ExternalEffect
export type Kind = 'result' | 'recommendation' | 'decision' | 'action' | 'external-effect'

export type RecordOutcome = {
  readonly status: 'recorded' | 'existing'
  readonly rowId: string
  readonly artifact: Artifact
}

export type ReplayExpectation = {
  readonly modelDigest: string
  readonly backend?: {
    readonly name: string
    readonly version: string
  }
}

export type Replay = {
  readonly artifact: Result
  readonly compatible: boolean
  readonly reasons: readonly string[]
}

export class RecordConflictError extends Error {
  constructor(kind: Kind, id: string) {
    super(`${kind} ${JSON.stringify(id)} is already recorded with different content`)
    this.name = 'RecordConflictError'
  }
}

export class MissingRecordError extends Error {
  constructor(kind: Kind, id: string) {
    super(`${kind} ${JSON.stringify(id)} is not recorded`)
    this.name = 'MissingRecordError'
  }
}

const kindOf = (artifact: Artifact): Kind => {
  switch (artifact.schema) {
    case resultSchema: return 'result'
    case evaluationSchema: return 'result'
    case recommendationSchema: return 'recommendation'
    case decisionSchema: return 'decision'
    case actionSchema: return 'action'
    case externalEffectSchema: return 'external-effect'
  }
}

const prefix: Readonly<Record<Kind, string>> = {
  result: 'scenario-result',
  recommendation: 'scenario-recommendation',
  decision: 'scenario-decision',
  action: 'scenario-action',
  'external-effect': 'scenario-effect'
}

const source: Readonly<Record<Kind, string>> = {
  result: 'scenario/result',
  recommendation: 'scenario/recommendation',
  decision: 'scenario/decision',
  action: 'scenario/action',
  'external-effect': 'scenario/external-effect'
}

const entity = (kind: Kind, id: string): string => {
  if (typeof id !== 'string' || id === '') throw new TypeError(`${kind} id must be a non-empty string`)
  return `${prefix[kind]}/${id}`
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const canonicalJson = (value: unknown): string => {
  const ancestors = new Set<object>()
  type Child = { value: unknown, path: string }
  const normalize = function* (item: unknown, path: string): Generator<Child, unknown, unknown> {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError(`${path} must be finite`)
      return item
    }
    if (typeof item === 'object') {
      if (ancestors.has(item)) throw new TypeError(`${path} contains a cycle`)
      const prototype = Object.getPrototypeOf(item)
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must be a plain JSON object`)
      }
      ancestors.add(item)
      try {
        // Read JSON's indexed array values, ignoring custom iterators, and visit
        // holes so they fail instead of silently becoming null during stringify.
        if (Array.isArray(item)) {
          const length = item.length
          const values: unknown[] = []
          for (let index = 0; index < length; index++) {
            values.push(yield { value: item[index], path: `${path}[${index}]` })
          }
          return values
        }
        const entries = Object.entries(item as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => compareText(left, right))
        const values: [string, unknown][] = []
        for (const [key, entry] of entries) {
          values.push([key, yield { value: entry, path: `${path}.${key}` }])
        }
        return Object.fromEntries(values)
      } finally {
        ancestors.delete(item)
      }
    }
    throw new TypeError(`${path} is not JSON`)
  }
  const stack = [normalize(value, 'artifact')]
  let step = stack[0]!.next()
  while (true) {
    if (step.done) {
      stack.pop()
      if (stack.length === 0) break
      step = stack[stack.length - 1]!.next(step.value)
    } else {
      const child = normalize(step.value.value, step.value.path)
      stack.push(child)
      step = child.next()
    }
  }
  // Serialize the owned tree iteratively too: JSON.stringify recurses through
  // containers. Retain its property order, including numeric-index keys.
  const pending: ({ value: unknown } | { text: string })[] = [{ value: step.value }]
  const output: string[] = []
  while (pending.length > 0) {
    const frame = pending.pop()!
    if ('text' in frame) { output.push(frame.text); continue }
    const item = frame.value
    if (item === null || typeof item !== 'object') {
      output.push(JSON.stringify(item))
    } else if (Array.isArray(item)) {
      output.push('[')
      pending.push({ text: ']' })
      for (let index = item.length - 1; index >= 0; index--) {
        pending.push({ value: item[index] })
        if (index > 0) pending.push({ text: ',' })
      }
    } else {
      const entries = Object.entries(item)
      output.push('{')
      pending.push({ text: '}' })
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, child] = entries[index]!
        pending.push({ value: child }, { text: `${JSON.stringify(key)}:` })
        if (index > 0) pending.push({ text: ',' })
      }
    }
  }
  return output.join('')
}

const decode = (payload: string): Artifact => {
  let parsed: unknown
  try {
    // Buffer's decoder ignores non-alphabet characters and surplus padding.
    // Accept URL-safe text with either no padding or exactly the required padding.
    const bytes = Buffer.from(payload, 'base64url')
    const unpadded = bytes.toString('base64url')
    const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=')
    if (payload !== unpadded && payload !== padded) throw new TypeError('invalid base64url encoding')
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
    // A JSON reviver recurses through the payload and rejects otherwise valid
    // deeply nested imports when the JavaScript call stack is exhausted.
    const pending: unknown[] = [parsed]
    while (pending.length > 0) {
      const value = pending.pop()
      if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite JSON number')
      if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) pending.push(child)
      }
    }
  } catch {
    throw new TypeError('recorded scenario artifact is not valid base64url JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { schema?: unknown }).schema !== 'string') {
    throw new TypeError('recorded scenario artifact has no schema')
  }
  const schema = (parsed as { schema: string }).schema
  if (![resultSchema, evaluationSchema, recommendationSchema, decisionSchema, actionSchema, externalEffectSchema].includes(schema as never)) {
    throw new TypeError(`unsupported recorded scenario artifact schema ${JSON.stringify(schema)}`)
  }
  return parsed as Artifact
}

const line = (kind: Kind, id: string, payload: string): string =>
  `${entity(kind, id)} HAS artifact: \`${payload}\` @src:${source[kind]}`

const claimOf = (store: Store, kind: Kind, id: string, payload: string) => {
  const parsed = canonicalizeText(line(kind, id, payload), store.registry())
  const claim = parsed.claims[0]?.claim
  if (parsed.problems.length > 0 || parsed.claims.length !== 1 || parsed.edges.length !== 0 ||
    claim === undefined || claim.subject.kind !== 'entity' || claim.subject.text !== entity(kind, id) ||
    claim.verb !== 'HAS' || claim.payload.kind !== 'attribute' ||
    claim.payload.attribute !== 'artifact' || claim.payload.value.kind !== 'code' || claim.payload.value.raw !== payload) {
    const detail = parsed.problems.map(problem => `line ${problem.line}: ${problem.message}`).join('; ')
    throw new TypeError(`invalid ${kind} identity ${JSON.stringify(id)}${detail === '' ? '' : `: ${detail}`}`)
  }
  return { parsed, claim }
}

const payloadOf = (store: Store, kind: Kind, id: string, row: Row.t): string => {
  const stored = store.toClaim(row)
  if (stored.payload.kind !== 'attribute' || stored.payload.attribute !== 'artifact' || stored.payload.value.kind !== 'code') {
    throw new TypeError(`${kind} ${JSON.stringify(id)} has an invalid stored representation`)
  }
  return stored.payload.value.raw
}

const currentPayload = (store: Store, kind: Kind, id: string): undefined | { payload: string, rowId: string } => {
  // The payload is excluded from an attribute claim key, so an empty
  // placeholder locates the one append-only series for this artifact ID.
  const { claim } = claimOf(store, kind, id, '')
  const row = store.currentBelief(Key.of(claim))
  if (row === undefined || row.conf === 0) return undefined
  return { payload: payloadOf(store, kind, id, row), rowId: row.id }
}

const requireRecord = <T extends Artifact>(store: Store, kind: Kind, id: string): T => {
  const found = currentPayload(store, kind, id)
  if (found === undefined) throw new MissingRecordError(kind, id)
  const artifact = decode(found.payload)
  if (kindOf(artifact) !== kind || artifact.id !== id) {
    throw new TypeError(`${kind} ${JSON.stringify(id)} has mismatched stored identity`)
  }
  validateArtifact(artifact)
  return artifact as T
}

const append = <T extends Artifact>(store: Store, kind: Kind, supplied: T, validate: (artifact: T) => void): RecordOutcome => {
  if (typeof supplied !== 'object' || supplied === null) {
    throw new TypeError(`unsupported ${kind} artifact schema — expected an object`)
  }
  // Validation, predecessor checks and storage must observe the same JSON.
  const json = canonicalJson(supplied)
  const artifact = JSON.parse(json) as T
  if (kindOf(artifact) !== kind) {
    throw new TypeError(`unsupported ${kind} artifact schema ${JSON.stringify(artifact.schema)}`)
  }
  return store.transaction(() => {
    validateArtifact(artifact)
    validate(artifact)
    const payload = Buffer.from(json, 'utf8').toString('base64url')
    const { parsed, claim } = claimOf(store, kind, artifact.id, payload)
    // Retraction changes current belief, not ownership of an immutable ID.
    // Inspect every event, even when the latest event matches or is retracted.
    for (const row of store.history(Key.of(claim))) {
      if (payloadOf(store, kind, artifact.id, row) !== payload) throw new RecordConflictError(kind, artifact.id)
    }
    const existing = currentPayload(store, kind, artifact.id)
    if (existing !== undefined) {
      if (existing.payload !== payload) throw new RecordConflictError(kind, artifact.id)
      return { status: 'existing', rowId: existing.rowId, artifact }
    }
    const inserted = store.insertResult(parsed)
    return { status: 'recorded', rowId: inserted.ids[0]!, artifact }
  })
}

const validateResult = (artifact: ResultArtifact): void => {
  if (artifact.schema === resultSchema && artifact.report.schema !== 'cave.solver/explanation@1') {
    throw new TypeError(`unsupported solver explanation schema ${JSON.stringify(artifact.report.schema)}`)
  }
  if (artifact.schema === resultSchema) {
    requiredText(artifact.report.run?.modelDigest, 'solver model digest')
    requiredText(artifact.report.run?.backend?.name, 'solver backend name')
    requiredText(artifact.report.run?.backend?.version, 'solver backend version')
    const outcome = artifact.report.outcome
    requiredStatus(outcome?.status, ['satisfied', 'optimal', 'unsatisfied', 'unknown'], 'solver explanation status')
    if (outcome.status === 'optimal' && outcome.optimalityProved !== true) {
      throw new TypeError('optimal solver explanation requires optimalityProved: true')
    }
    if (outcome.status === 'unsatisfied' && outcome.infeasibilityProved !== true) {
      throw new TypeError('unsatisfied solver explanation requires infeasibilityProved: true')
    }
    if (outcome.status === 'unsatisfied' && outcome.coreMinimal !== false) {
      throw new TypeError('unsatisfied solver explanation requires coreMinimal: false; core minimality is not promised')
    }
    const collection = (value: unknown, field: string): void => {
      if (!Array.isArray(value)) throw new TypeError(`solver explanation ${field} must be an array`)
    }
    collection(artifact.report.run.inputs, 'inputs')
    collection(artifact.report.run.diagnostics, 'diagnostics')
    if (outcome.status === 'satisfied' || outcome.status === 'optimal') {
      collection(outcome.assignments, 'assignments')
      collection(outcome.hardConstraints, 'hardConstraints')
      collection(outcome.softConstraints, 'softConstraints')
    }
    if (outcome.status === 'unknown') Validate.unknownReason(outcome.reason)
    if (outcome.status === 'optimal') collection(outcome.objectives, 'objectives')
    if (outcome.status === 'unsatisfied' && outcome.core !== undefined) collection(outcome.core, 'core')
    Validate.resultMetadata(artifact.report.run)
    validateExplanationEntries(artifact.report)
    Validate.explanationContext(artifact.report.run)
    const limits = artifact.report.run.limits
    if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) {
      throw new TypeError('solver explanation limits must be an object')
    }
    // Validate declared limits, but do not rewrite historical metadata with
    // defaults introduced after the recorded run.
    Validate.mergeLimits(limits)
  }
  if (artifact.schema === evaluationSchema) {
    if (artifact.inputs.schema !== 'cave.scenario/inputs@1') {
      throw new TypeError(`unsupported scenario input schema ${JSON.stringify(artifact.inputs.schema)}`)
    }
    if (typeof artifact.evaluator?.name !== 'string' || artifact.evaluator.name === '' ||
        typeof artifact.evaluator?.version !== 'string' || artifact.evaluator.version === '') {
      throw new TypeError('scenario evaluator name and version must be non-empty strings')
    }
    if (artifact.output === undefined) throw new TypeError('scenario evaluation output is required; use null for no value')
    const { digest, ...contents } = artifact.inputs
    if (digest !== inputDigest(contents)) throw new TypeError('scenario record input digest does not match its contents')
  }
}

export const result = (store: Store, artifact: ResultArtifact): RecordOutcome =>
  append(store, 'result', artifact, () => undefined)

const requiredText = (value: unknown, field: string): void => {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${field} must be a non-empty string`)
}

const optionalText = (value: unknown, field: string): void => {
  if (value !== undefined && typeof value !== 'string') throw new TypeError(`${field} must be a string`)
}

const requiredValue = (value: unknown, field: string): void => {
  if (value === undefined) throw new TypeError(`${field} is required; use null for no value`)
}

const requiredStatus = (value: unknown, choices: readonly string[], field: string): void => {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new TypeError(`${field} must be one of ${choices.join(', ')}`)
  }
}

const validateArtifact = (artifact: Artifact): void => {
  switch (artifact.schema) {
    case resultSchema: case evaluationSchema:
      validateResult(artifact)
      break
    case recommendationSchema:
      requiredValue(artifact.value, 'recommendation value')
      requiredText(artifact.resultId, 'result id')
      optionalText(artifact.rationale, 'recommendation rationale')
      optionalText(artifact.authoredBy, 'recommendation authoredBy')
      break
    case decisionSchema:
      requiredValue(artifact.selected, 'decision selected value')
      optionalText(artifact.rationale, 'decision rationale')
      requiredText(artifact.decidedBy, 'decision decidedBy')
      requiredText(artifact.resultId, 'result id')
      if (artifact.recommendationId !== undefined) requiredText(artifact.recommendationId, 'recommendation id')
      break
    case actionSchema:
      requiredValue(artifact.parameters, 'action parameters')
      requiredText(artifact.name, 'action name')
      optionalText(artifact.message, 'action message')
      requiredStatus(artifact.status, ['validated', 'executed', 'failed'], 'action status')
      requiredText(artifact.decisionId, 'decision id')
      break
    case externalEffectSchema:
      requiredText(artifact.kind, 'external effect kind')
      requiredStatus(artifact.status, ['succeeded', 'failed', 'unknown'], 'external effect status')
      requiredText(artifact.actionId, 'action id')
      break
  }
}

export const recommendation = (store: Store, artifact: Recommendation): RecordOutcome =>
  append(store, 'recommendation', artifact, artifact => {
    requireRecord<ResultArtifact>(store, 'result', artifact.resultId)
  })

export const decision = (store: Store, artifact: Decision): RecordOutcome =>
  append(store, 'decision', artifact, artifact => {
    requireRecord<ResultArtifact>(store, 'result', artifact.resultId)
    if (artifact.recommendationId !== undefined) {
      const proposal = requireRecord<Recommendation>(store, 'recommendation', artifact.recommendationId)
      if (proposal.resultId !== artifact.resultId) {
        throw new TypeError(`recommendation ${JSON.stringify(artifact.recommendationId)} belongs to another result`)
      }
    }
  })

export const action = (store: Store, artifact: Action): RecordOutcome =>
  append(store, 'action', artifact, artifact => {
    requireRecord<Decision>(store, 'decision', artifact.decisionId)
  })

export const externalEffect = (store: Store, artifact: ExternalEffect): RecordOutcome =>
  append(store, 'external-effect', artifact, artifact => {
    requireRecord<Action>(store, 'action', artifact.actionId)
  })

export const read = <T extends Artifact>(store: Store, kind: Kind, id: string): T =>
  requireRecord<T>(store, kind, id)

/**
 * Reads an immutable result without re-running it. Compatibility is explicit:
 * a different model or backend version is reported, never silently upgraded.
 */
export const replay = (store: Store, id: string, expected: ReplayExpectation): Replay => {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new TypeError('replay expectations must be an object')
  }
  const { modelDigest, backend } = expected
  requiredText(modelDigest, 'expected model digest')
  if (backend !== undefined && (backend === null || typeof backend !== 'object' || Array.isArray(backend))) {
    throw new TypeError('expected backend must be an object')
  }
  const expectedBackend = backend === undefined ? undefined : { name: backend.name, version: backend.version }
  if (expectedBackend !== undefined) {
    requiredText(expectedBackend.name, 'expected backend name')
    requiredText(expectedBackend.version, 'expected backend version')
  }
  const found = requireRecord<ResultArtifact>(store, 'result', id)
  if (found.schema !== resultSchema) {
    throw new TypeError(`result ${JSON.stringify(id)} is an external evaluation, not a solver result`)
  }
  const artifact = found
  const reasons: string[] = []
  if (artifact.report.run.modelDigest !== modelDigest) {
    reasons.push(`model digest ${artifact.report.run.modelDigest} does not match ${modelDigest}`)
  }
  if (expectedBackend !== undefined) {
    const actual = artifact.report.run.backend
    if (actual.name !== expectedBackend.name) {
      reasons.push(`solver backend ${actual.name} does not match ${expectedBackend.name}`)
    }
    if (actual.version !== expectedBackend.version) {
      reasons.push(`solver version ${actual.version} does not match ${expectedBackend.version}`)
    }
  }
  return { artifact, compatible: reasons.length === 0, reasons }
}
