import type { Store } from '@cavelang/store'
import * as Compile from './compile.ts'
import type * as Pattern from './pattern.ts'

export type { Match, Options } from './compile.ts'

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

export const query = (
  store: Store,
  input: string,
  options: Compile.Options = {}
): Compile.Match[] =>
  Compile.query(storeAtBoundary(store, options), input, options)

export const match = (
  store: Store,
  pattern: Pattern.t,
  options: Compile.Options = {}
): Compile.Match[] =>
  Compile.match(storeAtBoundary(store, options), pattern, options)
