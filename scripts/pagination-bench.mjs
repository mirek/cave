#!/usr/bin/env node
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { page } from '../packages/query/src/index.ts'

const measurements = []
const traverse = (store, kind, rows, input, options, expected) => {
  const samplesMs = []
  let pages
  for (let iteration = 0; iteration < 3; iteration++) {
    const results = []
    let cursor
    const start = performance.now()
    // A finite guard makes a broken continuation fail instead of hanging.
    for (let index = 0; index <= rows; index++) {
      const result = page(store, input, { ...options, cursor })
      results.push(result)
      cursor = result.next
      if (cursor === undefined) break
    }
    samplesMs.push(performance.now() - start)
    assert.equal(cursor, undefined, `${kind}: continuation did not terminate`)
    assert.deepEqual(results.flatMap(result => result.matches.map(match => match.bindings.person)), expected)
    assert.ok(results.every(result => result.snapshot === results[0].snapshot))
    assert.equal(results.length, Math.ceil(expected.length / options.limit))
    pages = results.length
  }
  measurements.push({ kind: `${kind}-traversal`, rows, limit: options.limit, pages,
    matches: expected.length, medianMs: [...samplesMs].sort((a, b) => a - b)[1], samplesMs })
}
for (const count of [1_000, 10_000]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: count }, (_, i) => `person/${i} HAS score: 42 @2025..2027`).join('\n'))
    for (const [kind, input, options] of [
      ['valid-time', '?person HAS score: ?score', { at: '2026' }],
      ['exact-number', '?person HAS score: 42', {}]
    ]) {
      const samplesMs = []
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        const result = page(store, input, { ...options, limit: 100 })
        samplesMs.push(performance.now() - start)
        assert.equal(result.matches.length, 100)
        assert.ok(result.next)
        assert.deepEqual(result.matches.map(match => match.bindings.person),
          Array.from({ length: 100 }, (_, i) => `person/${i}`))
      }
      measurements.push({ kind, rows: count, limit: 100,
        medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
      traverse(store, kind, count, input, { ...options, limit: 100 },
        Array.from({ length: count }, (_, i) => `person/${i}`))
    }
  } finally { store.close() }
}
// A one-result page must reject 99 candidates before reaching its match.
for (const count of [1_000, 10_000]) {
  const store = open()
  try {
    store.ingest(Array.from({ length: count }, (_, i) =>
      `person/${i} HAS score: 42 @${i % 100 === 99 ? '2025..2027' : '2020..2021'}`).join('\n'))
    const samplesMs = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      const result = page(store, '?person HAS score: ?score', { at: '2026', limit: 1 })
      samplesMs.push(performance.now() - start)
      assert.deepEqual(result.matches.map(match => match.bindings.person), ['person/99'])
      assert.ok(result.next)
    }
    measurements.push({ kind: 'selective-valid-time', rows: count, limit: 1,
      medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
    traverse(store, 'selective-valid-time', count, '?person HAS score: ?score', { at: '2026', limit: 1 },
      Array.from({ length: count / 100 }, (_, i) => `person/${i * 100 + 99}`))
  } finally { store.close() }
}
console.log(JSON.stringify({ format: 'cave.pagination-benchmark', version: 1,
  runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch },
  measurements }))
