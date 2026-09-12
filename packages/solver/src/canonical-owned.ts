import { createHash } from 'node:crypto'
import type { Limits } from './adapter.ts'
import * as Exact from './exact.ts'
import type { Expression, Model, Rational } from './model.ts'
import { model as validate } from './validate.ts'

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const exact = (value: Rational): Json => Exact.rational(value)

const canonicalNode = (input: Expression, resolved: WeakMap<Expression, Json>): Json => {
  switch (input.kind) {
    case 'literal':
      if (input.sort === 'int') return { kind: input.kind, sort: input.sort, value: String(Exact.integer(input.value)) }
      if (input.sort === 'real') return { kind: input.kind, sort: input.sort, value: exact(input.value) }
      if (input.sort === 'enum') return { kind: input.kind, sort: input.sort, domain: input.domain, value: input.value }
      return { kind: input.kind, sort: input.sort, value: input.value }
    case 'variable': return { kind: input.kind, id: input.id }
    case 'not':
    case 'negate': return { kind: input.kind, value: resolved.get(input.value)! }
    case 'and':
    case 'or':
    case 'add':
    case 'multiply': {
      const operands = input.operands.map(value => resolved.get(value)!)
        .sort(compareCanonical)
      return { kind: input.kind, operands }
    }
    case 'implies':
    case 'subtract':
    case 'divide':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return { kind: input.kind, left: resolved.get(input.left)!, right: resolved.get(input.right)! }
    case 'eq':
    case 'neq': {
      const operands = [resolved.get(input.left)!, resolved.get(input.right)!]
        .sort(compareCanonical)
      return { kind: input.kind, left: operands[0]!, right: operands[1]! }
    }
    case 'if':
      return { kind: input.kind, condition: resolved.get(input.condition)!, then: resolved.get(input.then)!, else: resolved.get(input.else)! }
  }
}

const expression = (input: Expression, resolved: WeakMap<Expression, Json>): Json => {
  const stack: { node: Expression, after: boolean }[] = [{ node: input, after: false }]
  while (stack.length > 0) {
    const { node, after } = stack.pop()!
    if (resolved.has(node)) continue
    if (after) {
      resolved.set(node, canonicalNode(node, resolved))
      continue
    }
    stack.push({ node, after: true })
    const push = (value: Expression): void => { stack.push({ node: value, after: false }) }
    switch (node.kind) {
      case 'literal': case 'variable': break
      case 'not': case 'negate': push(node.value); break
      case 'and': case 'or': case 'add': case 'multiply':
        for (let index = node.operands.length - 1; index >= 0; index--) push(node.operands[index]!)
        break
      case 'if': push(node.else); push(node.then); push(node.condition); break
      default: push(node.right); push(node.left)
    }
  }
  return resolved.get(input)!
}

function* tokens(value: Json): Generator<string> {
  const stack: ({ value: Json } | { text: string })[] = [{ value }]
  while (stack.length > 0) {
    const item = stack.pop()!
    if ('text' in item) { yield item.text; continue }
    const current = item.value
    if (current === null || typeof current !== 'object') { yield JSON.stringify(current); continue }
    if (Array.isArray(current)) {
      yield '['
      stack.push({ text: ']' })
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push({ value: current[index]! })
        if (index > 0) stack.push({ text: ',' })
      }
    } else {
      const record = current as Readonly<Record<string, Json>>
      const keys = Object.keys(record).sort()
      yield '{'
      stack.push({ text: '}' })
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!
        stack.push({ value: record[key]! }, { text: `${JSON.stringify(key)}:` })
        if (index > 0) stack.push({ text: ',' })
      }
    }
  }
}

/** Keep complete JSON tokens together so UTF-8 encoding never splits a surrogate pair. */
function* chunks(value: Json): Generator<string> {
  let pending: string[] = []
  let length = 0
  for (const token of tokens(value)) {
    pending.push(token)
    length += token.length
    if (length >= 65536) {
      yield pending.join('')
      pending = []
      length = 0
    }
  }
  if (pending.length > 0) yield pending.join('')
}

const stableStringify = (value: Json): string => [...chunks(value)].join('')

/** Compare canonical text lazily instead of materializing each entire subtree. */
const compareCanonical = (left: Json, right: Json): number => {
  if (left === right) return 0
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  let a = leftTokens.next()
  let b = rightTokens.next()
  let at = 0
  let bt = 0
  while (!a.done && !b.done) {
    const length = Math.min(a.value.length - at, b.value.length - bt)
    const order = compareText(a.value.slice(at, at + length), b.value.slice(bt, bt + length))
    if (order !== 0) return order
    at += length
    bt += length
    if (at === a.value.length) { a = leftTokens.next(); at = 0 }
    if (bt === b.value.length) { b = rightTokens.next(); bt = 0 }
  }
  return a.done ? (b.done ? 0 : -1) : 1
}

const byId = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] =>
  [...values].sort((left, right) => compareText(left.id, right.id))

/** Private entrypoint: the caller owns the captured model and resolved limits. */
const canonicalOwned = (input: Model, limits: Limits): Json => {
  validate(input, limits)
  const resolved = new WeakMap<Expression, Json>()
  const canonical: Json = {
    schema: input.schema,
    enums: byId(input.enums ?? []).map(domain => ({ id: domain.id, values: [...domain.values].sort() })),
    variables: byId(input.variables).map((variable): Json => {
      switch (variable.sort) {
        case 'bool': return { id: variable.id, sort: variable.sort }
        case 'int': return { id: variable.id, sort: variable.sort, min: String(Exact.integer(variable.min)), max: String(Exact.integer(variable.max)) }
        case 'real': return {
          id: variable.id,
          sort: variable.sort,
          ...(variable.min === undefined ? {} : { min: exact(variable.min) }),
          ...(variable.max === undefined ? {} : { max: exact(variable.max) })
        }
        case 'enum': return { id: variable.id, sort: variable.sort, domain: variable.domain }
      }
    }),
    constraints: byId(input.constraints).map(constraint => ({ id: constraint.id, expression: expression(constraint.expression, resolved) })),
    softConstraints: byId(input.softConstraints ?? []).map(constraint => ({
      id: constraint.id,
      expression: expression(constraint.expression, resolved),
      weight: exact(constraint.weight)
    })),
    objectives: (input.objectives ?? []).map(objective => ({
      id: objective.id,
      direction: objective.direction,
      expression: expression(objective.expression, resolved)
    }))
  }
  return canonical
}

export const serializeOwned = (input: Model, limits: Limits): string =>
  stableStringify(canonicalOwned(input, limits))

export const digestOwned = (input: Model, limits: Limits): string => {
  const hash = createHash('sha256')
  for (const chunk of chunks(canonicalOwned(input, limits))) hash.update(chunk)
  return `sha256:${hash.digest('hex')}`
}
