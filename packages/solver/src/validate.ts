import type { Limits } from './adapter.ts'
import { defaultLimits } from './adapter.ts'
import * as Exact from './exact.ts'
import { schema, type Expression, type Model, type Rational, type Variable } from './model.ts'

export type Stats = {
  readonly variables: number
  readonly constraints: number
  readonly objectives: number
  readonly enumValues: number
  readonly expressionNodes: number
  readonly expressionDepth: number
}

export class ModelValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`invalid solver model:\n- ${problems.join('\n- ')}`)
    this.name = 'ModelValidationError'
    this.problems = problems
  }
}

export class ModelLimitError extends Error {
  readonly limit: keyof Limits
  readonly actual: number
  readonly maximum: number

  constructor(limit: keyof Limits, actual: number, maximum: number) {
    super(`solver model exceeds ${limit}: ${actual} > ${maximum}`)
    this.name = 'ModelLimitError'
    this.limit = limit
    this.actual = actual
    this.maximum = maximum
  }
}

type Sort = { readonly kind: 'bool' | 'int' | 'real' } | { readonly kind: 'enum', readonly domain: string }

const idPattern = /^[A-Za-z][A-Za-z0-9._:/-]*$/
const numeric = (sort: Sort): boolean => sort.kind === 'int' || sort.kind === 'real'
const same = (left: Sort, right: Sort): boolean =>
  left.kind === right.kind && (left.kind !== 'enum' || (right.kind === 'enum' && left.domain === right.domain))

const compatible = (left: Sort, right: Sort): boolean => same(left, right) || (numeric(left) && numeric(right))

const rationalOfInteger = (value: Variable & { readonly sort: 'int' }, side: 'min' | 'max'): Rational =>
  String(Exact.integer(value[side]))

const pushExactProblem = (problems: string[], path: string, run: () => unknown): void => {
  try {
    run()
  } catch (error) {
    problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const requireId = (id: string, path: string, problems: string[]): void => {
  if (!idPattern.test(id)) {
    problems.push(`${path} must match ${String(idPattern)}`)
  }
}

const duplicates = (ids: readonly string[], path: string, problems: string[]): void => {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      problems.push(`${path} contains duplicate identifier ${JSON.stringify(id)}`)
    }
    seen.add(id)
  }
}

type Walk = { nodes: number, depth: number }

