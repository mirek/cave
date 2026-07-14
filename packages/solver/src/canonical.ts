import { createHash } from 'node:crypto'
import * as Exact from './exact.ts'
import type { Expression, Model, Rational } from './model.ts'
import { model as validate } from './validate.ts'

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const exact = (value: Rational): Json => Exact.rational(value)

const expression = (input: Expression): Json => {
  switch (input.kind) {
    case 'literal':
      if (input.sort === 'int') return { kind: input.kind, sort: input.sort, value: String(Exact.integer(input.value)) }
      if (input.sort === 'real') return { kind: input.kind, sort: input.sort, value: exact(input.value) }
      if (input.sort === 'enum') return { kind: input.kind, sort: input.sort, domain: input.domain, value: input.value }
      return { kind: input.kind, sort: input.sort, value: input.value }
    case 'variable': return { kind: input.kind, id: input.id }
    case 'not':
    case 'negate': return { kind: input.kind, value: expression(input.value) }
    case 'and':
    case 'or':
    case 'add':
    case 'multiply': {
      const operands = input.operands.map(expression)
        .sort((left, right) => compareText(stableStringify(left), stableStringify(right)))
      return { kind: input.kind, operands }
    }
    case 'implies':
    case 'subtract':
    case 'divide':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return { kind: input.kind, left: expression(input.left), right: expression(input.right) }
    case 'eq':
    case 'neq': {
      const operands = [expression(input.left), expression(input.right)]
        .sort((left, right) => compareText(stableStringify(left), stableStringify(right)))
      return { kind: input.kind, left: operands[0]!, right: operands[1]! }
    }
    case 'if':
      return { kind: input.kind, condition: expression(input.condition), then: expression(input.then), else: expression(input.else) }
  }
}

const stableStringify = (value: Json): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Readonly<Record<string, Json>>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key]!)}`).join(',')}}`
}

const byId = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] =>
  [...values].sort((left, right) => compareText(left.id, right.id))

/** Canonical semantic JSON. Descriptions and evidence links are deliberately not identity. */
export const serialize = (input: Model): string => {
  validate(input)
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
    constraints: byId(input.constraints).map(constraint => ({ id: constraint.id, expression: expression(constraint.expression) })),
    softConstraints: byId(input.softConstraints ?? []).map(constraint => ({
      id: constraint.id,
      expression: expression(constraint.expression),
      weight: exact(constraint.weight)
    })),
    objectives: (input.objectives ?? []).map(objective => ({
      id: objective.id,
      direction: objective.direction,
      expression: expression(objective.expression)
    }))
  }
  return stableStringify(canonical)
}

export const digest = (input: Model): string =>
  `sha256:${createHash('sha256').update(serialize(input)).digest('hex')}`
