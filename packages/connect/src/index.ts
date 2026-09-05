/**
 * `@cavelang/connect` — deterministic structured ingestion (spec §23).
 *
 * ```sh
 * cave connect people.csv --map people.map.cave --db k.db --key id
 * ```
 *
 * Library API:
 *
 * ```ts
 * import { Source, Template, connect } from '@cavelang/connect'
 * import { open } from '@cavelang/store'
 *
 * const store = open('k.db')
 * const { mapping } = Template.parse(mappingText)
 * const { records } = await Source.load('people.csv')
 * const report = connect(store, mapping!, records, { name: 'people', key: 'id' })
 * ```
 */

export * as Source from './source.ts'
export * as Template from './template.ts'
export * as Declared from './declared.ts'
export { assemble } from './declared.ts'
export { adHocNaming, connect, declaredNaming, digestAttribute, digestOf, federatedQuery, hasDigest, isConnected, provenanceContext, retireRun } from './run.ts'
export type { ConnectOptions, Failure, FederatedOutcome, Naming, Report } from './run.ts'
export { runConnect } from './main.ts'
export type { RunContext as ConnectRunContext, ScheduleLike, WatchLike } from './main.ts'
