import type { Expression } from './model.ts'
import * as Exact from './exact.ts'
import { evaluate } from './evaluate-expression.ts'

export type Sign = -1 | 0 | 1 | undefined
const addSigns = (left: Sign, right: Sign): Sign =>
  left === undefined || right === undefined ? undefined : left === 0 ? right : right === 0 || left === right ? left : undefined

/** Prove a constant's sign without constructing large rational intermediates. */
function* signSteps(expression: Expression, literal: (value: Expression) => Exact.Normalized): Generator<Expression, Sign, Sign> {
  switch (expression.kind) {
    case 'literal': {
      if (expression.sort !== 'int' && expression.sort !== 'real') return undefined
      const value = literal(expression)
      return value.numerator === '0' ? 0 : value.numerator.startsWith('-') ? -1 : 1
    }
    case 'negate': {
      const sign = yield expression.value
      return sign === undefined ? undefined : -sign as Sign
    }
    case 'add': {
      let sign: Sign = 0
      for (const operand of expression.operands) {
        sign = addSigns(sign, yield operand)
        if (sign === undefined) return undefined
      }
      return sign
    }
    case 'subtract': {
      const left = yield expression.left
      const right = yield expression.right
      return addSigns(left, right === undefined ? undefined : -right as Sign)
    }
    case 'multiply': {
      let sign: Sign = 1
      for (const operand of expression.operands) {
        const part = yield operand
        sign = sign === undefined || part === undefined ? undefined : sign * part as Sign
      }
      return sign
    }
    case 'divide': {
      const left = yield expression.left
      const right = yield expression.right
      return left === undefined || right === undefined || right === 0 ? undefined : left * right as Sign
    }
    default: return undefined
  }
}

export const constantSign = (
  expression: Expression,
  cache: WeakMap<Expression, Sign>,
  literal: (value: Expression) => Exact.Normalized = value => {
    if (value.kind === 'literal' && value.sort === 'int') return Exact.rational(String(Exact.integer(value.value)))
    if (value.kind === 'literal' && value.sort === 'real') return Exact.rational(value.value)
    throw new TypeError('expected a numeric literal')
  }
): Sign => evaluate(expression, value => signSteps(value, literal), cache)
