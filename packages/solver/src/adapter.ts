import type { Assignment, Model, Rational, Value } from './model.ts'

export const capabilities = [
  'booleans',
  'integers',
  'rationals',
  'finite-enums',
  'conditionals',
  'nonlinear-arithmetic',
  'optimization',
  'lexicographic-objectives',
  'soft-constraints',
  'unsat-cores'
] as const

export type Capability = typeof capabilities[number]

export type Limits = {
  readonly timeoutMs: number
  /** Backend working-memory ceiling. Adapters must reject or isolate when they cannot enforce it. */
  readonly maxMemoryBytes: number
  readonly maxVariables: number
  readonly maxConstraints: number
  readonly maxObjectives: number
  readonly maxEnumValues: number
  readonly maxExpressionNodes: number
  readonly maxExpressionDepth: number
  readonly maxOutputBytes: number
}

export const defaultLimits: Limits = Object.freeze({
  timeoutMs: 10_000,
  maxMemoryBytes: 512 * 1024 * 1024,
  maxVariables: 1_000,
  maxConstraints: 5_000,
  maxObjectives: 16,
  maxEnumValues: 1_000,
  maxExpressionNodes: 100_000,
  maxExpressionDepth: 128,
  maxOutputBytes: 1_000_000
})

export type Backend = {
  readonly name: string
  readonly version: string
}

export type Diagnostic = {
  readonly level: 'info' | 'warning' | 'error'
  readonly code: string
  readonly message: string
}

type CommonResult = {
  readonly backend: Backend
  readonly diagnostics: readonly Diagnostic[]
  readonly elapsedMs: number
}

export type ObjectiveValue = {
  readonly objectiveId: string
  readonly value: Value
  readonly bound?: Value
}

export type UnknownReason = {
  readonly kind: 'timeout' | 'resource-limit' | 'cancelled' | 'backend-error' | 'indeterminate'
  readonly message: string
  readonly limit?: keyof Limits
}

export type Result = CommonResult & (
  | { readonly status: 'satisfied', readonly assignment: Assignment }
  | {
    readonly status: 'optimal'
    readonly assignment: Assignment
    readonly objectives: readonly ObjectiveValue[]
    readonly optimalityProved: true
  }
  | {
    readonly status: 'unsatisfied'
    readonly core?: readonly string[]
    readonly infeasibilityProved: true
  }
  | { readonly status: 'unknown', readonly reason: UnknownReason }
)

export type Options = {
  readonly limits?: Partial<Limits>
  readonly unsatCore?: boolean
}

export type Request = {
  readonly limits: Limits
  readonly unsatCore: boolean
}

export type SolverAdapter = {
  readonly backend: Backend
  readonly capabilities: ReadonlySet<Capability>
  readonly solve: (model: Model, request: Request) => Promise<Result>
}

export type t = SolverAdapter

/** Utility type for adapters that report exact objective bounds. */
export type ExactBound = {
  readonly value: Rational
  readonly bound?: Rational
}
