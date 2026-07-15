import type { Backend, Diagnostic, Limits, ObjectiveValue, Result, UnknownReason } from './adapter.ts'
import * as Canonical from './canonical.ts'
import * as Exact from './exact.ts'
import type {
  Assignment,
  Declaration,
  Expression,
  HardConstraint,
  Model,
  Objective,
  Provenance,
  Rational,
  SoftConstraint,
  Value,
  Variable
} from './model.ts'

export const schema = 'cave.solver/explanation@1' as const

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json | undefined }

export type Snapshot = {
  readonly transactionTime: string | null
  readonly validTime?: string
  readonly aliases?: 'exact' | 'closure'
  readonly resolution?: 'coexisting' | 'winner'
  readonly minimumConfidence?: number
}

export type Input = {
  readonly id: string
  readonly query?: string
  readonly value?: Json
  readonly authoredValue?: Json
  readonly evidenceRowIds: readonly string[]
  readonly scenarioClaimIds: readonly string[]
}

export type Scenario = {
  readonly id: string
  readonly inputDigest: string
  readonly overlayDigest: string
}

export type Context = {
  /** Reject accidentally replaying bindings against a different model. */
  readonly modelDigest?: string
  readonly scenario?: Scenario
  readonly snapshot?: Snapshot
  readonly inputs?: readonly Input[]
}

export type Run = {
  readonly modelDigest: string
  readonly backend: Backend
  readonly elapsedMs: number
  readonly limits: Limits
  readonly diagnostics: readonly Diagnostic[]
  readonly scenario?: Scenario
  readonly snapshot?: Snapshot
  readonly inputs: readonly Input[]
}

export type Element = {
  readonly id: string
  readonly description?: string
  readonly declaration?: Declaration
  readonly evidenceRowIds: readonly string[]
  readonly scenarioInputIds: readonly string[]
}

export type AssignmentValue = Element & {
  /** False exposes an adapter value that has no matching model declaration. */
  readonly declared: boolean
  readonly value: Value
}

export type Constraint = Element & {
  readonly evaluation: 'satisfied' | 'violated' | 'indeterminate'
}

export type SoftConstraintResult = Element & {
  readonly evaluation: 'accepted' | 'violated' | 'indeterminate'
  readonly weight: ReturnType<typeof Exact.rational>
}

export type ObjectiveResult = Element & {
  /** False exposes an adapter value that has no matching model declaration. */
  readonly declared: boolean
  readonly direction: 'minimize' | 'maximize' | 'unknown'
  readonly value: Value
  readonly bound?: Value
}

export type CoreConstraint = Element & {
  /** False means the backend returned an ID absent from the submitted model. */
  readonly declared: boolean
}

type Feasible = {
  readonly assignments: readonly AssignmentValue[]
  readonly hardConstraints: readonly Constraint[]
  readonly softConstraints: readonly SoftConstraintResult[]
}

export type Outcome =
  | ({ readonly status: 'satisfied' } & Feasible)
  | ({
    readonly status: 'optimal'
    readonly objectives: readonly ObjectiveResult[]
    readonly optimalityProved: true
  } & Feasible)
  | {
    readonly status: 'unsatisfied'
    readonly core?: readonly CoreConstraint[]
    /** Solver cores explain one contradiction, but are not promised minimal. */
    readonly coreMinimal: false
    readonly infeasibilityProved: true
  }
  | { readonly status: 'unknown', readonly reason: UnknownReason }

export type Report = {
  readonly schema: typeof schema
  readonly run: Run
  readonly outcome: Outcome
}

type NumberValue = { readonly kind: 'number', readonly numerator: bigint, readonly denominator: bigint }
type Evaluated =
  | { readonly kind: 'bool', readonly value: boolean }
  | NumberValue
  | { readonly kind: 'enum', readonly domain: string, readonly value: string }

const normalize = (numerator: bigint, denominator: bigint): NumberValue => {
  if (denominator === 0n) throw new TypeError('cannot explain division by zero')
  const exact = Exact.rational({ numerator: String(numerator), denominator: String(denominator) })
  return { kind: 'number', numerator: BigInt(exact.numerator), denominator: BigInt(exact.denominator) }
}

