import { Value } from '@cavelang/core'
import type { Store } from '@cavelang/store/adapter'
import * as Compile from './compile.ts'
import * as Pattern from './pattern.ts'

export type { Match, Options } from './compile.ts'
export type { Window } from './compile.ts'

/**
 * Compile historical queries against vocabulary reconstructed at the same
 * transaction-time boundary as the rows. The store remains otherwise
 * unchanged; compiler SQL still applies the authoritative row boundary.
 */
const storeAtBoundary = (store: Store, options: Compile.Options): Store => {
  if (options.asOf === undefined) {
    return store
  }
  const registry = store.registryAsOf(options.asOf)
  return { ...store, registry: () => registry }
}

/**
 * Exact numeric attribute values are matched through normalized storage
 * columns, not their as-written spelling: `0.9B users/wk` and
 * `900M users/wk` denote the same number/unit pair. The compiler's existing
 * value filter pushes the normalized comparison into SQL; the final check
 * preserves exact unit and approximation semantics.
 */
const execute = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options = {}
): Compile.Window => {
  if (pattern.payload.kind !== 'attribute' || pattern.payload.value.kind !== 'term') {
    return Compile.window(storeAtBoundary(store, options), pattern, options)
  }
  const value = Value.parse(pattern.payload.value.text)
  if (value.kind !== 'number' || value.num === undefined) {
    return Compile.window(storeAtBoundary(store, options), pattern, options)
  }
  const expectedNum = value.num
  const filter: Pattern.Filter = {
    field: 'value', op: '=', value: expectedNum,
    ...value.unit === undefined ? {} : { unit: value.unit }
  }
  const normalized: Pattern.t = {
    ...pattern,
    payload: {
      kind: 'attribute',
      attribute: pattern.payload.attribute,
      value: { kind: 'wildcard' }
    },
    filters: [...pattern.filters, filter]
  }
  const expectedUnit = value.unit ?? null
  const expectedApprox = value.approx ? 1 : 0
  const result = Compile.window(storeAtBoundary(store, options), normalized, options)
  return { ...result, matches: result.matches.filter(match => {
    const row = match.row
    return row !== undefined &&
      row.value_num === expectedNum &&
      row.value_unit === expectedUnit &&
      row.value_approx === expectedApprox
  }) }
}

export const window = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options = {}
): Compile.Window => execute(store, pattern, options)

export const match = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options = {}
): Compile.Match[] => execute(store, pattern, options).matches

export const query = (
  store: Store,
  input: string,
  options: Compile.Options = {}
): Compile.Match[] =>
  match(store, Pattern.parse(input), options)
