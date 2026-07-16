import { Uuidv7, Verb } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import type { Adapter } from './adapter.ts'
import { open as openStore } from './store.ts'
import type { Store as BaseStore } from './store.ts'

export type Store = BaseStore & {
  /**
   * Verb registry reconstructed from the configured base registry plus
   * declaration rows visible at the transaction-time boundary.
   */
  readonly registryAsOf: (asOf: string) => Canonical.Registry.t
}

export type OpenOptions = {
  readonly registry?: Canonical.Registry.t
}

type Declaration = {
  readonly subject: string
  readonly verb: string
  readonly object: string
}

const upperTxBound = (text: string): string => {
  const hasTime = text.includes('T')
  const start = Date.parse(hasTime ? text : `${text}T00:00:00Z`)
  if (Number.isNaN(start)) {
    throw new Error(`CAVE: cannot parse as-of boundary ${JSON.stringify(text)}`)
  }
  const end = start + (hasTime ? 1_000 : 86_400_000)
  return Uuidv7.at(end, 0, new Uint8Array(8))
}

const declarationsAsOf = (store: BaseStore, asOf: string): Declaration[] => {
  const id = asOf.toLowerCase()
  const [condition, boundary] = Uuidv7.is(id) ?
    ['tx <= ?', id] as const :
    ['tx < ?', upperTxBound(asOf)] as const
  return store.db.prepare(`
    SELECT subject, verb, object FROM cave_claim
    WHERE ${condition}
      AND negated = 0 AND object IS NOT NULL AND verb IN ('REVERSE', 'RENAMED-TO', 'IS')
      AND id NOT IN (SELECT child_id FROM cave_edge WHERE role IN ('WHEN', 'VIA', 'BECAUSE'))
    ORDER BY tx
  `).all(boundary) as Declaration[]
}

const applyDeclarations = (
  baseRegistry: Canonical.Registry.t,
  declarations: readonly Declaration[]
): Canonical.Registry.t => {
  let registry = baseRegistry
  for (const declaration of declarations) {
    if (!Verb.isVerbToken(declaration.subject)) continue
    if (declaration.verb === 'REVERSE' && Verb.isVerbToken(declaration.object)) {
      registry = Canonical.Registry.declareReverse(
        registry,
        declaration.subject,
        declaration.object
      ).registry
    } else if (declaration.verb === 'RENAMED-TO' && Verb.isVerbToken(declaration.object)) {
      registry = Canonical.Registry.declareRename(
        registry,
        declaration.subject,
        declaration.object
      ).registry
    } else if (declaration.verb === 'IS' && declaration.object === 'verb') {
      registry = Canonical.Registry.declareVerb(registry, declaration.subject)
    }
  }
  return registry
}

/** Open a CAVE store with an explicitly selected SQLite implementation. */
export const openWith = (
  adapter: Adapter,
  path: string = ':memory:',
  options: OpenOptions = {}
): Store => {
  const baseRegistry = options.registry ?? Canonical.standardRegistry
  const store = openStore(adapter, path, options)
  return Object.assign(store, {
    registryAsOf: (asOf: string): Canonical.Registry.t =>
      applyDeclarations(baseRegistry, declarationsAsOf(store, asOf))
  })
}
