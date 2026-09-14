/** AST query → deterministic, all-or-nothing connector refresh. */
import type { LineSpan } from '@cavelang/core'
import type { Store } from '@cavelang/store'
import { connect as connectRecords } from './run.ts'
import type { ConnectOptions, Report } from './run.ts'
import type { Mapping } from './template.ts'

/** A projected AST row and the physical source supporting it. */
export type Record = {
  readonly data: { readonly [key: string]: unknown }
  readonly source: string
  /** Cave spans are one-based and inclusive; convert adapter positions explicitly. */
  readonly span?: LineSpan
  /** Exact documentary text attached to the first mapped claim (e.g. JSDoc). */
  readonly comment?: string
}

/** Structural subset of @mirek/ast Query; no compiler dependency in Cave. */
export type Query = {
  iterate(options: { readonly signal?: AbortSignal }): AsyncIterable<Record>
}

export type Diagnostic = { readonly severity: string, readonly message: string }

export type Options = Omit<ConnectOptions, 'source' | 'spans' | 'origins' | 'comments'> & {
  readonly signal?: AbortSignal
  /** Maximum buffered records, default 100,000. Exceeding it rejects the whole pass. */
  readonly maxRecords?: number
  /** Read adapter diagnostics after iteration/cleanup; errors reject publication. */
  readonly diagnostics?: () => readonly Diagnostic[]
}

/**
 * Drain an AST projection before reserving the store for a synchronous commit.
 * Iterator, cleanup, diagnostics, mapping and cancellation failures publish no
 * claims or digests. With prune, the complete selection owns reconciliation.
 */
export const connect = async (store: Store, mapping: Mapping, query: Query, options: Options): Promise<Report> => {
  const { signal, maxRecords = 100_000, diagnostics, ...connectOptions } = options
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new TypeError('maxRecords must be a positive safe integer')
  // Detach before awaiting external code: mapping/option mutation cannot redirect publication.
  const capturedMapping = structuredClone(mapping)
  const capturedOptions = { ...connectOptions }
  const records: { [key: string]: unknown }[] = []
  const origins: { source: string, span?: LineSpan }[] = []
  const comments: (string | undefined)[] = []
  for await (const record of query.iterate({ signal })) {
    signal?.throwIfAborted()
    if (records.length >= maxRecords) throw new RangeError(`AST query exceeds maxRecords (${maxRecords})`)
    if (!record || typeof record !== 'object') throw new TypeError('AST query must yield projected records')
    const data = record.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('AST record data must be an object')
    records.push(structuredClone(data))
    origins.push(structuredClone({ source: record.source, span: record.span }))
    comments.push(record.comment)
  }
  signal?.throwIfAborted()
  const errors = diagnostics?.().filter(item => item.severity === 'error') ?? []
  if (errors.length) throw new Error(`AST extraction failed: ${errors.map(item => item.message).join('; ')}`)
  signal?.throwIfAborted()
  return store.transaction(() => {
    const report = connectRecords(store, capturedMapping, records, { ...capturedOptions, origins, comments })
    if (report.failures.length) throw new Error(`AST mapping failed: ${report.failures.flatMap(item => item.problems).join('; ')}`)
    signal?.throwIfAborted()
    return report
  })
}
