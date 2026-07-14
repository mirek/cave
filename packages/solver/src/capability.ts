import type { Capability, SolverAdapter } from './adapter.ts'
import type { Expression, Model } from './model.ts'

export class UnsupportedModelError extends Error {
  readonly backend: string
  readonly missing: readonly Capability[]

  constructor(backend: string, missing: readonly Capability[]) {
    super(`solver backend ${JSON.stringify(backend)} lacks capabilities: ${missing.join(', ')}`)
    this.name = 'UnsupportedModelError'
    this.backend = backend
    this.missing = missing
  }
}

const walk = (expression: Expression, visit: (expression: Expression) => void): void => {
  visit(expression)
  switch (expression.kind) {
    case 'literal':
    case 'variable': return
    case 'not':
    case 'negate': walk(expression.value, visit); return
    case 'and':
    case 'or':
    case 'add':
    case 'multiply': expression.operands.forEach(operand => walk(operand, visit)); return
    case 'if':
      walk(expression.condition, visit)
      walk(expression.then, visit)
      walk(expression.else, visit)
      return
    default:
      walk(expression.left, visit)
      walk(expression.right, visit)
  }
}

const hasNonlinearArithmetic = (expression: Expression): boolean => {
  let nonlinear = false
  const containsVariable = (candidate: Expression): boolean => {
    let found = false
    walk(candidate, node => { if (node.kind === 'variable') found = true })
    return found
  }
  walk(expression, node => {
    if (node.kind === 'multiply' && node.operands.filter(containsVariable).length > 1) nonlinear = true
    if (node.kind === 'divide' && containsVariable(node.right)) nonlinear = true
  })
  return nonlinear
}

export const required = (model: Model, unsatCore = false): ReadonlySet<Capability> => {
  const result = new Set<Capability>(['booleans'])
  if (model.variables.some(variable => variable.sort === 'int')) result.add('integers')
  if (model.variables.some(variable => variable.sort === 'real')) result.add('rationals')
  if ((model.enums?.length ?? 0) > 0 || model.variables.some(variable => variable.sort === 'enum')) result.add('finite-enums')
  if ((model.softConstraints?.length ?? 0) > 0) {
    result.add('soft-constraints')
    result.add('rationals')
  }
  if ((model.objectives?.length ?? 0) > 0) result.add('optimization')
  if ((model.objectives?.length ?? 0) > 1) result.add('lexicographic-objectives')
  if (unsatCore) result.add('unsat-cores')
  const expressions = [
    ...model.constraints.map(constraint => constraint.expression),
    ...(model.softConstraints ?? []).map(constraint => constraint.expression),
    ...(model.objectives ?? []).map(objective => objective.expression)
  ]
  for (const expression of expressions) {
    walk(expression, node => {
      if (node.kind === 'literal' && node.sort === 'int') result.add('integers')
      if (node.kind === 'literal' && node.sort === 'real') result.add('rationals')
      if (node.kind === 'literal' && node.sort === 'enum') result.add('finite-enums')
      if (node.kind === 'if') result.add('conditionals')
    })
    if (hasNonlinearArithmetic(expression)) result.add('nonlinear-arithmetic')
  }
  return result
}

export const missing = (adapter: SolverAdapter, model: Model, unsatCore = false): readonly Capability[] =>
  [...required(model, unsatCore)].filter(capability => !adapter.capabilities.has(capability)).sort()