const number = (value: Rational): NumberValue => {
  const exact = Exact.rational(value)
  return { kind: 'number', numerator: BigInt(exact.numerator), denominator: BigInt(exact.denominator) }
}

const numeric = (value: Evaluated): NumberValue => {
  if (value.kind !== 'number') throw new TypeError(`expected a numeric explanation value, received ${value.kind}`)
  return value
}

const bool = (value: Evaluated): boolean => {
  if (value.kind !== 'bool') throw new TypeError(`expected a Boolean explanation value, received ${value.kind}`)
  return value.value
}

const add = (left: NumberValue, right: NumberValue): NumberValue => normalize(
  left.numerator * right.denominator + right.numerator * left.denominator,
  left.denominator * right.denominator
)

const multiply = (left: NumberValue, right: NumberValue): NumberValue =>
  normalize(left.numerator * right.numerator, left.denominator * right.denominator)

const compare = (left: NumberValue, right: NumberValue): -1 | 0 | 1 => {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

const equal = (left: Evaluated, right: Evaluated): boolean => {
  if (left.kind === 'number' && right.kind === 'number') return compare(left, right) === 0
  if (left.kind !== right.kind) return false
  if (left.kind === 'bool' && right.kind === 'bool') return left.value === right.value
  if (left.kind === 'enum' && right.kind === 'enum') return left.domain === right.domain && left.value === right.value
  return false
}

const assigned = (value: Value): Evaluated => {
  switch (value.sort) {
    case 'bool': return { kind: 'bool', value: value.value }
    case 'int': return number({ numerator: value.value, denominator: '1' })
    case 'real': return number({ numerator: value.numerator, denominator: value.denominator })
    case 'enum': return { kind: 'enum', domain: value.domain, value: value.value }
  }
}

const evaluate = (expression: Expression, assignment: Assignment): Evaluated => {
  const run = (value: Expression): Evaluated => evaluate(value, assignment)
  switch (expression.kind) {
    case 'literal':
      switch (expression.sort) {
        case 'bool': return { kind: 'bool', value: expression.value }
        case 'int': return number({ numerator: String(Exact.integer(expression.value)), denominator: '1' })
        case 'real': return number(expression.value)
        case 'enum': return { kind: 'enum', domain: expression.domain, value: expression.value }
      }
    case 'variable': {
      const value = assignment[expression.id]
      if (value === undefined) throw new TypeError(`assignment omits ${JSON.stringify(expression.id)}`)
      return assigned(value)
    }
    case 'not': return { kind: 'bool', value: !bool(run(expression.value)) }
    case 'and': return { kind: 'bool', value: expression.operands.every(value => bool(run(value))) }
    case 'or': return { kind: 'bool', value: expression.operands.some(value => bool(run(value))) }
    case 'implies': return { kind: 'bool', value: !bool(run(expression.left)) || bool(run(expression.right)) }
    case 'eq': return { kind: 'bool', value: equal(run(expression.left), run(expression.right)) }
    case 'neq': return { kind: 'bool', value: !equal(run(expression.left), run(expression.right)) }
    case 'lt': return { kind: 'bool', value: compare(numeric(run(expression.left)), numeric(run(expression.right))) < 0 }
    case 'lte': return { kind: 'bool', value: compare(numeric(run(expression.left)), numeric(run(expression.right))) <= 0 }
    case 'gt': return { kind: 'bool', value: compare(numeric(run(expression.left)), numeric(run(expression.right))) > 0 }
    case 'gte': return { kind: 'bool', value: compare(numeric(run(expression.left)), numeric(run(expression.right))) >= 0 }
    case 'add': return expression.operands.map(run).map(numeric).reduce(add)
    case 'multiply': return expression.operands.map(run).map(numeric).reduce(multiply)
    case 'subtract': {
      const left = numeric(run(expression.left))
      const right = numeric(run(expression.right))
      return add(left, normalize(-right.numerator, right.denominator))
    }
    case 'divide': {
      const left = numeric(run(expression.left))
      const right = numeric(run(expression.right))
      return normalize(left.numerator * right.denominator, left.denominator * right.numerator)
    }
    case 'negate': {
      const value = numeric(run(expression.value))
      return normalize(-value.numerator, value.denominator)
    }
    case 'if': return bool(run(expression.condition)) ? run(expression.then) : run(expression.else)
  }
}

const sorted = (values: readonly string[] | undefined): readonly string[] =>
  [...new Set(values ?? [])].sort()

const element = (value: { readonly id: string } & Provenance): Element => ({
  id: value.id,
  ...(value.description === undefined ? {} : { description: value.description }),
  ...(value.declaration === undefined ? {} : { declaration: value.declaration }),
  evidenceRowIds: sorted(value.evidenceRowIds),
  scenarioInputIds: sorted(value.scenarioInputIds)
})

const constraint = (value: HardConstraint, assignment: Assignment): Constraint => {
  let evaluation: Constraint['evaluation'] = 'indeterminate'
  try {
    evaluation = bool(evaluate(value.expression, assignment)) ? 'satisfied' : 'violated'
  } catch { /* Keep the solver result usable when a backend uses totalized arithmetic. */ }
  return { ...element(value), evaluation }
}

const softConstraint = (value: SoftConstraint, assignment: Assignment): SoftConstraintResult => ({
  ...element(value),
  evaluation: (() => {
    try {
      return bool(evaluate(value.expression, assignment)) ? 'accepted' : 'violated'
    } catch {
      return 'indeterminate'
    }
  })(),
  weight: Exact.rational(value.weight)
})

const assignments = (model: Model, assignment: Assignment): readonly AssignmentValue[] => {
  const variables = new Map(model.variables.map(variable => [variable.id, variable]))
  return Object.entries(assignment)
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, value]) => {
      const variable: Variable | undefined = variables.get(id)
      return { ...element(variable ?? { id }), declared: variable !== undefined, value }
    })
}

