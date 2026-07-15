import type { Limits, Options, Result, SolverAdapter } from './adapter.ts'
import * as Canonical from './canonical.ts'
import * as Exact from './exact.ts'
import * as Explain from './explain.ts'
import type {
  Assignment,
  Expression,
  HardConstraint,
  Model,
  Objective,
  Value,
  Variable
} from './model.ts'
import * as Solve from './solve.ts'
import * as Validate from './validate.ts'

export const schema = 'cave.solver/workflow@1' as const

const syntheticPrefix = 'cave.workflow/'
const defaultMaxSensitivityRuns = 64
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(`invalid solver workflow: ${message}`)
    this.name = 'WorkflowValidationError'
  }
}

export type Domain =
  | { readonly variableId: string, readonly kind: 'finite', readonly sort: 'bool', readonly values: readonly boolean[] }
  | { readonly variableId: string, readonly kind: 'finite', readonly sort: 'enum', readonly domain: string, readonly values: readonly string[] }
  | { readonly variableId: string, readonly kind: 'interval', readonly sort: 'int', readonly min: string, readonly max: string }
  | {
    readonly variableId: string
    readonly kind: 'interval'
    readonly sort: 'real'
    readonly min: { readonly numerator: string, readonly denominator: string }
    readonly max: { readonly numerator: string, readonly denominator: string }
  }

export type Scope = {
  readonly domains: readonly Domain[]
  readonly assumptions: readonly string[]
  readonly theories: readonly ('booleans' | 'bounded-integers' | 'exact-rationals' | 'finite-enums')[]
}

export type TieBreak = {
  readonly variableId: string
  readonly preference: 'false-first' | 'smallest-first' | 'lexical-first'
}

export type Operation =
  | { readonly kind: 'feasibility' }
  | { readonly kind: 'optimization' }
  | { readonly kind: 'counterexample', readonly invariantId: string, readonly verdict: 'counterexample' | 'holds-within-scope' | 'unknown' }

export type Report = {
  readonly schema: typeof schema
  readonly operation: Operation
  readonly modelDigest: string
  readonly scope: Scope
  readonly tieBreak: readonly TieBreak[]
  readonly explanation: Explain.Report
}

export type Binding = {
  readonly variableId: string
  readonly value: Value
}

export type SensitivityRequest = {
  readonly variableId: string
  readonly samples: readonly Value[]
  /** Assignments to keep constant while the selected variable changes. */
  readonly fixed?: readonly Binding[]
  /** Variables whose assignments define a preferred-result transition. */
  readonly observe?: readonly string[]
  readonly operation?: 'feasibility' | 'optimization'
  readonly maxRuns?: number
}

export type SensitivityPoint = {
  readonly index: number
  readonly value: Value
  readonly report: Report
}

export type Transition = {
  readonly afterIndex: number
  readonly from: Value
  readonly to: Value
  readonly fromSignature: string
  readonly toSignature: string
}

export type UnknownRegion = {
  readonly startIndex: number
  readonly endIndex: number
  readonly from: Value
  readonly to: Value
}

export type SensitivityReport = {
  readonly schema: typeof schema
  readonly operation: 'sensitivity'
  readonly modelDigest: string
  readonly variableId: string
  readonly fixed: readonly Binding[]
  readonly observe: readonly string[]
  readonly points: readonly SensitivityPoint[]
  readonly transitions: readonly Transition[]
  readonly unknownRegions: readonly UnknownRegion[]
}

export const maxSensitivityRuns = defaultMaxSensitivityRuns

