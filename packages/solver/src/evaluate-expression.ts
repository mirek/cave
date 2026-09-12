import type { Expression } from './model.ts'

/** Evaluate a captured expression with an explicit stack and caller-owned cache. */
export const evaluate = <T>(expression: Expression, steps: (value: Expression) => Generator<Expression, T, T>, cache: WeakMap<Expression, T>): T => {
  if (cache.has(expression)) return cache.get(expression)!
  const stack = [{ expression, iterator: steps(expression) }]
  let step = stack[0]!.iterator.next()
  while (true) {
    if (step.done) {
      cache.set(stack.pop()!.expression, step.value)
      if (stack.length === 0) return step.value
      step = stack[stack.length - 1]!.iterator.next(step.value)
    } else if (cache.has(step.value)) {
      step = stack[stack.length - 1]!.iterator.next(cache.get(step.value)!)
    } else {
      const child = { expression: step.value, iterator: steps(step.value) }
      stack.push(child)
      step = child.iterator.next()
    }
  }
}