const infer = (
  expression: Expression,
  path: string,
  variables: ReadonlyMap<string, Variable>,
  domains: ReadonlyMap<string, readonly string[]>,
  problems: string[],
  walk: Walk,
  depth: number
): Sort => {
  walk.nodes += 1
  walk.depth = Math.max(walk.depth, depth)
  const child = (value: Expression, suffix: string): Sort =>
    infer(value, `${path}.${suffix}`, variables, domains, problems, walk, depth + 1)
  const expectBool = (sort: Sort, at: string): void => {
    if (sort.kind !== 'bool') problems.push(`${at} must be boolean, received ${sort.kind}`)
  }
  const expectNumeric = (sort: Sort, at: string): void => {
    if (!numeric(sort)) problems.push(`${at} must be numeric, received ${sort.kind}`)
  }

  switch (expression.kind) {
    case 'literal':
      switch (expression.sort) {
        case 'bool': return { kind: 'bool' }
        case 'int':
          pushExactProblem(problems, path, () => Exact.integer(expression.value))
          return { kind: 'int' }
        case 'real':
          pushExactProblem(problems, path, () => Exact.rational(expression.value))
          return { kind: 'real' }
        case 'enum': {
          const values = domains.get(expression.domain)
          if (values === undefined) problems.push(`${path} references unknown enum domain ${JSON.stringify(expression.domain)}`)
          else if (!values.includes(expression.value)) problems.push(`${path} value ${JSON.stringify(expression.value)} is outside enum domain ${JSON.stringify(expression.domain)}`)
          return { kind: 'enum', domain: expression.domain }
        }
      }
    case 'variable': {
      const variable = variables.get(expression.id)
      if (variable === undefined) {
        problems.push(`${path} references unknown variable ${JSON.stringify(expression.id)}`)
        return { kind: 'bool' }
      }
      return variable.sort === 'enum' ? { kind: 'enum', domain: variable.domain } : { kind: variable.sort }
    }
    case 'not': {
      expectBool(child(expression.value, 'value'), `${path}.value`)
      return { kind: 'bool' }
    }
    case 'and':
    case 'or': {
      if (expression.operands.length < 2) problems.push(`${path}.${expression.kind} requires at least two operands`)
      expression.operands.forEach((operand, index) => expectBool(child(operand, `operands[${index}]`), `${path}.operands[${index}]`))
      return { kind: 'bool' }
    }
    case 'implies': {
      expectBool(child(expression.left, 'left'), `${path}.left`)
      expectBool(child(expression.right, 'right'), `${path}.right`)
      return { kind: 'bool' }
    }
    case 'eq':
    case 'neq': {
      const left = child(expression.left, 'left')
      const right = child(expression.right, 'right')
      if (!compatible(left, right)) problems.push(`${path} compares incompatible ${left.kind} and ${right.kind} expressions`)
      return { kind: 'bool' }
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      expectNumeric(child(expression.left, 'left'), `${path}.left`)
      expectNumeric(child(expression.right, 'right'), `${path}.right`)
      return { kind: 'bool' }
    }
    case 'add':
    case 'multiply': {
      if (expression.operands.length < 2) problems.push(`${path}.${expression.kind} requires at least two operands`)
      const sorts = expression.operands.map((operand, index) => child(operand, `operands[${index}]`))
      sorts.forEach((sort, index) => expectNumeric(sort, `${path}.operands[${index}]`))
      return { kind: sorts.some(sort => sort.kind === 'real') ? 'real' : 'int' }
    }
    case 'subtract': {
      const left = child(expression.left, 'left')
      const right = child(expression.right, 'right')
      expectNumeric(left, `${path}.left`)
      expectNumeric(right, `${path}.right`)
      return { kind: left.kind === 'real' || right.kind === 'real' ? 'real' : 'int' }
    }
    case 'divide': {
      expectNumeric(child(expression.left, 'left'), `${path}.left`)
      expectNumeric(child(expression.right, 'right'), `${path}.right`)
      const divisor = expression.right
      if (divisor.kind === 'literal' && (divisor.sort === 'int' || divisor.sort === 'real')) {
        pushExactProblem(problems, `${path}.right`, () => {
          const zero = divisor.sort === 'int' ? Exact.integer(divisor.value) === 0n : Exact.isZero(divisor.value)
          if (zero) throw new TypeError('literal divisor must not be zero')
        })
      }
      return { kind: 'real' }
    }
    case 'negate': {
      const sort = child(expression.value, 'value')
      expectNumeric(sort, `${path}.value`)
      return sort
    }
    case 'if': {
      expectBool(child(expression.condition, 'condition'), `${path}.condition`)
      const thenSort = child(expression.then, 'then')
      const elseSort = child(expression.else, 'else')
      if (!compatible(thenSort, elseSort)) problems.push(`${path} branches have incompatible ${thenSort.kind} and ${elseSort.kind} sorts`)
      return numeric(thenSort) && numeric(elseSort) && (thenSort.kind === 'real' || elseSort.kind === 'real')
        ? { kind: 'real' }
        : thenSort
    }
    default:
      problems.push(`${path} uses unsupported expression kind ${JSON.stringify((expression as { readonly kind?: unknown }).kind)}`)
      return { kind: 'bool' }
  }
}

export const mergeLimits = (input: Partial<Limits> = {}): Limits => {
  const limits = { ...defaultLimits, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`solver limit ${name} must be a positive safe integer, received ${String(value)}`)
    }
  }
  return limits
}

const enforce = (stats: Stats, limits: Limits): void => {
  const checks: readonly [keyof Limits, number][] = [
    ['maxVariables', stats.variables],
    ['maxConstraints', stats.constraints],
    ['maxObjectives', stats.objectives],
    ['maxEnumValues', stats.enumValues],
    ['maxExpressionNodes', stats.expressionNodes],
    ['maxExpressionDepth', stats.expressionDepth]
  ]
  for (const [limit, actual] of checks) {
    if (actual > limits[limit]) throw new ModelLimitError(limit, actual, limits[limit])
  }
}

