/** Portable model schema understood by solver adapters. */
export const schema = 'cave.solver/model@1' as const

export type Integer = string | number

/** Exact rational input. Decimal strings are parsed without using `number`. */
export type Rational = string | {
  readonly numerator: Integer
  readonly denominator: Integer
}

export type EnumDomain = {
  readonly id: string
  readonly values: readonly string[]
  readonly description?: string
  readonly declaration?: Declaration
}

export type Declaration = {
  /** Stable model source. Prefer a repository-relative URI over a machine-local path. */
  readonly uri: string
  readonly line?: number
  readonly column?: number
}

export type Provenance = {
  readonly description?: string
  readonly declaration?: Declaration
  readonly evidenceRowIds?: readonly string[]
  readonly scenarioInputIds?: readonly string[]
}

type VariableDeclaration = { readonly id: string } & Provenance

export type Variable = VariableDeclaration & (
  | { readonly sort: 'bool' }
  | { readonly sort: 'int', readonly min: Integer, readonly max: Integer }
  | { readonly sort: 'real', readonly min?: Rational, readonly max?: Rational }
  | { readonly sort: 'enum', readonly domain: string }
)

export type Literal =
  | { readonly kind: 'literal', readonly sort: 'bool', readonly value: boolean }
  | { readonly kind: 'literal', readonly sort: 'int', readonly value: Integer }
  | { readonly kind: 'literal', readonly sort: 'real', readonly value: Rational }
  | { readonly kind: 'literal', readonly sort: 'enum', readonly domain: string, readonly value: string }

export type Expression =
  | Literal
  | { readonly kind: 'variable', readonly id: string }
  | { readonly kind: 'not', readonly value: Expression }
  | { readonly kind: 'and' | 'or', readonly operands: readonly Expression[] }
  | { readonly kind: 'implies', readonly left: Expression, readonly right: Expression }
  | { readonly kind: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte', readonly left: Expression, readonly right: Expression }
  | { readonly kind: 'add' | 'multiply', readonly operands: readonly Expression[] }
  | { readonly kind: 'subtract' | 'divide', readonly left: Expression, readonly right: Expression }
  | { readonly kind: 'negate', readonly value: Expression }
  | { readonly kind: 'if', readonly condition: Expression, readonly then: Expression, readonly else: Expression }

export type HardConstraint = Provenance & {
  readonly id: string
  readonly expression: Expression
}

export type SoftConstraint = HardConstraint & {
  /** Deliberate preference weight; never inferred from CAVE confidence. */
  readonly weight: Rational
}

export type Objective = Provenance & {
  readonly id: string
  readonly direction: 'minimize' | 'maximize'
  readonly expression: Expression
}

export type Model = {
  readonly schema: typeof schema
  readonly enums?: readonly EnumDomain[]
  readonly variables: readonly Variable[]
  readonly constraints: readonly HardConstraint[]
  readonly softConstraints?: readonly SoftConstraint[]
  /** Objective order is semantic and means lexicographic priority. */
  readonly objectives?: readonly Objective[]
}

export type t = Model

export type Value =
  | { readonly sort: 'bool', readonly value: boolean }
  | { readonly sort: 'int', readonly value: string }
  | { readonly sort: 'real', readonly numerator: string, readonly denominator: string }
  | { readonly sort: 'enum', readonly domain: string, readonly value: string }

export type Assignment = Readonly<Record<string, Value>>
