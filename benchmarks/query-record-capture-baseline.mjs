// Benchmark-only pre-capture boundary; leave identity checks and query snapshots enabled.
import { registerHooks } from 'node:module'
const target = new URL('../packages/store/src/record.ts', import.meta.url).href
const replacements = [
  ['  const capturedClaim = structuredClone(claim)\n', '  const capturedClaim = claim\n'],
  ['  const capturedProvenance = structuredClone(provenance)\n  if (parseProvenance(capturedProvenance) === undefined) {\n    throw new Error(`CAVE record: malformed ${format}/v${version} provenance`)\n  }\n',
    '  const capturedProvenance = provenance\n'],
]
let changed = false
process.on('exit', () => {
  if (!changed) {
    process.stderr.write('Expected record capture baseline transformation\n')
    process.exitCode = 1
  }
})
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (url !== target) return result
  let source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source)
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('record capture baseline source changed')
    source = source.replace(before, after)
  }
  changed = true
  return { ...result, source }
} })