const feasible = (model: Model, assignment: Assignment): Feasible => ({
  assignments: assignments(model, assignment),
  hardConstraints: model.constraints.map(value => constraint(value, assignment)),
  softConstraints: (model.softConstraints ?? []).map(value => softConstraint(value, assignment))
})

const objective = (declaration: Objective | undefined, result: ObjectiveValue): ObjectiveResult => ({
  ...element(declaration ?? { id: result.objectiveId }),
  declared: declaration !== undefined,
  direction: declaration?.direction ?? 'unknown',
  value: result.value,
  ...(result.bound === undefined ? {} : { bound: result.bound })
})

const outcome = (model: Model, result: Result): Outcome => {
  switch (result.status) {
    case 'satisfied': return { status: result.status, ...feasible(model, result.assignment) }
    case 'optimal': {
      const declarations = new Map((model.objectives ?? []).map(value => [value.id, value]))
      return {
        status: result.status,
        ...feasible(model, result.assignment),
        objectives: result.objectives.map(value => objective(declarations.get(value.objectiveId), value)),
        optimalityProved: result.optimalityProved
      }
    }
    case 'unsatisfied': {
      const declarations = new Map(model.constraints.map(value => [value.id, value]))
      return {
        status: result.status,
        ...(result.core === undefined ? {} : {
          core: result.core.map(id => {
            const declaration = declarations.get(id)
            return { ...element(declaration ?? { id }), declared: declaration !== undefined }
          })
        }),
        coreMinimal: false,
        infeasibilityProved: result.infeasibilityProved
      }
    }
    case 'unknown': return { status: result.status, reason: result.reason }
  }
}

