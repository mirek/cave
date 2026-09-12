import { diagnosticText } from './diagnostic-text.ts'
import type { Limits } from './adapter.ts'
import { defaultLimits } from './adapter.ts'
import * as Exact from './exact.ts'
import { numericDigits } from './numeric-size.ts'
import { schema, type Expression, type Model, type Rational, type Variable } from './model.ts'

export { validateContext as explanationContext } from './context.ts'

/** Validate a portable unknown-outcome reason without changing its contents. */
export const unknownReason = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('unknown solver reason must be an object')
  }
  const { kind, message, limit } = value as Record<string, unknown>
  if (typeof kind !== 'string' || !['timeout', 'resource-limit', 'cancelled', 'backend-error', 'indeterminate'].includes(kind)) {
    throw new TypeError('unknown solver reason kind must be timeout, resource-limit, cancelled, backend-error or indeterminate')
  }
  if (typeof message !== 'string') throw new TypeError('unknown solver reason message must be a string')
  if (limit !== undefined && (typeof limit !== 'string' || !Object.hasOwn(defaultLimits, limit))) {
    throw new TypeError('unknown solver reason limit must name a supported solver limit')
  }
}

/** Validate metadata shared by adapter results and explanation runs. */
export const resultMetadata = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('solver result metadata must be an object')
  }
  const { backend, elapsedMs, diagnostics } = value as Record<string, unknown>
  if (backend === null || typeof backend !== 'object' || Array.isArray(backend)) {
    throw new TypeError('solver backend must be an object')
  }
  const { name, version } = backend as Record<string, unknown>
  if (typeof name !== 'string' || name === '') throw new TypeError('solver backend name must be a non-empty string')
  if (typeof version !== 'string' || version === '') throw new TypeError('solver backend version must be a non-empty string')
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new TypeError('solver elapsedMs must be a finite non-negative number')
  }
  if (!Array.isArray(diagnostics)) throw new TypeError('solver diagnostics must be an array')
  for (let index = 0; index < diagnostics.length; index++) {
    const entry: unknown = diagnostics[index]
    if (!Object.hasOwn(diagnostics, index) || entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`solver diagnostics[${index}] must be an object`)
    }
    const { level, code, message } = entry as Record<string, unknown>
    if (level !== 'info' && level !== 'warning' && level !== 'error') {
      throw new TypeError(`solver diagnostics[${index}].level must be info, warning or error`)
    }
    if (typeof code !== 'string' || typeof message !== 'string') {
      throw new TypeError(`solver diagnostics[${index}] code and message must be strings`)
    }
  }
}

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

const captureRational = (value: Rational): Rational =>
  value !== null && typeof value === 'object'
    ? { numerator: value.numerator, denominator: value.denominator } : value