const boundedScope = (model: Model, limits: Partial<Limits> = {}): Scope => {
  Validate.model(model, limits)
  const domainsById = new Map((model.enums ?? []).map(domain => [domain.id, domain.values]))
  const domains: Domain[] = model.variables
    .map((variable): Domain => {
      switch (variable.sort) {
        case 'bool':
          return { variableId: variable.id, kind: 'finite', sort: variable.sort, values: [false, true] }
        case 'enum': {
          const values = domainsById.get(variable.domain)
          if (values === undefined) throw new WorkflowValidationError(`variable ${JSON.stringify(variable.id)} has no enum domain`)
          return {
            variableId: variable.id,
            kind: 'finite',
            sort: variable.sort,
            domain: variable.domain,
            values: [...values].sort(compareText)
          }
        }
        case 'int':
          return {
            variableId: variable.id,
            kind: 'interval',
            sort: variable.sort,
            min: String(Exact.integer(variable.min)),
            max: String(Exact.integer(variable.max))
          }
        case 'real':
          if (variable.min === undefined || variable.max === undefined) {
            throw new WorkflowValidationError(
              `real variable ${JSON.stringify(variable.id)} needs explicit min and max bounds`
            )
          }
          return {
            variableId: variable.id,
            kind: 'interval',
            sort: variable.sort,
            min: Exact.rational(variable.min),
            max: Exact.rational(variable.max)
          }
      }
    })
    .sort((left, right) => compareText(left.variableId, right.variableId))
  const sorts = new Set(model.variables.map(variable => variable.sort))
  const theories: Scope['theories'][number][] = ['booleans']
  if (sorts.has('int')) theories.push('bounded-integers')
  if (sorts.has('real')) theories.push('exact-rationals')
  if (sorts.has('enum')) theories.push('finite-enums')
  return {
    domains,
    assumptions: model.constraints.map(constraint => constraint.id),
    theories
  }
}

const variableMap = (model: Model): ReadonlyMap<string, Variable> =>
  new Map(model.variables.map(variable => [variable.id, variable]))

const normalizedValue = (variable: Variable, value: Value, domains: ReadonlyMap<string, readonly string[]>): Value => {
  if (variable.sort !== value.sort) {
    throw new WorkflowValidationError(
      `variable ${JSON.stringify(variable.id)} is ${variable.sort}, received ${value.sort}`
    )
  }
  switch (value.sort) {
    case 'bool': return value
    case 'int': {
      const normalized = String(Exact.integer(value.value))
      if (Exact.compare(normalized, String(Exact.integer((variable as Variable & { sort: 'int' }).min))) < 0 ||
          Exact.compare(normalized, String(Exact.integer((variable as Variable & { sort: 'int' }).max))) > 0) {
        throw new WorkflowValidationError(`value ${normalized} is outside ${JSON.stringify(variable.id)} bounds`)
      }
      return { sort: value.sort, value: normalized }
    }
    case 'real': {
      const normalized = Exact.rational(value)
      const real = variable as Variable & { sort: 'real' }
      if ((real.min !== undefined && Exact.compare(normalized, real.min) < 0) ||
          (real.max !== undefined && Exact.compare(normalized, real.max) > 0)) {
        throw new WorkflowValidationError(`value ${normalized.numerator}/${normalized.denominator} is outside ${JSON.stringify(variable.id)} bounds`)
      }
      return { sort: value.sort, ...normalized }
    }
    case 'enum': {
      const enumeration = variable as Variable & { sort: 'enum' }
      if (value.domain !== enumeration.domain) {
        throw new WorkflowValidationError(
          `variable ${JSON.stringify(variable.id)} uses enum ${JSON.stringify(enumeration.domain)}, received ${JSON.stringify(value.domain)}`
        )
      }
      if (!(domains.get(value.domain) ?? []).includes(value.value)) {
        throw new WorkflowValidationError(`value ${JSON.stringify(value.value)} is outside enum ${JSON.stringify(value.domain)}`)
      }
      return value
    }
  }
}

const literal = (value: Value): Expression => {
  switch (value.sort) {
    case 'bool': return { kind: 'literal', sort: value.sort, value: value.value }
    case 'int': return { kind: 'literal', sort: value.sort, value: value.value }
    case 'real': return { kind: 'literal', sort: value.sort, value: { numerator: value.numerator, denominator: value.denominator } }
    case 'enum': return { kind: 'literal', sort: value.sort, domain: value.domain, value: value.value }
  }
}

const freshId = (used: Set<string>, name: string): string => {
  let id = `${syntheticPrefix}${name}`
  let suffix = 2
  while (used.has(id)) id = `${syntheticPrefix}${name}-${suffix++}`
  used.add(id)
  return id
}