/** Build stable JSON data without mutating the model, scenario, or CAVE store. */
export const report = (model: Model, result: Result, limits: Limits, context: Context = {}): Report => {
  const modelDigest = Canonical.digest(model)
  if (context.modelDigest !== undefined && context.modelDigest !== modelDigest) {
    throw new TypeError(`scenario model digest ${context.modelDigest} does not match ${modelDigest}`)
  }
  return {
    schema,
    run: {
      modelDigest,
      backend: result.backend,
      elapsedMs: result.elapsedMs,
      limits,
      diagnostics: result.diagnostics,
      ...(context.scenario === undefined ? {} : { scenario: context.scenario }),
      ...(context.snapshot === undefined ? {} : { snapshot: context.snapshot }),
      inputs: [...(context.inputs ?? [])].sort((left, right) => compareText(left.id, right.id))
    },
    outcome: outcome(model, result)
  }
}

const evidence = (value: Element): string => {
  const parts = [
    value.declaration === undefined ? undefined : `${value.declaration.uri}${value.declaration.line === undefined ? '' : `:${value.declaration.line}${value.declaration.column === undefined ? '' : `:${value.declaration.column}`}`}`,
    value.evidenceRowIds.length === 0 ? undefined : `rows ${value.evidenceRowIds.join(', ')}`,
    value.scenarioInputIds.length === 0 ? undefined : `inputs ${value.scenarioInputIds.join(', ')}`
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? '' : ` — ${parts.join('; ')}`
}

const valueText = (value: Value): string => {
  switch (value.sort) {
    case 'bool': return String(value.value)
    case 'int': return value.value
    case 'real': return `${value.numerator}/${value.denominator}`
    case 'enum': return value.value
  }
}

/** Render the same report as concise, deterministic plain text. */
export const render = (value: Report): string => {
  const lines = [
    `Solver result: ${value.outcome.status}`,
    `Model: ${value.run.modelDigest}`,
    `Backend: ${value.run.backend.name} ${value.run.backend.version}`,
    `Elapsed: ${value.run.elapsedMs} ms`
  ]
  if (value.run.snapshot !== undefined) {
    lines.push(`Snapshot: transaction ${value.run.snapshot.transactionTime ?? 'empty'}${value.run.snapshot.validTime === undefined ? '' : `, valid ${value.run.snapshot.validTime}`}`)
  }
  if (value.run.scenario !== undefined) lines.push(`Scenario: ${value.run.scenario.id} (${value.run.scenario.inputDigest})`)
  for (const input of value.run.inputs) {
    lines.push(`Input ${input.id}: ${JSON.stringify(input.value)}${input.query === undefined ? '' : ` via ${input.query}`}`)
  }
  switch (value.outcome.status) {
    case 'satisfied':
    case 'optimal':
      for (const assignment of value.outcome.assignments) {
        lines.push(`Assignment ${assignment.id} = ${valueText(assignment.value)}${assignment.declared ? '' : ' (undeclared backend ID)'}${evidence(assignment)}`)
      }
      for (const constraint of value.outcome.hardConstraints) {
        lines.push(`Hard constraint ${constraint.id}: ${constraint.evaluation}${evidence(constraint)}`)
      }
      for (const constraint of value.outcome.softConstraints) {
        lines.push(`Soft constraint ${constraint.id}: ${constraint.evaluation}, weight ${constraint.weight.numerator}/${constraint.weight.denominator}${evidence(constraint)}`)
      }
      if (value.outcome.status === 'optimal') {
        for (const objective of value.outcome.objectives) {
          lines.push(`Objective ${objective.id} (${objective.direction}) = ${valueText(objective.value)}${objective.declared ? '' : ' (undeclared backend ID)'}${evidence(objective)}`)
        }
      }
      break
    case 'unsatisfied':
      lines.push('Infeasibility proved. Unsatisfiable cores are not necessarily minimal.')
      for (const constraint of value.outcome.core ?? []) {
        lines.push(`Core constraint ${constraint.id}${constraint.declared ? '' : ' (undeclared backend ID)'}${evidence(constraint)}`)
      }
      break
    case 'unknown':
      lines.push(`Unknown: ${value.outcome.reason.kind} — ${value.outcome.reason.message}`)
      break
  }
  return `${lines.join('\n')}\n`
}
