import { evaluate } from './evaluate-expression.ts'
import { constantSign, type Sign } from './constant-sign.ts'
import { balancedReduce } from './balanced-reduce.ts'
import { sum } from './fraction-sum.ts'
import { product } from './fraction-product.ts'
import { clone } from './clone.ts'
import type { Expression, Model } from './model.ts'
import type { Limits } from './adapter.ts'
import { mergeLimits, model as validate } from './validate.ts'
import * as Exact from './exact.ts'

export type Analysis = {
  readonly linear: boolean
  readonly problems: readonly string[]
}

type Affine = { readonly linear: boolean, readonly constant: boolean }

const combine = (left: Exact.Normalized, right: Exact.Normalized, kind: 'add' | 'subtract' | 'multiply' | 'divide'): Exact.Normalized => {
  const a = BigInt(left.numerator)
  const b = BigInt(left.denominator)
  const c = BigInt(right.numerator)
  const d = BigInt(right.denominator)
  const [numerator, denominator] = kind === 'add' ? sum(a, b, c, d)
    : kind === 'subtract' ? sum(a, b, -c, d)
      : kind === 'multiply' ? product(a, b, c, d) : product(a, b, d, c)
  return Exact.fromBigInts(numerator, denominator)
}

/** Called only for numeric constant expressions already classified as affine. */
function* constantSteps(expression: Expression): Generator<Expression, Exact.Normalized, Exact.Normalized> {
  switch (expression.kind) {
    case 'literal':
      if (expression.sort === 'int') return Exact.rational(String(Exact.integer(expression.value)))
      if (expression.sort === 'real') return Exact.rational(expression.value)
      break
    case 'negate': return combine(Exact.rational('0'), (yield expression.value), 'subtract')
    case 'add':
    case 'multiply': {
      const values: Exact.Normalized[] = []
      for (const value of expression.operands) values.push(yield value)
      if (expression.kind === 'add') return balancedReduce(values, (left, right) => combine(left, right, 'add'))
      let numerator = 1n, denominator = 1n
      for (const value of values) {
        [numerator, denominator] = product(numerator, denominator, BigInt(value.numerator), BigInt(value.denominator))
      }
      return Exact.fromBigInts(numerator, denominator)
    }
    case 'subtract':
    case 'divide': return combine((yield expression.left), (yield expression.right), expression.kind)
  }
  throw new TypeError('expected an affine numeric constant')
}

function* affineSteps(expression: Expression, constants: WeakMap<Expression, Exact.Normalized>, signs: WeakMap<Expression, Sign>): Generator<Expression, Affine, Affine> {
  switch (expression.kind) {
    case 'literal': return { linear: expression.sort === 'int' || expression.sort === 'real', constant: true }
    case 'variable': return { linear: true, constant: false }
    case 'negate': return (yield expression.value)
    case 'add': {
      let linear = true, constant = true
      for (const value of expression.operands) {
        const part = yield value
        linear = linear && part.linear
        constant = constant && part.constant
      }
      return { linear, constant }
    }
    case 'subtract': {
      const left = (yield expression.left)
      const right = (yield expression.right)
      return { linear: left.linear && right.linear, constant: left.constant && right.constant }
    }
    case 'multiply': {
      let linear = true, variableParts = 0
      for (const value of expression.operands) {
        const part = yield value
        linear = linear && part.linear
        if (!part.constant) variableParts++
      }
      return { linear: linear && variableParts <= 1, constant: variableParts === 0 }
    }
    case 'divide': {
      const left = (yield expression.left)
      const right = (yield expression.right)
      let linear = false
      if (left.linear && right.linear && right.constant) {
        const sign = constantSign(expression.right, signs, value => evaluate(value, constantSteps, constants))
        linear = sign === undefined ? !Exact.isZero(evaluate(expression.right, constantSteps, constants)) : sign !== 0
      }
      return { linear, constant: left.constant && right.constant }
    }
    default: return { linear: false, constant: false }
  }
}

const constraintIsLinear = (expression: Expression, affine: (value: Expression) => Affine): boolean => {
  if (expression.kind !== 'eq' && expression.kind !== 'lte' && expression.kind !== 'gte') return false
  return affine(expression.left).linear && affine(expression.right).linear
}

/** Recognizes the portable LP/MIP subset without consulting a backend AST. */
export const model = (input: Model, limits: Partial<Limits> = {}): Analysis => {
  limits = mergeLimits(limits)
  validate(input, limits)
  input = clone(input)
  validate(input, limits)
  const problems: string[] = []
  const constants = new WeakMap<Expression, Exact.Normalized>()
  const classifications = new WeakMap<Expression, Affine>()
  const signs = new WeakMap<Expression, Sign>()
  const affine = (value: Expression): Affine => evaluate(value, expression => affineSteps(expression, constants, signs), classifications)
  if (input.variables.some(variable => variable.sort === 'bool' || variable.sort === 'enum')) {
    problems.push('Boolean and enum variables are outside the linear subset')
  }
  if ((input.softConstraints?.length ?? 0) > 0) problems.push('soft constraints are outside the linear subset')
  input.constraints.forEach(constraint => {
    if (!constraintIsLinear(constraint.expression, affine)) problems.push(`constraint ${constraint.id} is not a non-strict linear comparison`)
  })
  ;(input.objectives ?? []).forEach(objective => {
    if (!affine(objective.expression).linear) problems.push(`objective ${objective.id} is not linear`)
  })
  return { linear: problems.length === 0, problems }
}
