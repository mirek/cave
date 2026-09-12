import type { Store } from '@cavelang/store'
import type * as Template from './template.ts'
import { connect } from './run.ts'
import type { ConnectOptions, Report } from './run.ts'

const rollback = Symbol('cave-connect query rollback')

/** Internal projection boundary: capture results before the temporary source is rolled back. */
export const withFederatedSource = <T>(
  store: Store,
  mapping: Template.Mapping,
  records: readonly Record<string, unknown>[],
  options: ConnectOptions,
  project: () => T
): { readonly result: T, readonly report: Report } => {
  let outcome: undefined | { readonly result: T, readonly report: Report }
  try {
    store.transaction(() => {
      const report = connect(store, mapping, records, { ...options, force: true, prune: false })
      outcome = { result: project(), report }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  return outcome!
}
