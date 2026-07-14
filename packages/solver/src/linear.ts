import type { Expression, Model } from './model.ts'
import { model as validate } from './validate.ts'

export type Analysis = {
  readonly linear: boolean
  readonly problems: readonly string[]
}

type Affine = { readonly linear: boolean, readonly constant: boolean }

const affine = (expression: Expression): Affine => {
  switch (expression.kind) {
    case 'literal': return { linear: expression.sort === 'int' || expression.sort === 'real', constant: true }
    case 'variable': return { linear: true, constant: false }
    case 'negate': return affine(expression.value)
    case 'add': {
      const parts = expression.operands.map(affine)
      return { linear: parts.every(part => part.linear), constant: parts.every(part => part.constant) }
    }
    case 'subtract': {
      const left = affine(expression.left)
      const right = affine(expression.right)
      return { linear: left.linear && right.linear, constant: left.constant && right.constant }
    }
    case 'multiply': {
      const parts = expression.operands.map(affine)
      return { linear: parts.every(part => part.linear) && parts.filter(part => !part.constant).length <= 1, constant: parts.every(part => part.constant) }
    }
    case 'divide': {
      const left = affine(expression.left)
      const right = affine(expression.right)
      return { linear: left.linear && right.linear && right.constant, constant: left.constant && right.constant }
    }
    default: return { linear: false, constant: false }
  }
}

const constraintIsLinear = (expression: Expression): boolean => {
  if (expression.kind !== 'eq' && expression.kind !== 'lte' && expression.kind !== 'gte') return false
  return affine(expression.left).linear && affine(expression.right).linear
}

/** Recognizes the portable LP/MIP subset without consulting a backend AST. */
export const model = (input: Model): Analysis => {
  validate(input)
  const problems: string[] = []
  if (input.variables.some(variable => variable.sort === 'bool' || variable.sort === 'enum')) {
    problems.push('Boolean and enum variables are outside the linear subset')
  }
  if ((input.softConstraints?.length ?? 0) > 0) problems.push('soft constraints are outside the linear subset')
  input.constraints.forEach(constraint => {
    if (!constraintIsLinear(constraint.expression)) problems.push(`constraint ${constraint.id} is not a non-strict linear comparison`)
  })
  ;(input.objectives ?? []).forEach(objective => {
    if (!affine(objective.expression).linear) problems.push(`objective ${objective.id} is not linear`)
  })
  return { linear: problems.length === 0, problems }
}
