import { ExplanationBudget } from './explanation-budget.ts'
import { expressionKey } from './expression-key.ts'
import { constantSign, type Sign } from './constant-sign.ts'
import { captureResult } from './result.ts'
import { balancedReduce } from './balanced-reduce.ts'
import { sum } from './fraction-sum.ts'
import { product } from './fraction-product.ts'
import { gcd } from './integer-gcd.ts'
import { clone } from './clone.ts'
import { stringifyInput, validateContext } from './context.ts'
import { mergeLimits } from './validate.ts'
import type { Backend, Diagnostic, Limits, ObjectiveValue, Result, UnknownReason } from './adapter.ts'
import { digestOwned } from './canonical-owned.ts'
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
  /** Human-readable local evaluation failure; absent for determinate evaluations. */
  readonly evaluationReason?: string
}

export type SoftConstraintResult = Element & {
  readonly evaluation: 'accepted' | 'violated' | 'indeterminate'
  /** Human-readable local evaluation failure; absent for determinate evaluations. */
  readonly evaluationReason?: string
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

type EvaluationContext = {
  readonly expressionResults: WeakMap<Expression, Evaluation>
  readonly evaluations: Map<string, Evaluation>
  readonly expressionStrings: Map<string, number>
  readonly assignment: Assignment
  readonly budget: ExplanationBudget
  readonly signs: WeakMap<Expression, Sign>
  readonly assigned: Map<string, { readonly value: Evaluated } | { readonly error: unknown }>
  readonly variables: ReadonlyMap<string, Variable>
  readonly enumDomains: ReadonlyMap<string, ReadonlySet<string>>
}

const normalize = (numerator: bigint, denominator: bigint): NumberValue => {
  if (denominator === 0n) throw new TypeError('cannot explain division by zero')
  if (denominator < 0n) {
    numerator = -numerator
    denominator = -denominator
  }
  const divisor = gcd(numerator, denominator)
  return { kind: 'number', numerator: numerator / divisor, denominator: denominator / divisor }
}

const number = (value: Rational, budget: ExplanationBudget): NumberValue => {
  budget.input(value)
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

const add = (left: NumberValue, right: NumberValue, budget: ExplanationBudget): NumberValue => {
  if (left.numerator === 0n) return right
  if (right.numerator === 0n) return left
  if (left.denominator === right.denominator) {
    budget.check(budget.sum(left.numerator, right.numerator), budget.bits(left.denominator))
  } else {
    budget.check(Math.max(budget.product(left.numerator, right.denominator),
      budget.product(right.numerator, left.denominator)) + 1,
    budget.product(left.denominator, right.denominator))
  }
  // Adding an integer preserves gcd(numerator, denominator) = 1.
  if (left.denominator === 1n) return { kind: 'number',
    numerator: left.numerator * right.denominator + right.numerator, denominator: right.denominator }
  if (right.denominator === 1n) return { kind: 'number',
    numerator: left.numerator + right.numerator * left.denominator, denominator: left.denominator }
  return normalize(...sum(left.numerator, left.denominator, right.numerator, right.denominator))
}

const multiply = (left: NumberValue, right: NumberValue, budget: ExplanationBudget): NumberValue => {
  budget.check(budget.product(left.numerator, right.numerator), budget.product(left.denominator, right.denominator))
  // Evaluation values are reduced with positive denominators. Squaring preserves
  // coprimality; otherwise cross-cancellation leaves a reduced product directly.
  const [numerator, denominator] = left.numerator === right.numerator && left.denominator === right.denominator
    ? [left.numerator * right.numerator, left.denominator * right.denominator]
    : product(left.numerator, left.denominator, right.numerator, right.denominator)
  return { kind: 'number', numerator, denominator }
}

const negate = (value: NumberValue): NumberValue =>
  ({ kind: 'number', numerator: -value.numerator, denominator: value.denominator })

const compare = (left: NumberValue, right: NumberValue, budget: ExplanationBudget): -1 | 0 | 1 => {
  // Evaluation values are normalized, so both denominators are positive.
  if (left.denominator === right.denominator || left.numerator === 0n || right.numerator === 0n ||
      (left.numerator < 0n) !== (right.numerator < 0n)) {
    return left.numerator < right.numerator ? -1 : left.numerator > right.numerator ? 1 : 0
  }
  if (left.numerator === right.numerator) {
    return (left.denominator < right.denominator) === (left.numerator > 0n) ? 1 : -1
  }
  if ((left.numerator < right.numerator) ===
      (left.numerator > 0n ? left.denominator > right.denominator : left.denominator < right.denominator)) {
    return left.numerator < right.numerator ? -1 : 1
  }
  budget.check(budget.product(left.numerator, right.denominator), budget.product(right.numerator, left.denominator))
  const a = left.numerator * right.denominator
  const b = right.numerator * left.denominator
  return a < b ? -1 : a > b ? 1 : 0
}

const equal = (left: Evaluated, right: Evaluated): boolean => {
  if (left.kind === 'number' && right.kind === 'number') {
    // Every evaluated number is reduced with a positive denominator.
    return left.numerator === right.numerator && left.denominator === right.denominator
  }
  if (left.kind !== right.kind) return false
  if (left.kind === 'bool' && right.kind === 'bool') return left.value === right.value
  if (left.kind === 'enum' && right.kind === 'enum') return left.domain === right.domain && left.value === right.value
  return false
}

const assigned = (value: Value, budget: ExplanationBudget): Evaluated => {
  switch (value.sort) {
    case 'bool':
      if (typeof value.value !== 'boolean') throw new TypeError('boolean assignment value must be a boolean')
      return { kind: 'bool', value: value.value }
    case 'int': return number({ numerator: value.value, denominator: '1' }, budget)
    case 'real': return number({ numerator: value.numerator, denominator: value.denominator }, budget)
    case 'enum':
      if (typeof value.domain !== 'string' || typeof value.value !== 'string') throw new TypeError('enum assignment domain and value must be strings')
      return { kind: 'enum', domain: value.domain, value: value.value }
  }
}

/** A captured assignment has one validation result for the whole report. */
const evaluateAssignment = (id: string, context: EvaluationContext): Evaluated => {
  const cached = context.assigned.get(id)
  if (cached !== undefined) {
    if ('error' in cached) throw cached.error
    return cached.value
  }
  try {
    const value = context.assignment[id]
    if (value === undefined) throw new TypeError(`assignment omits ${JSON.stringify(id)}`)
    const evaluated = assigned(value, context.budget)
    const variable = context.variables.get(id)!
    const kind = variable.sort === 'int' || variable.sort === 'real' ? 'number' : variable.sort
    if (evaluated.kind !== kind) throw new TypeError('assignment kind must match the declared variable')
    if (variable.sort === 'int' && evaluated.kind === 'number' && evaluated.denominator !== 1n) {
      throw new TypeError('integer variable assignment must be integral')
    }
    if (evaluated.kind === 'number' && (variable.sort === 'int' || variable.sort === 'real')) {
      const min = variable.min === undefined ? undefined : variable.sort === 'int'
        ? number({ numerator: variable.min, denominator: '1' }, context.budget) : number(variable.min, context.budget)
      const max = variable.max === undefined ? undefined : variable.sort === 'int'
        ? number({ numerator: variable.max, denominator: '1' }, context.budget) : number(variable.max, context.budget)
      if ((min !== undefined && compare(evaluated, min, context.budget) < 0) || (max !== undefined && compare(evaluated, max, context.budget) > 0)) {
        throw new TypeError('numeric assignment must lie within the declared bounds')
      }
    }
    if (variable.sort === 'enum' && (evaluated.kind !== 'enum' || evaluated.domain !== variable.domain || !context.enumDomains.get(variable.domain)!.has(evaluated.value))) {
      throw new TypeError('enum assignment must belong to the declared domain')
    }
    context.assigned.set(id, { value: evaluated })
    return evaluated
  } catch (error) {
    context.assigned.set(id, { error })
    throw error
  }
}

function* evaluateNode(expression: Expression, context: EvaluationContext): Generator<Expression, Evaluated, Evaluated> {
  const signOf = (value: Expression): Sign => constantSign(value, context.signs, literal => {
    if (literal.kind !== 'literal' || (literal.sort !== 'int' && literal.sort !== 'real')) throw new TypeError('expected a numeric literal')
    const input = literal.sort === 'int' ? { numerator: literal.value, denominator: '1' } : literal.value
    context.budget.input(input)
    return Exact.rational(input)
  })
  if (expression.kind === 'eq' || expression.kind === 'neq' || expression.kind === 'lt' ||
      expression.kind === 'lte' || expression.kind === 'gt' || expression.kind === 'gte') {
    const zero = (value: Expression): boolean => value.kind === 'literal' &&
      (value.sort === 'int' || value.sort === 'real') && signOf(value) === 0
    // A proof reads only captured constants. Unknown signs (including undefined
    // arithmetic or any variable) retain ordinary assignment/error evaluation.
    const sign = zero(expression.right) ? signOf(expression.left)
      : zero(expression.left) ? signOf(expression.right) : undefined
    if (sign !== undefined) {
      const order = zero(expression.right) ? sign : -sign
      return { kind: 'bool', value: expression.kind === 'eq' ? order === 0
        : expression.kind === 'neq' ? order !== 0 : expression.kind === 'lt' ? order < 0
          : expression.kind === 'lte' ? order <= 0 : expression.kind === 'gt' ? order > 0 : order >= 0 }
    }
  }
  switch (expression.kind) {
    case 'literal':
      switch (expression.sort) {
        case 'bool': return { kind: 'bool', value: expression.value }
        case 'int': return number({ numerator: expression.value, denominator: '1' }, context.budget)
        case 'real': return number(expression.value, context.budget)
        case 'enum': return { kind: 'enum', domain: expression.domain, value: expression.value }
      }
    case 'variable': return evaluateAssignment(expression.id, context)
    case 'not': return { kind: 'bool', value: !bool((yield expression.value)) }
    case 'and':
      for (const value of expression.operands) if (!bool(yield value)) return { kind: 'bool', value: false }
      return { kind: 'bool', value: true }
    case 'or':
      for (const value of expression.operands) if (bool(yield value)) return { kind: 'bool', value: true }
      return { kind: 'bool', value: false }
    case 'implies': return { kind: 'bool', value: !bool((yield expression.left)) || bool((yield expression.right)) }
    case 'eq': return { kind: 'bool', value: equal((yield expression.left), (yield expression.right)) }
    case 'neq': return { kind: 'bool', value: !equal((yield expression.left), (yield expression.right)) }
    case 'lt': return { kind: 'bool', value: compare(numeric((yield expression.left)), numeric((yield expression.right)), context.budget) < 0 }
    case 'lte': return { kind: 'bool', value: compare(numeric((yield expression.left)), numeric((yield expression.right)), context.budget) <= 0 }
    case 'gt': return { kind: 'bool', value: compare(numeric((yield expression.left)), numeric((yield expression.right)), context.budget) > 0 }
    case 'gte': return { kind: 'bool', value: compare(numeric((yield expression.left)), numeric((yield expression.right)), context.budget) >= 0 }
    case 'add':
    case 'multiply': {
      const values: Evaluated[] = []
      for (const value of expression.operands) values.push(yield value)
      const numbers = values.map(numeric)
      // Evaluate and type-check every operand before applying the zero identity:
      // zero must not hide undefined arithmetic in another operand.
      if (expression.kind === 'multiply' && numbers.some(value => value.numerator === 0n)) {
        return normalize(0n, 1n)
      }
      return balancedReduce(numbers, (left, right) => expression.kind === 'add'
        ? add(left, right, context.budget) : multiply(left, right, context.budget))
    }
    case 'subtract': {
      const left = numeric((yield expression.left))
      const right = numeric((yield expression.right))
      return add(left, negate(right), context.budget)
    }
    case 'divide': {
      const left = numeric((yield expression.left))
      const right = numeric((yield expression.right))
      if (right.numerator === 0n) throw new TypeError('cannot explain division by zero')
      context.budget.check(context.budget.product(left.numerator, right.denominator),
        context.budget.product(left.denominator, right.numerator))
      // Cross-cancellation preserves reduction; only denominator sign can change.
      const [numerator, denominator] = product(left.numerator, left.denominator, right.denominator, right.numerator)
      return denominator < 0n
        ? { kind: 'number', numerator: -numerator, denominator: -denominator }
        : { kind: 'number', numerator, denominator }
    }
    case 'negate': {
      const value = numeric((yield expression.value))
      return negate(value)
    }
    case 'if': return bool((yield expression.condition)) ? (yield expression.then) : (yield expression.else)
  }
}


const evaluate = (expression: Expression, context: EvaluationContext): Evaluated => {
  const stack = [evaluateNode(expression, context)]
  let step = stack[0]!.next()
  while (true) {
    if (step.done) {
      stack.pop()
      if (stack.length === 0) return step.value
      step = stack[stack.length - 1]!.next(step.value)
    } else {
      const child = evaluateNode(step.value, context)
      stack.push(child)
      step = child.next()
    }
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

type Evaluation = {
  readonly value?: boolean
  readonly evaluationReason?: string
}

const evaluation = (expression: Expression, context: EvaluationContext): Evaluation => {
  const repeated = context.expressionResults.get(expression)
  if (repeated !== undefined) return repeated
  const key = expressionKey(expression, context.expressionStrings)
  const cached = context.evaluations.get(key)
  if (cached !== undefined) {
    context.expressionResults.set(expression, cached)
    return cached
  }
  let result: Evaluation
  try {
    result = { value: bool(evaluate(expression, context)) }
  } catch (error) {
    // Local arithmetic/assignment failure does not reclassify the backend result.
    result = { evaluationReason: error instanceof Error ? error.message : 'constraint evaluation failed' }
  }
  context.evaluations.set(key, result)
  context.expressionResults.set(expression, result)
  return result
}

const constraint = (value: HardConstraint, context: EvaluationContext): Constraint => {
  const result = evaluation(value.expression, context)
  return {
    ...element(value),
    evaluation: result.value === undefined ? 'indeterminate' : result.value ? 'satisfied' : 'violated',
    ...(result.evaluationReason === undefined ? {} : { evaluationReason: result.evaluationReason })
  }
}

const softConstraint = (value: SoftConstraint, context: EvaluationContext): SoftConstraintResult => {
  const result = evaluation(value.expression, context)
  return {
    ...element(value),
    evaluation: result.value === undefined ? 'indeterminate' : result.value ? 'accepted' : 'violated',
    ...(result.evaluationReason === undefined ? {} : { evaluationReason: result.evaluationReason }),
    weight: Exact.rational(value.weight)
  }
}

const assignments = (model: Model, assignment: Assignment): readonly AssignmentValue[] => {
  const variables = new Map(model.variables.map(variable => [variable.id, variable]))
  return Object.entries(assignment)
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, value]) => {
      const variable: Variable | undefined = variables.get(id)
      return { ...element(variable ?? { id }), declared: variable !== undefined, value }
    })
}

const feasible = (model: Model, assignment: Assignment, limits: Limits): Feasible => {
  // The report owns a captured assignment; normalized values live only for this report.
  const context: EvaluationContext = {
    assignment, budget: new ExplanationBudget(limits.maxExplanationBits, limits.maxExplanationWork), assigned: new Map(), signs: new WeakMap(), expressionResults: new WeakMap(), evaluations: new Map(), expressionStrings: new Map(),
    variables: new Map(model.variables.map(variable => [variable.id, variable])),
    enumDomains: new Map((model.enums ?? []).map(domain => [domain.id, new Set(domain.values)]))
  }
  return {
    assignments: assignments(model, assignment),
    hardConstraints: model.constraints.map(value => constraint(value, context)),
    softConstraints: (model.softConstraints ?? []).map(value => softConstraint(value, context))
  }
}

const objective = (declaration: Objective | undefined, result: ObjectiveValue): ObjectiveResult => ({
  ...element(declaration ?? { id: result.objectiveId }),
  declared: declaration !== undefined,
  direction: declaration?.direction ?? 'unknown',
  value: result.value,
  ...(result.bound === undefined ? {} : { bound: result.bound })
})

const outcome = (model: Model, result: Result, limits: Limits): Outcome => {
  switch (result.status) {
    case 'satisfied': return { status: result.status, ...feasible(model, result.assignment, limits) }
    case 'optimal': {
      const declarations = new Map((model.objectives ?? []).map(value => [value.id, value]))
      return {
        status: result.status,
        ...feasible(model, result.assignment, limits),
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
  limits = mergeLimits(limits)
  model = clone(model)
  result = captureResult(result)
  validateContext(context)
  context = clone({
    modelDigest: context.modelDigest,
    scenario: context.scenario,
    snapshot: context.snapshot,
    inputs: context.inputs,
  })
  validateContext(context)
  const modelDigest = digestOwned(model, limits)
  if (context.modelDigest !== undefined && context.modelDigest !== modelDigest) {
    throw new TypeError(`scenario model digest ${context.modelDigest} does not match ${modelDigest}`)
  }
  // All referenced data is owned by the captures above or constructed in this call.
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
    outcome: outcome(model, result, limits)
  }
}

const sourceLocation = (declaration: Declaration): string => {
  if (declaration.line !== undefined) {
    return `${inlineText(declaration.uri)}:${declaration.line}${declaration.column === undefined ? '' : `:${declaration.column}`}`
  }
  return `${inlineText(declaration.uri)}${declaration.column === undefined ? '' : ` (column ${declaration.column})`}`
}

const evidence = (value: Element): string => {
  const parts = [
    value.declaration === undefined ? undefined : sourceLocation(value.declaration),
    value.evidenceRowIds.length === 0 ? undefined : `rows ${value.evidenceRowIds.map(inlineText).join(', ')}`,
    value.scenarioInputIds.length === 0 ? undefined : `inputs ${value.scenarioInputIds.map(inlineText).join(', ')}`
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? '' : ` — ${parts.join('; ')}`
}

const valueText = (value: Value): string => {
  const invalid = '(invalid backend value)'
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid
  switch (value.sort) {
    case 'bool': return typeof value.value === 'boolean' ? String(value.value) : invalid
    case 'int': return typeof value.value === 'string' ? inlineText(value.value) : invalid
    case 'real': return typeof value.numerator === 'string' && typeof value.denominator === 'string'
      ? inlineText(`${value.numerator}/${value.denominator}`) : invalid
    case 'enum': return typeof value.domain === 'string' && typeof value.value === 'string' ? inlineText(value.value) : invalid
    default: return invalid
  }
}

const jsonControlEscapes = new Map(
  [...Array.from({ length: 33 }, (_, index) => index + 0x7f), 0x2028, 0x2029]
    .map(code => [String.fromCharCode(code), `\\u${code.toString(16).padStart(4, '0')}`])
)

const escapeJsonControls = (text: string): string =>
  text.replace(/[\u007f-\u009f\u2028\u2029]/g, character => jsonControlEscapes.get(character)!)

const quotedText = (message: string): string => escapeJsonControls(JSON.stringify(message))

const inlineText = (message: string): string =>
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(message) ? quotedText(message) : message

/** Render the same report as concise, deterministic plain text. */
export const render = (value: Report): string => {
  const lines = [
    `Solver result: ${value.outcome.status}`,
    `Model: ${inlineText(value.run.modelDigest)}`,
    `Backend: ${inlineText(value.run.backend.name)} ${inlineText(value.run.backend.version)}`,
    `Elapsed: ${value.run.elapsedMs} ms`
  ]
  if (value.run.snapshot !== undefined) {
    const snapshot = value.run.snapshot
    const policies: string[] = []
    if (snapshot.aliases !== undefined) policies.push(`aliases ${snapshot.aliases}`)
    if (snapshot.resolution !== undefined) policies.push(`resolution ${snapshot.resolution}`)
    if (snapshot.minimumConfidence !== undefined) policies.push(`minimum confidence ${snapshot.minimumConfidence}`)
    lines.push(`Snapshot: transaction ${inlineText(snapshot.transactionTime ?? 'empty')}${snapshot.validTime === undefined ? '' : `, valid ${inlineText(snapshot.validTime)}`}${policies.length === 0 ? '' : `; ${policies.join('; ')}`}`)
  }
  if (value.run.scenario !== undefined) lines.push(`Scenario: ${inlineText(value.run.scenario.id)} (input ${inlineText(value.run.scenario.inputDigest)}; overlay ${inlineText(value.run.scenario.overlayDigest)})`)
  for (const input of value.run.inputs) {
    const values: string[] = []
    if (input.value !== undefined) values.push(escapeJsonControls(stringifyInput(input.value)))
    if (input.authoredValue !== undefined) values.push(`authored ${escapeJsonControls(stringifyInput(input.authoredValue))}`)
    const sources: string[] = []
    if (input.evidenceRowIds.length > 0) sources.push(`rows ${sorted(input.evidenceRowIds).map(inlineText).join(', ')}`)
    if (input.scenarioClaimIds.length > 0) sources.push(`scenario claims ${sorted(input.scenarioClaimIds).map(inlineText).join(', ')}`)
    lines.push(`Input ${inlineText(input.id)}: ${values.length === 0 ? '(no value)' : values.join('; ')}${input.query === undefined ? '' : ` via ${inlineText(input.query)}`}${sources.length === 0 ? '' : ` — ${sources.join('; ')}`}`)
  }
  switch (value.outcome.status) {
    case 'satisfied':
    case 'optimal':
      for (const assignment of value.outcome.assignments) {
        lines.push(`Assignment ${inlineText(assignment.id)} = ${valueText(assignment.value)}${assignment.declared ? '' : ' (undeclared backend ID)'}${evidence(assignment)}`)
      }
      for (const constraint of value.outcome.hardConstraints) {
        lines.push(`Hard constraint ${inlineText(constraint.id)}: ${constraint.evaluation}${constraint.evaluationReason === undefined ? '' : ` (${quotedText(constraint.evaluationReason)})`}${evidence(constraint)}`)
      }
      for (const constraint of value.outcome.softConstraints) {
        lines.push(`Soft constraint ${inlineText(constraint.id)}: ${constraint.evaluation}${constraint.evaluationReason === undefined ? '' : ` (${quotedText(constraint.evaluationReason)})`}, weight ${constraint.weight.numerator}/${constraint.weight.denominator}${evidence(constraint)}`)
      }
      if (value.outcome.status === 'optimal') {
        for (const objective of value.outcome.objectives) {
          lines.push(`Objective ${inlineText(objective.id)} (${objective.direction}) = ${valueText(objective.value)}${objective.declared ? '' : ' (undeclared backend ID)'}${evidence(objective)}`)
        }
      }
      break
    case 'unsatisfied':
      lines.push('Infeasibility proved. Unsatisfiable cores are not necessarily minimal.')
      for (const constraint of value.outcome.core ?? []) {
        lines.push(`Core constraint ${inlineText(constraint.id)}${constraint.declared ? '' : ' (undeclared backend ID)'}${evidence(constraint)}`)
      }
      break
    case 'unknown':
      lines.push(`Unknown: ${value.outcome.reason.kind} — ${inlineText(value.outcome.reason.message)}`)
      break
  }
  return `${lines.join('\n')}\n`
}
