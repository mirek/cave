/** Compare limited discovery with the same prefix of a dense unlimited run. */
import * as assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { open } from '@cavelang/store'
import { suggestAliases } from '../src/suggest.ts'

const size = 512
const limit = 20
const full = process.argv.includes('--full')
const store = open()
try {
  const names = Array.from({ length: size }, (_, bits) =>
    [...'abcdefghij'].map((letter, i) => i === 0 ? letter : `${bits & (1 << (i - 1)) ? '-' : '_'}${letter}`).join(''))
  store.ingest(names.map(name => `${name} EXISTS`).join('\n'))
  const started = performance.now()
  const suggestions = suggestAliases(store, full ? {} : { limit })
  const ms = Number((performance.now() - started).toFixed(3))
  assert.equal(suggestions.length, full ? size * (size - 1) / 2 : limit)
  const prefix = suggestions.slice(0, limit)
  assert.ok(prefix.every(suggestion => suggestion.score === 1))
  console.log(JSON.stringify({ size, mode: full ? 'full' : 'limited', ms,
    suggestions: suggestions.length, prefixSize: prefix.length,
    digest: createHash('sha256').update(JSON.stringify(prefix)).digest('hex') }))
} finally { store.close() }