const enumRank = (variable: Variable & { readonly sort: 'enum' }, values: readonly string[]): Expression => {
  const sorted = [...values].sort(compareText)
  return sorted.slice(0, -1).reduceRight<Expression>(
    (otherwise, value, index) => ({
      kind: 'if',
      condition: {
        kind: 'eq',
        left: { kind: 'variable', id: variable.id },
        right: { kind: 'literal', sort: 'enum', domain: variable.domain, value }
      },
      then: { kind: 'literal', sort: 'int', value: index },
      else: otherwise
    }),
    { kind: 'literal', sort: 'int', value: Math.max(0, sorted.length - 1) }
  )
}

const tieBreak = (model: Model, used: Set<string>): { objectives: readonly Objective[], descriptions: readonly TieBreak[] } => {
  const domains = new Map((model.enums ?? []).map(domain => [domain.id, domain.values]))
  const ordered = [...model.variables].sort((left, right) => compareText(left.id, right.id))
  return {
    objectives: ordered.map(variable => ({
      id: freshId(used, `tie/${variable.id}`),
      direction: 'minimize',
      expression: (() => {
        switch (variable.sort) {
          case 'bool': return {
            kind: 'if',
            condition: { kind: 'variable', id: variable.id },
            then: { kind: 'literal', sort: 'int', value: 1 },
            else: { kind: 'literal', sort: 'int', value: 0 }
          }
          case 'int':
          case 'real': return { kind: 'variable', id: variable.id }
          case 'enum': return enumRank(variable, domains.get(variable.domain) ?? [])
        }
      })()
    })),
    descriptions: ordered.map(variable => ({
      variableId: variable.id,
      preference: variable.sort === 'bool' ? 'false-first' : variable.sort === 'enum' ? 'lexical-first' : 'smallest-first'
    }))
  }
}

const softObjective = (model: Model, used: Set<string>): Objective | undefined => {
  const expressions = (model.softConstraints ?? []).map((constraint): Expression => ({
    kind: 'if',
    condition: constraint.expression,
    then: { kind: 'literal', sort: 'real', value: constraint.weight },
    else: { kind: 'literal', sort: 'real', value: '0' }
  }))
  if (expressions.length === 0) return undefined
  return {
    id: freshId(used, 'soft-score'),
    direction: 'maximize',
    expression: expressions.length === 1 ? expressions[0]! : { kind: 'add', operands: expressions }
  }
}

const preparedModel = (model: Model, kind: 'feasibility' | 'optimization'): {
  readonly model: Model
  readonly tieBreak: readonly TieBreak[]
  readonly authoredObjectiveIds: ReadonlySet<string>
} => {
  const used = new Set((model.objectives ?? []).map(objective => objective.id))
  const tie = tieBreak(model, used)
  const authoredObjectiveIds = new Set((model.objectives ?? []).map(objective => objective.id))
  if (kind === 'feasibility') {
    return {
      model: { ...model, softConstraints: [], objectives: tie.objectives },
      tieBreak: tie.descriptions,
      authoredObjectiveIds
    }
  }
  if ((model.objectives?.length ?? 0) === 0 && (model.softConstraints?.length ?? 0) === 0) {
    throw new WorkflowValidationError('optimization needs at least one objective or soft constraint')
  }
  const soft = softObjective(model, used)
  return {
    model: {
      ...model,
      softConstraints: [],
      objectives: [...(model.objectives ?? []), ...(soft === undefined ? [] : [soft]), ...tie.objectives]
    },
    tieBreak: tie.descriptions,
    authoredObjectiveIds
  }
}

const feasibleResult = (result: Result): Result => result.status !== 'optimal' ? result : {
  status: 'satisfied',
  assignment: result.assignment,
  backend: result.backend,
  diagnostics: result.diagnostics,
  elapsedMs: result.elapsedMs
}

const optimizedResult = (result: Result, authoredObjectiveIds: ReadonlySet<string>): Result => {
  if (result.status === 'satisfied') {
    return {
      status: 'unknown',
      reason: { kind: 'indeterminate', message: 'backend returned a feasible assignment without proving optimality' },
      backend: result.backend,
      diagnostics: result.diagnostics,
      elapsedMs: result.elapsedMs
    }
  }
  if (result.status !== 'optimal') return result
  return {
    ...result,
    objectives: result.objectives.filter(objective => authoredObjectiveIds.has(objective.objectiveId))
  }
}

