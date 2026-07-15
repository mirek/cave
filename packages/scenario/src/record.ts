import { Buffer } from 'node:buffer'
import type { Explain } from '@cavelang/solver'
import { Key } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import type { Store } from '@cavelang/store'

export const resultSchema = 'cave.scenario/result@1' as const
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

export type Artifact = Result | Recommendation | Decision | Action | ExternalEffect
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
  if (id === '') throw new TypeError(`${kind} id must not be empty`)
  return `${prefix[kind]}/${id}`
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const canonicalJson = (value: unknown): string => {
  const normalize = (item: unknown, path: string): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError(`${path} must be finite`)
      return item
    }
    if (Array.isArray(item)) return item.map((entry, index) => normalize(entry, `${path}[${index}]`))
    if (typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, normalize(entry, `${path}.${key}`)]))
    }
    throw new TypeError(`${path} is not JSON`)
  }
  return JSON.stringify(normalize(value, 'artifact'))
}

const encode = (artifact: Artifact): string =>
  Buffer.from(canonicalJson(artifact), 'utf8').toString('base64url')

const decode = (payload: string): Artifact => {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new TypeError('recorded scenario artifact is not valid base64url JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { schema?: unknown }).schema !== 'string') {
    throw new TypeError('recorded scenario artifact has no schema')
  }
  const schema = (parsed as { schema: string }).schema
  if (![resultSchema, recommendationSchema, decisionSchema, actionSchema, externalEffectSchema].includes(schema as never)) {
    throw new TypeError(`unsupported recorded scenario artifact schema ${JSON.stringify(schema)}`)
  }
  return parsed as Artifact
}

const line = (kind: Kind, id: string, payload: string): string =>
  `${entity(kind, id)} HAS artifact: \`${payload}\` @src:${source[kind]}`

const claimOf = (store: Store, kind: Kind, id: string, payload: string) => {
  const parsed = canonicalizeText(line(kind, id, payload), store.registry())
  const claim = parsed.claims[0]?.claim
  if (parsed.problems.length > 0 || claim === undefined) {
    const detail = parsed.problems.map(problem => `line ${problem.line}: ${problem.message}`).join('; ')
    throw new TypeError(`invalid ${kind} identity ${JSON.stringify(id)}${detail === '' ? '' : `: ${detail}`}`)
  }
  return { parsed, claim }
}

const currentPayload = (store: Store, kind: Kind, id: string): undefined | { payload: string, rowId: string } => {
  // The payload is excluded from an attribute claim key, so an empty
  // placeholder locates the one append-only series for this artifact ID.
  const { claim } = claimOf(store, kind, id, '')
  const row = store.currentBelief(Key.of(claim))
  if (row === undefined || row.conf === 0) return undefined
  const stored = store.toClaim(row)
  if (stored.payload.kind !== 'attribute' || stored.payload.attribute !== 'artifact' || stored.payload.value.kind !== 'code') {
    throw new TypeError(`${kind} ${JSON.stringify(id)} has an invalid stored representation`)
  }
  return { payload: stored.payload.value.raw, rowId: row.id }
}

const requireRecord = <T extends Artifact>(store: Store, kind: Kind, id: string): T => {
  const found = currentPayload(store, kind, id)
  if (found === undefined) throw new MissingRecordError(kind, id)
  const artifact = decode(found.payload)
  if (kindOf(artifact) !== kind || artifact.id !== id) {
    throw new TypeError(`${kind} ${JSON.stringify(id)} has mismatched stored identity`)
  }
  return artifact as T
}

const append = (store: Store, artifact: Artifact, validate: () => void): RecordOutcome =>
  store.transaction(() => {
    validate()
    const kind = kindOf(artifact)
    const payload = encode(artifact)
    const existing = currentPayload(store, kind, artifact.id)
    if (existing !== undefined) {
      if (existing.payload !== payload) throw new RecordConflictError(kind, artifact.id)
      return { status: 'existing', rowId: existing.rowId, artifact }
    }
    const { parsed } = claimOf(store, kind, artifact.id, payload)
    const inserted = store.insertResult(parsed)
    return { status: 'recorded', rowId: inserted.ids[0]!, artifact }
  })

export const result = (store: Store, artifact: Result): RecordOutcome =>
  append(store, artifact, () => {
    if (artifact.report.schema !== 'cave.solver/explanation@1') {
      throw new TypeError(`unsupported solver explanation schema ${JSON.stringify(artifact.report.schema)}`)
    }
  })

export const recommendation = (store: Store, artifact: Recommendation): RecordOutcome =>
  append(store, artifact, () => { requireRecord<Result>(store, 'result', artifact.resultId) })

export const decision = (store: Store, artifact: Decision): RecordOutcome =>
  append(store, artifact, () => {
    requireRecord<Result>(store, 'result', artifact.resultId)
    if (artifact.recommendationId !== undefined) {
      const proposal = requireRecord<Recommendation>(store, 'recommendation', artifact.recommendationId)
      if (proposal.resultId !== artifact.resultId) {
        throw new TypeError(`recommendation ${JSON.stringify(artifact.recommendationId)} belongs to another result`)
      }
    }
  })

export const action = (store: Store, artifact: Action): RecordOutcome =>
  append(store, artifact, () => { requireRecord<Decision>(store, 'decision', artifact.decisionId) })

export const externalEffect = (store: Store, artifact: ExternalEffect): RecordOutcome =>
  append(store, artifact, () => { requireRecord<Action>(store, 'action', artifact.actionId) })

export const read = <T extends Artifact>(store: Store, kind: Kind, id: string): T =>
  requireRecord<T>(store, kind, id)

/**
 * Reads an immutable result without re-running it. Compatibility is explicit:
 * a different model or backend version is reported, never silently upgraded.
 */
export const replay = (store: Store, id: string, expected: ReplayExpectation): Replay => {
  const artifact = requireRecord<Result>(store, 'result', id)
  const reasons: string[] = []
  if (artifact.report.run.modelDigest !== expected.modelDigest) {
    reasons.push(`model digest ${artifact.report.run.modelDigest} does not match ${expected.modelDigest}`)
  }
  if (expected.backend !== undefined) {
    const actual = artifact.report.run.backend
    if (actual.name !== expected.backend.name) {
      reasons.push(`solver backend ${actual.name} does not match ${expected.backend.name}`)
    }
    if (actual.version !== expected.backend.version) {
      reasons.push(`solver version ${actual.version} does not match ${expected.backend.version}`)
    }
  }
  return { artifact, compatible: reasons.length === 0, reasons }
}
