import { Value } from '@cavelang/core'
import type { Store } from '@cavelang/store/adapter'
import * as Compile from './compile.ts'
import * as Pattern from './pattern.ts'
import { captureOptions, capturePattern } from './capture.ts'
import { readSnapshot } from './read-snapshot.ts'

export type { Match, Options } from './compile.ts'
export type { Window } from './compile.ts'

/**
 * Compile historical queries against vocabulary reconstructed at the same
 * transaction-time boundary as the rows. The store remains otherwise
 * unchanged; compiler SQL still applies the authoritative row boundary.
 */
export const storeAtBoundary = (store: Store, options: Compile.Options): Store => {
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
  options: Compile.Options = {},
  positions?: WeakMap<object, number>
): Compile.Window => {
  // Use the same caller values for historical vocabulary, SQL and post-filters.
  options = captureOptions(options)
  return readSnapshot(store, () => executeCaptured(store, pattern, options, positions))
}

/**
 * Executes a captured pattern inside the caller's read snapshot. Exported
 * for the conjunctive executor (spec §12.4), which joins many premises in
 * one snapshot.
 */
export const executeCaptured = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options,
  positions?: WeakMap<object, number>
): Compile.Window => {
  const members = Compile.alternatives(pattern)
  if (members.length > 1 || members[0] !== pattern) {
    return executeAlternatives(store, members, options)
  }
  if (pattern.payload.kind !== 'attribute' || pattern.payload.value.kind !== 'term') {
    return Compile.window(storeAtBoundary(store, options), pattern, options, positions)
  }
  const value = Value.parse(pattern.payload.value.text)
  if (value.kind !== 'number' || value.num === undefined) {
    return Compile.window(storeAtBoundary(store, options), pattern, options, positions)
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
  const result = Compile.window(storeAtBoundary(store, options), normalized, options, positions)
  return { ...result, matches: result.matches.filter(match => {
    const row = match.row
    return row !== undefined &&
      row.value_num === expectedNum &&
      row.value_unit === expectedUnit &&
      row.value_approx === expectedApprox
  }) }
}

/**
 * One-hop alternation (spec §12.1): every member runs as its own ordinary
 * pattern over the same snapshot; the union is ordered by transaction like
 * a single pattern, a row two members both match appears once, and the
 * caller's window applies to the merged result.
 */
const executeAlternatives = (
  store: Store,
  members: readonly Pattern.t[],
  options: Compile.Options
): Compile.Window => {
  const { limit, offset, ...unbounded } = options
  validateWindow(limit, offset)
  const seen = new Set<string>()
  const merged = members
    .flatMap(member => executeCaptured(store, member, unbounded).matches)
    .filter(match => {
      if (match.row === undefined) return true
      if (seen.has(match.row.id)) return false
      seen.add(match.row.id)
      return true
    })
    .map((match, index) => ({ match, index }))
    .sort((a, b) => a.match.row!.tx < b.match.row!.tx ? -1 : a.match.row!.tx > b.match.row!.tx ? 1 : a.index - b.index)
    .map(entry => entry.match)
  // As in SQL compilation, an offset only applies together with a limit.
  const start = offset ?? 0
  const matches = limit === undefined ? merged : merged.slice(start, start + limit)
  return { matches, scanned: matches.length }
}

/** The SQL window contract, applied when a result is windowed after materialization. */
export const validateWindow = (limit: undefined | number, offset: undefined | number): void => {
  if (limit === undefined) return
  const start = offset === undefined ? 0 : offset
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(start) || start < 0) {
    throw new Error('CAVE-Q: limit must be a positive safe integer and offset must be a non-negative safe integer')
  }
}

export const window = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options = {},
  positions?: WeakMap<object, number>
): Compile.Window => execute(store, pattern, options, positions)

export const match = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options = {}
): Compile.Match[] => execute(store, capturePattern(pattern), options).matches
