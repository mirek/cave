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

const children = (expression: Expression): readonly Expression[] => {
  switch (expression.kind) {
    case 'literal': case 'variable': return []
    case 'not': case 'negate': return [expression.value]
    case 'and': case 'or': case 'add': case 'multiply': return expression.operands
    case 'if': return [expression.condition, expression.then, expression.else]
    default: return [expression.left, expression.right]
  }
}

const walk = (
  expression: Expression,
  visit: (expression: Expression) => void,
  finish: (expression: Expression) => void
): void => {
  const active = new WeakSet<Expression>()
  const complete = new WeakSet<Expression>()
  const stack: { node: Expression, after: boolean }[] = [{ node: expression, after: false }]
  while (stack.length > 0) {
    const { node, after } = stack.pop()!
    if (after) {
      finish(node)
      active.delete(node)
      complete.add(node)
      continue
    }
    if (active.has(node)) throw new TypeError('capability discovery received a cyclic expression')
    if (complete.has(node)) continue
    active.add(node)
    visit(node)
    stack.push({ node, after: true })
    const operands = children(node)
    for (let index = operands.length - 1; index >= 0; index--) {
      stack.push({ node: operands[index]!, after: false })
    }
  }
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
    const containsVariable = new WeakMap<Expression, boolean>()
    let nonlinear = false
    walk(expression, node => {
      if (node.kind === 'literal' && node.sort === 'int') result.add('integers')
      if (node.kind === 'literal' && node.sort === 'real') result.add('rationals')
      // Portable division returns an exact real even when both operands are integers.
      if (node.kind === 'divide') result.add('rationals')
      if (node.kind === 'literal' && node.sort === 'enum') result.add('finite-enums')
      if (node.kind === 'if') result.add('conditionals')
    }, node => {
      const operands = children(node)
      if (node.kind === 'multiply' && operands.filter(value => containsVariable.get(value)).length > 1) nonlinear = true
      if (node.kind === 'divide' && containsVariable.get(node.right)) nonlinear = true
      containsVariable.set(node, node.kind === 'variable' || operands.some(value => containsVariable.get(value)))
    })
    if (nonlinear) result.add('nonlinear-arithmetic')
  }
  return result
}

export const missing = (adapter: SolverAdapter, model: Model, unsatCore = false): readonly Capability[] =>
  [...required(model, unsatCore)].filter(capability => !adapter.capabilities.has(capability)).sort()