const pushExactProblem = (problems: string[], path: string, run: () => unknown): void => {
  try {
    run()
  } catch (error) {
    problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Describe malformed fields without traversing caller objects or invoking JSON hooks. */
const diagnosticValue = (value: unknown): string => {
  if (typeof value === 'string') return diagnosticText(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  return value === undefined ? 'undefined' : `<${typeof value}>`
}

const diagnosticSort = (kind: unknown): string =>
  typeof kind === 'string' ? diagnosticText(kind, false) : diagnosticValue(kind)

const requireId = (id: string, path: string, problems: string[]): void => {
  if (typeof id !== 'string' || id.match(idPattern)?.[0] !== id) {
    problems.push(`${path} must match ${String(idPattern)}`)
  }
}

const provenance = (
  value: { readonly description?: string, readonly declaration?: { readonly uri: string, readonly line?: number, readonly column?: number }, readonly evidenceRowIds?: readonly string[], readonly scenarioInputIds?: readonly string[] },
  path: string,
  problems: string[]
): void => {
  const description = value.description
  if (description !== undefined && typeof description !== 'string') {
    problems.push(`${path}.description must be a string`)
  }
  if (value.declaration !== undefined) {
    const declaration = value.declaration
    if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
      problems.push(`${path}.declaration must be an object`)
    } else {
      if (typeof declaration.uri !== 'string') problems.push(`${path}.declaration.uri must be a string`)
      else if (declaration.uri.trim() === '') problems.push(`${path}.declaration.uri must not be empty`)
      for (const position of ['line', 'column'] as const) {
        const at = declaration[position]
        if (at !== undefined && (!Number.isSafeInteger(at) || at <= 0)) {
          problems.push(`${path}.declaration.${position} must be a positive safe integer`)
        }
      }
    }
  }
  for (const [name, ids] of [
    ['evidenceRowIds', value.evidenceRowIds],
    ['scenarioInputIds', value.scenarioInputIds]
  ] as const) {
    if (ids === undefined) continue
    if (!Array.isArray(ids)) {
      problems.push(`${path}.${name} must be an array`)
      continue
    }
    const seen = new Set<string>()
    let duplicate = false
    for (let index = 0; index < ids.length; index++) {
      const id = Object.hasOwn(ids, index) ? ids[index] : undefined
      if (typeof id !== 'string') problems.push(`${path}.${name}[${index}] must be a string`)
      else {
        if (id.trim() === '') problems.push(`${path}.${name}[${index}] must not be empty`)
        if (seen.has(id)) duplicate = true
        seen.add(id)
      }
    }
    if (duplicate) problems.push(`${path}.${name} contains duplicate identifiers`)
  }
}

/** Traverse caller arrays without dispatching through overridden array methods. */
const eachIndexed = <T>(values: readonly T[], visit: (value: T, index: number) => void): void => {
  const length = values.length
  for (let index = 0; index < length; index++) visit(values[index]!, index)
}

const mapIndexed = <T, U>(values: readonly T[], visit: (value: T, index: number) => U): U[] => {
  const result: U[] = []
  eachIndexed(values, (value, index) => result.push(visit(value, index)))
  return result
}

const duplicates = (ids: readonly string[], path: string, problems: string[]): void => {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      problems.push(`${path} contains duplicate identifier ${diagnosticValue(id)}`)
    }
    seen.add(id)
  }
}

type Walk = { nodes: number, depth: number, readonly zeroLiterals: WeakMap<Expression, boolean>, readonly limits: Limits, readonly charge: (value: unknown, sort: 'int' | 'real') => void }

type Child = { readonly value: Expression | undefined, readonly suffix: string }

function* children(expression: Expression): Generator<Child> {
  switch (expression.kind) {
    case 'not':
    case 'negate': yield { value: expression.value, suffix: 'value' }; return
    case 'and':
    case 'or':
    case 'add':
    case 'multiply':
      for (let index = 0; index < expression.operands.length; index++) {
        yield { value: Object.hasOwn(expression.operands, index) ? expression.operands[index] : undefined, suffix: `operands[${index}]` }
      }
      return
    case 'if':
      yield { value: expression.condition, suffix: 'condition' }
      yield { value: expression.then, suffix: 'then' }
      yield { value: expression.else, suffix: 'else' }
      return
    case 'implies': case 'eq': case 'neq': case 'lt': case 'lte':
    case 'gt': case 'gte': case 'subtract': case 'divide':
      yield { value: expression.left, suffix: 'left' }
      yield { value: expression.right, suffix: 'right' }
  }
}

const infer = (
  expression: Expression,
  path: string,
  variables: ReadonlyMap<string, Variable>,
  domains: ReadonlyMap<string, ReadonlySet<string>>,
  problems: string[],
  walk: Walk,
  depth: number
): Sort => {
  type Frame = { expression: Expression, path: string, depth: number, children: Generator<Child> }
  const frames: Frame[] = []
  const resolved = new WeakMap<Expression, Sort>()
  const enter = (value: Expression | undefined, at: string, level: number): void => {
    walk.nodes += 1
    walk.depth = Math.max(walk.depth, level)
    if (walk.nodes > walk.limits.maxExpressionNodes) {
      throw new ModelLimitError('maxExpressionNodes', walk.nodes, walk.limits.maxExpressionNodes)
    }
    if (level > walk.limits.maxExpressionDepth) {
      throw new ModelLimitError('maxExpressionDepth', level, walk.limits.maxExpressionDepth)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ModelValidationError([`${at} must be an expression object`])
    }
    if ((value.kind === 'and' || value.kind === 'or' || value.kind === 'add' || value.kind === 'multiply') && !Array.isArray(value.operands)) {
      throw new ModelValidationError([`${at}.operands must be an array`])
    }
    frames.push({ expression: value, path: at, depth: level, children: children(value) })
  }
  enter(expression, path, depth)
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!
    const next = frame.children.next()
    if (!next.done) {
      enter(next.value.value, `${frame.path}.${next.value.suffix}`, frame.depth + 1)
    } else {
      resolved.set(frame.expression, inferNode(frame.expression, frame.path, variables, domains, problems, resolved, walk))
      frames.pop()
    }
  }
  return resolved.get(expression)!
}

