import type { Model } from '@cavelang/solver'

export const schema = 'cave.scenario/inputs@1' as const

export type Snapshot = {
  /** Transaction-time boundary. Omit to freeze the current store head. */
  readonly asOf?: string
  /** Valid-time instant passed to CAVE-Q. */
  readonly at?: string
  readonly aliases: 'exact' | 'closure'
  readonly resolution: 'coexisting' | 'winner'
  readonly minimumConfidence: number
}

export type Conversion = {
  readonly from: string
  readonly to: string
  /** Exact `to` units per one `from` unit. */
  readonly factor: Model.Rational
}

export type Expected =
  | { readonly kind: 'boolean', readonly trueValue?: string, readonly falseValue?: string }
  | { readonly kind: 'integer', readonly unit?: string, readonly conversions?: readonly Conversion[] }
  | { readonly kind: 'number', readonly unit?: string, readonly conversions?: readonly Conversion[] }
  | { readonly kind: 'enum', readonly values: readonly string[] }
  | { readonly kind: 'text' }

export type MissingPolicy = 'reject' | 'omit' | 'empty'

export type Policies = {
  readonly missing: MissingPolicy
  readonly contested: 'reject' | 'allow'
  readonly retracted: 'reject' | 'exclude' | 'include'
  readonly unresolved: 'reject' | 'allow'
}

type CommonBinding = {
  readonly id: string
  readonly query: string
  /** CAVE-Q variable to bind. Omit only for Boolean existence inputs. */
  readonly select?: string
  readonly expected: Expected
  readonly scenarioOverride: boolean
  readonly policies: Policies
}

export type Binding = CommonBinding & (
  | { readonly cardinality: 'one' }
  | { readonly cardinality: 'optional' }
  | { readonly cardinality: 'many', readonly reduce: 'all' | 'min' | 'max' | 'sum' }
)

export type Definition = {
  readonly id: string
  /** Digest of the portable model or evaluator receiving these inputs. */
  readonly modelDigest: string
  readonly snapshot: Snapshot
  readonly overlay?: string
  readonly bindings: readonly Binding[]
}

export type ExactNumber = {
  readonly numerator: string
  readonly denominator: string
}

export type Uncertainty = {
  readonly authored: string
  readonly exact: ExactNumber
  readonly unit?: string
  readonly sigmaLevel: number
}

export type Value =
  | { readonly kind: 'boolean', readonly value: boolean }
  | { readonly kind: 'integer', readonly value: string, readonly unit?: string, readonly authored?: string, readonly approximate: boolean, readonly uncertainty?: Uncertainty }
  | { readonly kind: 'number', readonly value: ExactNumber, readonly unit?: string, readonly authored?: string, readonly approximate: boolean, readonly uncertainty?: Uncertainty }
  | { readonly kind: 'enum', readonly value: string }
  | { readonly kind: 'text', readonly value: string }

export type Evidence =
  | { readonly origin: 'belief', readonly rowIds: readonly string[] }
  | { readonly origin: 'scenario', readonly claimIds: readonly string[] }

export type Candidate = {
  readonly value: Value
  readonly confidence: number
  readonly evidence: readonly Evidence[]
}

export type BindingResult = {
  readonly id: string
  readonly candidates: readonly Candidate[]
  readonly value?: Value | readonly Value[]
}

export type FrozenSnapshot = Snapshot & {
  /** Exact newest base row visible at `asOf`, or null for an empty snapshot. */
  readonly transactionTime: string | null
}

export type InputRecord = {
  readonly schema: typeof schema
  readonly scenarioId: string
  readonly modelDigest: string
  readonly digest: string
  readonly snapshot: FrozenSnapshot
  readonly overlay: {
    readonly digest: string
    readonly source: string
    readonly claimIds: readonly string[]
  }
  readonly values: Readonly<Record<string, Value | readonly Value[]>>
  readonly bindings: readonly BindingResult[]
  readonly supportingRowIds: readonly string[]
  readonly scenarioClaimIds: readonly string[]
}

export type t = InputRecord
