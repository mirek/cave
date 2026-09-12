// Benchmark-only query-match baseline; preserve nested claim capture and read snapshots.
import { registerHooks } from 'node:module'
const target = new URL('../packages/query/src/record.ts', import.meta.url).href
const current = "export const of = (store: Store, match: Match): t => {\n  const supplied = { bindings: match.bindings, row: match.row, rows: match.rows, at: match.at }\n  requireBindingPrototype(supplied.bindings)\n  const { bindings, row, rows, at } = structuredClone(supplied)\n  validateMetadata(bindings, rows, at)\n  if (rows !== undefined) for (const evidence of rows) {\n    if (!object(evidence)) throw new Error(`CAVE query record: malformed ${format}/v${version} support`)\n  }\n  return {\n    format,\n    version,\n    bindings,\n    ...(row === undefined ? {} : { claim: store.recordOf(row) }),\n    ...(rows === undefined ? {} : { support: rows.map(store.recordOf) }),\n    ...(at === undefined ? {} : { at }),\n  }\n}\n"
const previous = "export const of = (store: Store, match: Match): t => ({\n  format,\n  version,\n  bindings: match.bindings,\n  ...(match.row === undefined ? {} : { claim: store.recordOf(match.row) }),\n  ...(match.rows === undefined ? {} : { support: match.rows.map(store.recordOf) }),\n  ...(match.at === undefined ? {} : { at: match.at }),\n})\n"
let loaded = false
process.on('exit', () => {
  if (!loaded) { process.stderr.write('Query match baseline was not loaded\n'); process.exitCode = 1 }
})
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (url !== target) return result
  const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source)
  if (source.split(current).length !== 2) throw new Error('Query match baseline source changed')
  loaded = true
  return { ...result, source: source.replace(current, previous) }
} })
