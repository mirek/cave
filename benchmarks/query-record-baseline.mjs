// Benchmark-only loader: restore the prior record/projection path without editing runtime files.
import { registerHooks } from 'node:module'
const replacements = new Map([
  [new URL('../packages/store/src/record.ts', import.meta.url).href, [
    ['  requireTransactionIdentity(id, tx)\n', ''],
    ["  if (Key.of(claim) !== key) {\n    throw new Error(`CAVE record: malformed ${format}/v${version} semantic identity`)\n  }\n", ''],
  ]],
  [new URL('../packages/query/src/record.ts', import.meta.url).href, [
    ['readSnapshot(store, () => query(store, input, options).map(match => of(store, match)))',
      'query(store, input, options).map(match => of(store, match))'],
  ]],
])
const changed = new Set()
process.on('exit', () => {
  if (changed.size !== replacements.size) {
    process.stderr.write('Expected both query-record baseline transformations\n')
    process.exitCode = 1
  }
})
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (!replacements.has(url)) return result
  let source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source)
  for (const [before, after] of replacements.get(url)) {
    if (!source.includes(before)) throw new Error('query-record baseline source changed')
    source = source.replace(before, after)
  }
  changed.add(url)
  return { ...result, source }
} })
