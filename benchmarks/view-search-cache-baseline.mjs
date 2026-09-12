// Benchmark-only loader: omit the five cached-projection checks without editing runtime files.
import { registerHooks } from 'node:module'
let transformations = 0
process.on('exit', () => {
  if (transformations !== 1) {
    process.stderr.write('Expected exactly one row-decoder baseline transformation\n')
    process.exitCode = 1
  }
})
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (url !== new URL('../packages/store/src/row.ts', import.meta.url).href) return result
  const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source)
  if (!source.includes("  const value = claim.payload.kind === 'attribute' || claim.payload.kind === 'metric'\n    ? claim.payload.value : undefined\n  const expected = {\n    value_num: value?.num ?? null,\n    value_unit: value?.unit ?? null,\n    value_approx: value?.approx === true ? 1 : 0,\n    delta_num: claim.delta?.num ?? null,\n    delta_unit: claim.delta?.unit ?? null\n  }\n  for (const field of Object.keys(expected) as (keyof typeof expected)[]) {\n    if (row[field] !== expected[field]) {\n      throw new TypeError(`stored claim ${field} does not agree with its authored value`)\n    }\n  }\n")) throw new Error('numeric-cache benchmark baseline source changed')
  transformations++
  return { ...result, source: source.replace("  const value = claim.payload.kind === 'attribute' || claim.payload.kind === 'metric'\n    ? claim.payload.value : undefined\n  const expected = {\n    value_num: value?.num ?? null,\n    value_unit: value?.unit ?? null,\n    value_approx: value?.approx === true ? 1 : 0,\n    delta_num: claim.delta?.num ?? null,\n    delta_unit: claim.delta?.unit ?? null\n  }\n  for (const field of Object.keys(expected) as (keyof typeof expected)[]) {\n    if (row[field] !== expected[field]) {\n      throw new TypeError(`stored claim ${field} does not agree with its authored value`)\n    }\n  }\n", '') }
} })
