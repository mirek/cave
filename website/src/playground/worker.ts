import { query, type Match } from '@cavelang/query'
import type { Store } from '@cavelang/store/adapter'
import { initializeSqlite } from './sqlite-shim.ts'
import { replaceDatabase } from './replace-database.ts'
import { describeWorkerError } from './errors.ts'
import { openPlaygroundDatabase } from './open-database.ts'
import type { OpenResult, PlaygroundRequest, PlaygroundResponse, QueryResult } from './protocol.ts'

let store: Store | undefined

// Keep invisible control characters distinguishable in the plain-text result.
const visibleBinding = (value: string): string =>
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
    ? JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/gu,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    : value

const formatMatch = (match: Match, index: number): string => {
  const bindings = Object.entries(match.bindings)
  if (bindings.length === 0) return `${index + 1}. matched${match.row ? ` · ${match.row.raw_line}` : ''}`
  return `${index + 1}. ${bindings.map(([name, value]) => `?${name} = ${visibleBinding(value)}`).join(' · ')}`
}

const open = async (source: string, sourceName: string): Promise<OpenResult> => {
  const adapter = await initializeSqlite()
  const replacement = openPlaygroundDatabase(adapter)
  const opened = replaceDatabase(store, replacement, () => {
    const result = replacement.ingest(source, { strict: true, source: sourceName })
    return { claims: result.ids.length, edges: result.edges, currentBeliefs: replacement.currentBeliefs().length }
  })
  store = replacement
  return opened
}

const append = (source: string): OpenResult => {
  if (store === undefined) throw new Error('Playground database is not ready')
  const result = store.ingest(source, { strict: true, source: 'playground/editor' })
  return { claims: result.ids.length, edges: result.edges, currentBeliefs: store.currentBeliefs().length }
}

const runQuery = (pattern: string, at?: string): QueryResult => {
  if (store === undefined) throw new Error('Playground database is not ready')
  const matches = query(store, pattern, at === undefined ? {} : { at })
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
          : runQuery(request.pattern, request.at)
      runtime.postMessage({ id: request.id, ok: true, result })
    } catch (error) {
      runtime.postMessage({
        id: request.id,
        ok: false,
        ...describeWorkerError(error),
      })
    }
  })
}