const run = async (
  adapter: SolverAdapter,
  sourceModel: Model,
  solveModel: Model,
  kind: 'feasibility' | 'optimization',
  options: Options,
  context: Explain.Context
): Promise<{ readonly explanation: Explain.Report, readonly tieBreak: readonly TieBreak[] }> => {
  const limits = Validate.mergeLimits(options.limits)
  const prepared = preparedModel(solveModel, kind)
  const result = await Solve.run(adapter, prepared.model, {
    limits,
    unsatCore: options.unsatCore ?? (kind === 'feasibility')
  })
  const normalized = kind === 'feasibility'
    ? feasibleResult(result)
    : optimizedResult(result, prepared.authoredObjectiveIds)
  return {
    explanation: Explain.report(sourceModel, normalized, limits, context),
    tieBreak: prepared.tieBreak
  }
}

const report = (
  model: Model,
  operation: Operation,
  scope: Scope,
  tie: readonly TieBreak[],
  explanation: Explain.Report
): Report => ({
  schema,
  operation,
  modelDigest: Canonical.digest(model),
  scope,
  tieBreak: tie,
  explanation
})

export const feasibility = async (
  adapter: SolverAdapter,
  model: Model,
  options: Options = {},
  context: Explain.Context = {}
): Promise<Report> => {
  const scope = boundedScope(model, options.limits)
  const result = await run(adapter, model, model, 'feasibility', options, context)
  return report(model, { kind: 'feasibility' }, scope, result.tieBreak, result.explanation)
}

export const optimization = async (
  adapter: SolverAdapter,
  model: Model,
  options: Options = {},
  context: Explain.Context = {}
): Promise<Report> => {
  const scope = boundedScope(model, options.limits)
  const result = await run(adapter, model, model, 'optimization', options, context)
  return report(model, { kind: 'optimization' }, scope, result.tieBreak, result.explanation)
}

export const counterexample = async (
  adapter: SolverAdapter,
  model: Model,
  invariantId: string,
  options: Options = {},
  context: Explain.Context = {}
): Promise<Report> => {
  const baseScope = boundedScope(model, options.limits)
  const invariant = model.constraints.find(constraint => constraint.id === invariantId)
  if (invariant === undefined) {
    throw new WorkflowValidationError(`unknown invariant constraint ${JSON.stringify(invariantId)}`)
  }
  const negated: HardConstraint = { ...invariant, expression: { kind: 'not', value: invariant.expression } }
  const solveModel: Model = {
    ...model,
    constraints: model.constraints.map(constraint => constraint.id === invariantId ? negated : constraint)
  }
  const result = await run(adapter, model, solveModel, 'feasibility', { ...options, unsatCore: options.unsatCore ?? true }, context)
  const verdict = result.explanation.outcome.status === 'satisfied'
    ? 'counterexample'
    : result.explanation.outcome.status === 'unsatisfied'
      ? 'holds-within-scope'
      : 'unknown'
  const scope: Scope = {
    ...baseScope,
    assumptions: baseScope.assumptions.filter(id => id !== invariantId)
  }
  return report(model, { kind: 'counterexample', invariantId, verdict }, scope, result.tieBreak, result.explanation)
}

const bindingConstraint = (binding: Binding, id: string): HardConstraint => ({
  id,
  expression: {
    kind: 'eq',
    left: { kind: 'variable', id: binding.variableId },
    right: literal(binding.value)
  },
  scenarioInputIds: [binding.variableId]
})

const normalizeBindings = (model: Model, bindings: readonly Binding[]): readonly Binding[] => {
  const variables = variableMap(model)
  const domains = new Map((model.enums ?? []).map(domain => [domain.id, domain.values]))
  const seen = new Set<string>()
  return bindings.map(binding => {
    if (seen.has(binding.variableId)) {
      throw new WorkflowValidationError(`variable ${JSON.stringify(binding.variableId)} is fixed more than once`)
    }
    seen.add(binding.variableId)
    const variable = variables.get(binding.variableId)
    if (variable === undefined) throw new WorkflowValidationError(`unknown variable ${JSON.stringify(binding.variableId)}`)
    return { variableId: binding.variableId, value: normalizedValue(variable, binding.value, domains) }
  })
}

