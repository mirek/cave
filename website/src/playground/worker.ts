import { query, type Match } from '@cavelang/query'
import { openWith, type Store } from '@cavelang/store/adapter'
import { initializeSqlite } from './sqlite-shim.ts'
import type { OpenResult, PlaygroundRequest, PlaygroundResponse, QueryResult } from './protocol.ts'

let store: Store | undefined

const formatMatch = (match: Match, index: number): string => {
  const bindings = Object.entries(match.bindings)
  if (bindings.length === 0) return `${index + 1}. matched${match.row ? ` · ${match.row.raw_line}` : ''}`
  return `${index + 1}. ${bindings.map(([name, value]) => `?${name} = ${value}`).join(' · ')}`
}

const open = async (source: string, sourceName: string): Promise<OpenResult> => {
  const adapter = await initializeSqlite()
  store?.close()
  store = openWith(adapter, ':memory:')
  const result = store.ingest(source, { strict: true, source: sourceName })
  return { claims: result.ids.length, edges: result.edges, currentBeliefs: store.currentBeliefs().length }
}

const append = (source: string): OpenResult => {
  if (store === undefined) throw new Error('Playground database is not ready')
  const result = store.ingest(source, { strict: true, source: 'playground/editor' })
  return { claims: result.ids.length, edges: result.edges, currentBeliefs: store.currentBeliefs().length }
}

const runQuery = (pattern: string): QueryResult => {
  if (store === undefined) throw new Error('Playground database is not ready')
  const matches = query(store, pattern)
  return {
    matches: matches.length,
    output: matches.length === 0 ? 'No matches.' : matches.map(formatMatch).join('\n'),
  }
}

const runtime = self as unknown as {
  onmessage: null | ((event: MessageEvent<PlaygroundRequest>) => void)
  postMessage: (response: PlaygroundResponse) => void
}

let operations = Promise.resolve()
runtime.onmessage = event => {
  const request = event.data
  operations = operations.then(async () => {
    try {
      const result = request.operation === 'open'
        ? await open(request.source, request.sourceName)
        : request.operation === 'append'
          ? append(request.source)
          : runQuery(request.pattern)
      runtime.postMessage({ id: request.id, ok: true, result })
    } catch (error) {
      runtime.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
