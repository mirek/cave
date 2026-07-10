/**
 * `@cavelang/view` — the human read surface (spec §30, §31): `cave serve`
 * puts one static, self-contained HTML page over a store, backed by
 * read-only JSON endpoints — entity 360, topic browse, belief-history
 * timelines, `BECAUSE`/`VIA` lineage trees and the §20 coverage/frontier
 * dashboard, with full-text search over everything — and `cave report`
 * renders templated markdown from CAVE-Q results, claim keys as
 * citations (§31).
 *
 * ```ts
 * import { serve, report } from '@cavelang/view'
 *
 * const handle = await serve(store, { label: 'k.db' })
 * // browse http://127.0.0.1:2283/ — every request reads the live store
 * await handle.close()
 *
 * report(store, template).markdown // the cited deliverable
 * ```
 *
 * Everything here is a read: no endpoint writes, non-GET methods are
 * refused, and the page's CSP denies every non-self source (§30.3).
 * The view models in `api.ts` and the report renderer are plain
 * functions over a store, usable without the server.
 */

export {
  entity, history, lineage, overview, search, topic, topics
} from './api.ts'
export type {
  Capped, ClaimView, Entity, History, Lineage, LineageNode, Options, Overview, Topic, TopicPage
} from './api.ts'
export { report } from './report.ts'
export type { Problem, Report, ReportOptions } from './report.ts'
export { page } from './page.ts'
export { defaultHost, defaultPort, serve } from './server.ts'
export type { Handle, ServeOptions } from './server.ts'
export { runServe } from './main.ts'