/** Validates sorts and exact values before any backend is invoked. */
export const model = (input: Model, limitInput: Partial<Limits> = {}): Stats => {
  const limits = mergeLimits(limitInput)
  const problems: string[] = []
  if (input.schema !== schema) problems.push(`schema must be ${JSON.stringify(schema)}`)
  const domains = new Map<string, readonly string[]>()
  const enumDeclarations = input.enums ?? []
  duplicates(enumDeclarations.map(domain => domain.id), 'enums', problems)
  enumDeclarations.forEach((domain, index) => {
    requireId(domain.id, `enums[${index}].id`, problems)
    if (domain.values.length === 0) problems.push(`enums[${index}] must contain at least one value`)
    if (new Set(domain.values).size !== domain.values.length) problems.push(`enums[${index}] contains duplicate values`)
    domains.set(domain.id, domain.values)
  })

  const variables = new Map<string, Variable>()
  duplicates(input.variables.map(variable => variable.id), 'variables', problems)
  input.variables.forEach((variable, index) => {
    requireId(variable.id, `variables[${index}].id`, problems)
    variables.set(variable.id, variable)
    if (variable.sort === 'enum' && !domains.has(variable.domain)) {
      problems.push(`variables[${index}] references unknown enum domain ${JSON.stringify(variable.domain)}`)
    }
    if (variable.sort === 'int') {
      pushExactProblem(problems, `variables[${index}].min`, () => Exact.integer(variable.min))
      pushExactProblem(problems, `variables[${index}].max`, () => Exact.integer(variable.max))
      try {
        if (Exact.compare(rationalOfInteger(variable, 'min'), rationalOfInteger(variable, 'max')) > 0) {
          problems.push(`variables[${index}] has min greater than max`)
        }
      } catch { /* exact-value problems are already reported above */ }
    }
    if (variable.sort === 'real') {
      if (variable.min !== undefined) pushExactProblem(problems, `variables[${index}].min`, () => Exact.rational(variable.min!))
      if (variable.max !== undefined) pushExactProblem(problems, `variables[${index}].max`, () => Exact.rational(variable.max!))
      if (variable.min !== undefined && variable.max !== undefined) {
        try {
          if (Exact.compare(variable.min, variable.max) > 0) problems.push(`variables[${index}] has min greater than max`)
        } catch { /* exact-value problems are already reported above */ }
      }
    }
  })

  duplicates([
    ...input.constraints.map(constraint => constraint.id),
    ...(input.softConstraints ?? []).map(constraint => constraint.id)
  ], 'constraints', problems)
  duplicates((input.objectives ?? []).map(objective => objective.id), 'objectives', problems)

  const walk: Walk = { nodes: 0, depth: 0 }
  input.constraints.forEach((constraint, index) => {
    requireId(constraint.id, `constraints[${index}].id`, problems)
    const sort = infer(constraint.expression, `constraints[${index}].expression`, variables, domains, problems, walk, 1)
    if (sort.kind !== 'bool') problems.push(`constraints[${index}].expression must be boolean, received ${sort.kind}`)
  })
  ;(input.softConstraints ?? []).forEach((constraint, index) => {
    requireId(constraint.id, `softConstraints[${index}].id`, problems)
    const sort = infer(constraint.expression, `softConstraints[${index}].expression`, variables, domains, problems, walk, 1)
    if (sort.kind !== 'bool') problems.push(`softConstraints[${index}].expression must be boolean, received ${sort.kind}`)
    pushExactProblem(problems, `softConstraints[${index}].weight`, () => {
      if (Exact.compare(constraint.weight, '0') <= 0) throw new TypeError('weight must be greater than zero')
    })
  })
  ;(input.objectives ?? []).forEach((objective, index) => {
    requireId(objective.id, `objectives[${index}].id`, problems)
    const sort = infer(objective.expression, `objectives[${index}].expression`, variables, domains, problems, walk, 1)
    if (!numeric(sort)) problems.push(`objectives[${index}].expression must be numeric, received ${sort.kind}`)
  })

  if (problems.length > 0) throw new ModelValidationError(problems)
  const stats: Stats = {
    variables: input.variables.length,
    constraints: input.constraints.length + (input.softConstraints?.length ?? 0),
    objectives: input.objectives?.length ?? 0,
    enumValues: enumDeclarations.reduce((sum, domain) => sum + domain.values.length, 0),
    expressionNodes: walk.nodes,
    expressionDepth: walk.depth
  }
  enforce(stats, limits)
  return stats
}
