import type { Expectation } from './check.ts'

export type ConstraintTag = { readonly key: string, readonly value: null | string }

/** Shared contract for runtime shape checks and generated client declarations. */
export const constraintProblem = (expectation: Pick<Expectation, 'type' | 'kind' | 'name'>, tags: readonly ConstraintTag[]): string | undefined => {
  const cardinalities = tags.filter(tag => tag.key === 'cardinality').map(tag => tag.value)
  const units = tags.filter(tag => tag.key === 'unit').map(tag => tag.value)
  const prefix = `${expectation.type} EXPECTS ${expectation.name}: `
  if (cardinalities.length > 1 || cardinalities.some(value => value !== 'one' && value !== 'some')) {
    return `${prefix}cardinality must be one or some, at most once`
  }
  if (units.length > 1 || units.some(value => typeof value !== 'string' || value === '')) {
    return `${prefix}unit must have one non-empty text value`
  }
  if (expectation.kind === 'relation' && units.length > 0) {
    return `${prefix}relation expectations cannot declare #unit`
  }
  return undefined
}