const inferNode = (
  expression: Expression,
  path: string,
  variables: ReadonlyMap<string, Variable>,
  domains: ReadonlyMap<string, ReadonlySet<string>>,
  problems: string[],
  resolved: WeakMap<Expression, Sort>,
  walk: Walk
): Sort => {
  const child = (value: Expression, _suffix: string): Sort => resolved.get(value)!
  const expectBool = (sort: Sort, at: string): void => {
    if (sort.kind !== 'bool') problems.push(`${at} must be boolean, received ${diagnosticSort(sort.kind)}`)
  }
  const expectNumeric = (sort: Sort, at: string): void => {
    if (!numeric(sort)) problems.push(`${at} must be numeric, received ${diagnosticSort(sort.kind)}`)
  }

  switch (expression.kind) {
    case 'literal':
      switch (expression.sort) {
        case 'bool':
          if (typeof expression.value !== 'boolean') problems.push(`${path}.value must be a Boolean`)
          return { kind: 'bool' }
        case 'int': {
          const value = expression.value
          walk.charge(value, 'int')
          pushExactProblem(problems, path, () => walk.zeroLiterals.set(expression, Exact.integer(value) === 0n))
          return { kind: 'int' }
        }
        case 'real': {
          const value = captureRational(expression.value)
          walk.charge(value, 'real')
          pushExactProblem(problems, path, () => walk.zeroLiterals.set(expression, Exact.rational(value).numerator === '0'))
          return { kind: 'real' }
        }
        case 'enum': {
          const values = domains.get(expression.domain)
          if (values === undefined) problems.push(`${path} references unknown enum domain ${diagnosticValue(expression.domain)}`)
          else if (!values.has(expression.value)) problems.push(`${path} value ${diagnosticValue(expression.value)} is outside enum domain ${diagnosticValue(expression.domain)}`)
          return { kind: 'enum', domain: expression.domain }
        }
        default:
          problems.push(`${path} uses an unsupported literal sort`)
          return { kind: 'bool' }
      }
    case 'variable': {
      const variable = variables.get(expression.id)
      if (variable === undefined) {
        problems.push(`${path} references unknown variable ${diagnosticValue(expression.id)}`)
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
      eachIndexed(expression.operands, (operand, index) => expectBool(child(operand, `operands[${index}]`), `${path}.operands[${index}]`))
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
      if (!compatible(left, right)) problems.push(`${path} compares incompatible ${diagnosticSort(left.kind)} and ${diagnosticSort(right.kind)} expressions`)
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
      const sorts = mapIndexed(expression.operands, (operand, index) => child(operand, `operands[${index}]`))
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
          const zero = walk.zeroLiterals.get(divisor)
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
      if (!compatible(thenSort, elseSort)) problems.push(`${path} branches have incompatible ${diagnosticSort(thenSort.kind)} and ${diagnosticSort(elseSort.kind)} sorts`)
      return numeric(thenSort) && numeric(elseSort) && (thenSort.kind === 'real' || elseSort.kind === 'real')
        ? { kind: 'real' }
        : thenSort
    }
    default:
      problems.push(`${path} uses unsupported expression kind ${diagnosticValue((expression as { readonly kind?: unknown }).kind)}`)
      return { kind: 'bool' }
  }
}

export const mergeLimits = (input: Partial<Limits> = {}): Limits => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('solver limits must be an object')
  }
  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(defaultLimits, name)) throw new TypeError(`unknown solver limit ${diagnosticText(name)}`)
  }
  const limits = Object.fromEntries(Object.entries(defaultLimits).map(([name, fallback]) =>
    [name, name in input ? input[name as keyof Limits] : fallback])) as Limits
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      const received = typeof value === 'object' || typeof value === 'function' ? typeof value : diagnosticText(String(value), false)
      throw new TypeError(`solver limit ${name} must be a positive safe integer, received ${received}`)
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
  let numericTotal = 0
  const charge = (value: unknown, sort: 'int' | 'real'): void => {
    numericTotal += numericDigits(value, sort)
    if (numericTotal > limits.maxNumericDigits) {
      throw new ModelLimitError('maxNumericDigits', numericTotal, limits.maxNumericDigits)
    }
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ModelValidationError(['model must be an object'])
  }
  for (const key of ['variables', 'constraints', 'enums', 'softConstraints', 'objectives'] as const) {
    const declarations = input[key]
    if (declarations === undefined && key !== 'variables' && key !== 'constraints') continue
    if (!Array.isArray(declarations)) {
      problems.push(`${key} must be an array`)
    }
  }
  if (problems.length > 0) throw new ModelValidationError(problems)
  enforce({
    variables: input.variables.length,
    constraints: input.constraints.length + (input.softConstraints?.length ?? 0),
    objectives: input.objectives?.length ?? 0,
    enumValues: 0, expressionNodes: 0, expressionDepth: 0,
  }, limits)
  for (const key of ['variables', 'constraints', 'enums', 'softConstraints', 'objectives'] as const) {
    const declarations = input[key]
    if (declarations === undefined) continue
    for (let index = 0; index < declarations.length; index++) {
      const declaration = Object.hasOwn(declarations, index) ? declarations[index] : undefined
      if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
        problems.push(`${key}[${index}] must be a declaration object`)
      }
    }
  }
  if (problems.length > 0) throw new ModelValidationError(problems)
  if (input.schema !== schema) problems.push(`schema must be ${JSON.stringify(schema)}`)
  const domains = new Map<string, ReadonlySet<string>>()
  const enumDeclarations = input.enums ?? []
  let enumValues = 0
  duplicates(mapIndexed(enumDeclarations, domain => domain.id), 'enums', problems)
  eachIndexed(enumDeclarations, (domain, index) => {
    requireId(domain.id, `enums[${index}].id`, problems)
    provenance(domain, `enums[${index}]`, problems)
    const values = Array.isArray(domain.values) ? domain.values : []
    if (!Array.isArray(domain.values)) problems.push(`enums[${index}].values must be an array`)
    enumValues += values.length
    if (enumValues > limits.maxEnumValues) throw new ModelLimitError('maxEnumValues', enumValues, limits.maxEnumValues)
    if (values.length === 0) problems.push(`enums[${index}] must contain at least one value`)
    const members = new Set<string>()
    let duplicate = false
    for (let member = 0; member < values.length; member++) {
      const value = Object.hasOwn(values, member) ? values[member] : undefined
      if (typeof value !== 'string') problems.push(`enums[${index}].values[${member}] must be a string`)
      else {
        if (members.has(value)) duplicate = true
        members.add(value)
      }
    }
    if (duplicate) problems.push(`enums[${index}] contains duplicate values`)
    domains.set(domain.id, members)
  })

  const variables = new Map<string, Variable>()
  duplicates(mapIndexed(input.variables, variable => variable.id), 'variables', problems)
  eachIndexed(input.variables, (variable, index) => {
    requireId(variable.id, `variables[${index}].id`, problems)
    if (!['bool', 'int', 'real', 'enum'].includes(variable.sort)) problems.push(`variables[${index}] uses an unsupported sort`)
    provenance(variable, `variables[${index}]`, problems)
    variables.set(variable.id, variable)
    if (variable.sort === 'enum' && !domains.has(variable.domain)) {
      problems.push(`variables[${index}] references unknown enum domain ${diagnosticValue(variable.domain)}`)
    }
    if (variable.sort === 'int') {
      const min = variable.min, max = variable.max
      charge(min, 'int')
      charge(max, 'int')
      pushExactProblem(problems, `variables[${index}].min`, () => Exact.integer(min))
      pushExactProblem(problems, `variables[${index}].max`, () => Exact.integer(max))
      try {
        if (Exact.compare(String(Exact.integer(min)), String(Exact.integer(max))) > 0) {
          problems.push(`variables[${index}] has min greater than max`)
        }
      } catch { /* exact-value problems are already reported above */ }
    }
    if (variable.sort === 'real') {
      const rawMin = variable.min, rawMax = variable.max
      const min = rawMin === undefined ? undefined : captureRational(rawMin)
      const max = rawMax === undefined ? undefined : captureRational(rawMax)
      if (min !== undefined) charge(min, 'real')
      if (max !== undefined) charge(max, 'real')
      if (min !== undefined) pushExactProblem(problems, `variables[${index}].min`, () => Exact.rational(min))
      if (max !== undefined) pushExactProblem(problems, `variables[${index}].max`, () => Exact.rational(max))
      if (min !== undefined && max !== undefined) {
        try {
          if (Exact.compare(min, max) > 0) problems.push(`variables[${index}] has min greater than max`)
        } catch { /* exact-value problems are already reported above */ }
      }
    }
  })

  duplicates([
    ...mapIndexed(input.constraints, constraint => constraint.id),
    ...mapIndexed(input.softConstraints ?? [], constraint => constraint.id)
  ], 'constraints', problems)
  duplicates(mapIndexed(input.objectives ?? [], objective => objective.id), 'objectives', problems)

  const walk: Walk = { nodes: 0, depth: 0, limits, charge, zeroLiterals: new WeakMap() }
  eachIndexed(input.constraints, (constraint, index) => {
    requireId(constraint.id, `constraints[${index}].id`, problems)
    provenance(constraint, `constraints[${index}]`, problems)
    const sort = infer(constraint.expression, `constraints[${index}].expression`, variables, domains, problems, walk, 1)
    if (sort.kind !== 'bool') problems.push(`constraints[${index}].expression must be boolean, received ${diagnosticSort(sort.kind)}`)
  })
  eachIndexed(input.softConstraints ?? [], (constraint, index) => {
    requireId(constraint.id, `softConstraints[${index}].id`, problems)
    provenance(constraint, `softConstraints[${index}]`, problems)
    const sort = infer(constraint.expression, `softConstraints[${index}].expression`, variables, domains, problems, walk, 1)
    if (sort.kind !== 'bool') problems.push(`softConstraints[${index}].expression must be boolean, received ${diagnosticSort(sort.kind)}`)
    const weight = captureRational(constraint.weight)
    charge(weight, 'real')
    pushExactProblem(problems, `softConstraints[${index}].weight`, () => {
      if (Exact.compare(weight, '0') <= 0) throw new TypeError('weight must be greater than zero')
    })
  })
  eachIndexed(input.objectives ?? [], (objective, index) => {
    requireId(objective.id, `objectives[${index}].id`, problems)
    if (objective.direction !== 'minimize' && objective.direction !== 'maximize') {
      problems.push(`objectives[${index}].direction must be minimize or maximize`)
    }
    provenance(objective, `objectives[${index}]`, problems)
    const sort = infer(objective.expression, `objectives[${index}].expression`, variables, domains, problems, walk, 1)
    if (!numeric(sort)) problems.push(`objectives[${index}].expression must be numeric, received ${diagnosticSort(sort.kind)}`)
  })

  if (problems.length > 0) throw new ModelValidationError(problems)
  const stats: Stats = {
    variables: input.variables.length,
    constraints: input.constraints.length + (input.softConstraints?.length ?? 0),
    objectives: input.objectives?.length ?? 0,
    enumValues,
    expressionNodes: walk.nodes,
    expressionDepth: walk.depth
  }
  enforce(stats, limits)
  return stats
}
