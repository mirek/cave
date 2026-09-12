/** Deterministic alias-discovery workload with unrelated names sharing a block. */
import * as assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { open } from '@cavelang/store'
import { suggestAliases } from '../src/suggest.ts'

const evidence = [
  'maria EXISTS', 'grandma-maria EXISTS', 'grandma-mria EXISTS',
  'Long_Street EXISTS', 'long-street EXISTS', 'api-v1 EXISTS', 'api-v2 EXISTS',
  'alpha HAS email: shared@example.org', 'omega HAS email: shared@example.org'
]
const reference = open()
const expected = (() => {
  try {
    reference.ingest(evidence.join('\n'))
    return suggestAliases(reference)
  } finally { reference.close() }
})()
assert.ok(expected.length > 0)
const sizes = process.argv.includes('--large') ? [1000, 2000, 4000] : [250, 500, 1000]
for (const size of sizes) {
  const store = open()
  try {
    const noise = Array.from({ length: size }, (_, i) =>
      `entity-${createHash('sha256').update(String(i)).digest('hex').slice(0, 10)} EXISTS`)
    store.ingest([...evidence, ...noise].join('\n'))
    const started = performance.now()
    const suggestions = suggestAliases(store)
    const ms = Number((performance.now() - started).toFixed(3))
    assert.deepEqual(suggestions, expected, 'unrelated names must not alter evidence or ranking')
    console.log(JSON.stringify({ size, ms, suggestions: suggestions.length,
      digest: createHash('sha256').update(JSON.stringify(suggestions)).digest('hex') }))
  } finally { store.close() }
}