const assignmentSignature = (report: Report, observe: readonly string[]): string => {
  const outcome = report.explanation.outcome
  if (outcome.status !== 'satisfied' && outcome.status !== 'optimal') return outcome.status
  const assignment: Assignment = Object.fromEntries(outcome.assignments.map(item => [item.id, item.value]))
  return JSON.stringify({
    status: outcome.status,
    assignment: Object.fromEntries(observe.map(id => [id, assignment[id] ?? null]))
  })
}

const transitions = (points: readonly SensitivityPoint[], observe: readonly string[]): readonly Transition[] => {
  const result: Transition[] = []
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const current = points[index]!
    const fromSignature = assignmentSignature(previous.report, observe)
    const toSignature = assignmentSignature(current.report, observe)
    if (fromSignature !== toSignature) {
      result.push({
        afterIndex: index - 1,
        from: previous.value,
        to: current.value,
        fromSignature,
        toSignature
      })
    }
  }
  return result
}

const unknownRegions = (points: readonly SensitivityPoint[]): readonly UnknownRegion[] => {
  const result: UnknownRegion[] = []
  let start: number | undefined
  for (let index = 0; index <= points.length; index += 1) {
    const unknown = index < points.length && points[index]!.report.explanation.outcome.status === 'unknown'
    if (unknown && start === undefined) start = index
    if (!unknown && start !== undefined) {
      const end = index - 1
      result.push({
        startIndex: start,
        endIndex: end,
        from: points[start]!.value,
        to: points[end]!.value
      })
      start = undefined
    }
  }
  return result
}

export const sensitivity = async (
  adapter: SolverAdapter,
  model: Model,
  request: SensitivityRequest,
  options: Options = {},
  context: Explain.Context = {}
): Promise<SensitivityReport> => {
  const scope = boundedScope(model, options.limits)
  const maxRuns = request.maxRuns ?? defaultMaxSensitivityRuns
  if (!Number.isSafeInteger(maxRuns) || maxRuns <= 0) {
    throw new WorkflowValidationError(`maxRuns must be a positive safe integer, received ${String(maxRuns)}`)
  }
  if (request.samples.length === 0) throw new WorkflowValidationError('sensitivity needs at least one sample')
  if (request.samples.length > maxRuns) {
    throw new WorkflowValidationError(`sensitivity samples exceed maxRuns: ${request.samples.length} > ${maxRuns}`)
  }
  const variables = variableMap(model)
  const selected = variables.get(request.variableId)
  if (selected === undefined) throw new WorkflowValidationError(`unknown sensitivity variable ${JSON.stringify(request.variableId)}`)
  const domains = new Map((model.enums ?? []).map(domain => [domain.id, domain.values]))
  const samples = request.samples.map(value => normalizedValue(selected, value, domains))
  if (new Set(samples.map(value => JSON.stringify(value))).size !== samples.length) {
    throw new WorkflowValidationError('sensitivity samples contain duplicate values')
  }
  const fixed = normalizeBindings(model, request.fixed ?? [])
  if (fixed.some(binding => binding.variableId === request.variableId)) {
    throw new WorkflowValidationError(`sensitivity variable ${JSON.stringify(request.variableId)} is also fixed`)
  }
  const observe = [...new Set(request.observe ?? [])]
  for (const id of observe) {
    if (!variables.has(id)) throw new WorkflowValidationError(`unknown observed variable ${JSON.stringify(id)}`)
  }
  const kind = request.operation ?? 'optimization'
  const used = new Set(model.constraints.map(constraint => constraint.id))
  const fixedConstraints = fixed.map((binding, index) =>
    bindingConstraint(binding, freshId(used, `fixed/${index}`)))
  const points: SensitivityPoint[] = []
  for (const [index, value] of samples.entries()) {
    const sample: Binding = { variableId: request.variableId, value }
    const solveModel: Model = {
      ...model,
      constraints: [
        ...model.constraints,
        ...fixedConstraints,
        bindingConstraint(sample, freshId(used, `sample/${index}`))
      ]
    }
    const solved = await run(adapter, model, solveModel, kind, options, context)
    points.push({
      index,
      value,
      report: report(model, { kind }, scope, solved.tieBreak, solved.explanation)
    })
  }
  return {
    schema,
    operation: 'sensitivity',
    modelDigest: Canonical.digest(model),
    variableId: request.variableId,
    fixed,
    observe,
    points,
    transitions: transitions(points, observe),
    unknownRegions: unknownRegions(points)
  }
}
