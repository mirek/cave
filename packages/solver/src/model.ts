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
}

export type Variable =
  | { readonly id: string, readonly sort: 'bool', readonly description?: string }
  | { readonly id: string, readonly sort: 'int', readonly min: Integer, readonly max: Integer, readonly description?: string }
  | { readonly id: string, readonly sort: 'real', readonly min?: Rational, readonly max?: Rational, readonly description?: string }
  | { readonly id: string, readonly sort: 'enum', readonly domain: string, readonly description?: string }

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

export type HardConstraint = {
  readonly id: string
  readonly expression: Expression
  readonly description?: string
  readonly evidenceRowIds?: readonly string[]
}

export type SoftConstraint = HardConstraint & {
  /** Deliberate preference weight; never inferred from CAVE confidence. */
  readonly weight: Rational
}

export type Objective = {
  readonly id: string
  readonly direction: 'minimize' | 'maximize'
  readonly expression: Expression
  readonly description?: string
  readonly evidenceRowIds?: readonly string[]
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
