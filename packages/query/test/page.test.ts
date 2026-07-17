import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { standardRegistry } from '@cavelang/canonical'
import { defaultLimit, maxLimit, page, query } from '@cavelang/query'
import { compile } from '../src/compile.ts'
import * as Pattern from '../src/pattern.ts'

test('query pages are bounded, ordered, and frozen across concurrent appends', () => {
  const store = open()
  store.ingest(Array.from({ length: 5 }, (_, index) => `service/${index} USES jwt`).join('\n'))
  const first = page(store, '?service USES jwt', { limit: 2 })
  assert.equal(first.format, 'cave.query-page')
  assert.equal(first.version, 1)
  assert.deepEqual(first.matches.map(match => match.bindings['service']), ['service/0', 'service/1'])
  assert.ok(first.next)

  store.ingest('service/later USES jwt')
  const second = page(store, '?service USES jwt', { limit: 2, cursor: first.next })
  const third = page(store, '?service USES jwt', { limit: 2, cursor: second.next })
  assert.deepEqual(
    [...first.matches, ...second.matches, ...third.matches].map(match => match.bindings['service']),
    ['service/0', 'service/1', 'service/2', 'service/3', 'service/4']
  )
  assert.equal(third.next, undefined)
  assert.equal(second.snapshot, first.snapshot)
  assert.equal(query(store, '?service USES jwt').length, 6, 'ordinary library queries remain unbounded')
  store.close()
})

test('query cursors are scoped to the pattern, options, and page size', () => {
  const store = open()
  store.ingest('a USES jwt\nb USES jwt')
  const first = page(store, '?x USES jwt', { limit: 1 })
  assert.throws(() => page(store, '?x USES sessions', { limit: 1, cursor: first.next }), /does not match/)
  assert.throws(() => page(store, '?x USES jwt', { limit: 2, cursor: first.next }), /does not match/)
  assert.throws(() => page(store, '?x USES jwt', { limit: 1, cursor: 'not-a-cursor' }), /invalid pagination cursor/)
  for (const limit of [0, maxLimit + 1, 1.5]) {
    assert.throws(() => page(store, '?x USES jwt', { limit }), new RegExp(`1 to ${maxLimit}`))
  }
  assert.equal(defaultLimit, 100)
  store.close()
})

test('empty pages do not create a continuation that could admit later writes', () => {
  const store = open()
  const empty = page(store, '?x USES jwt', { limit: 1 })
  assert.equal(empty.snapshot, null)
  assert.deepEqual(empty.matches, [])
  assert.equal(empty.next, undefined)
  store.ingest('later USES jwt')
  assert.equal(page(store, '?x USES jwt', { limit: 1 }).matches.length, 1)
  store.close()
})

test('SQL windows carry the requested limit and offset into SQLite', () => {
  const compiled = compile(Pattern.parse('?x USES jwt'), standardRegistry, { limit: 7, offset: 14 })
  assert.match(compiled.sql, /ORDER BY c\.tx\nLIMIT \? OFFSET \?$/)
  assert.deepEqual(compiled.params.slice(-2), [7, 14])
})

test('valid-time pages advance over rejected SQL rows without skipping matches', () => {
  const store = open()
  store.ingest([
    'expired WORKS-AT acme @2020..2021',
    'alice WORKS-AT acme @2025..2027',
    'future WORKS-AT acme @2030..2031',
    'bob WORKS-AT acme @2024..2028'
  ].join('\n'))
  const first = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1 })
  assert.deepEqual(first.matches.map(match => match.bindings['person']), ['alice'])
  assert.ok(first.next)

  store.ingest('later WORKS-AT acme @2026..2029')
  const second = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1, cursor: first.next })
  assert.deepEqual(second.matches.map(match => match.bindings['person']), ['bob'])
  assert.equal(second.next, undefined)
  store.close()
})

test('exact numeric pages skip approximation mismatches without losing normalized equals', () => {
  const store = open()
  store.ingest([
    'estimate/a HAS users: ~900M users/wk',
    'estimate/b HAS users: 0.9B users/wk',
    'estimate/c HAS users: 900M users/wk'
  ].join('\n'))
  const first = page(store, '?estimate HAS users: 900M users/wk', { limit: 1 })
  assert.deepEqual(first.matches.map(match => match.bindings['estimate']), ['estimate/b'])
  const second = page(store, '?estimate HAS users: 900M users/wk', { limit: 1, cursor: first.next })
  assert.deepEqual(second.matches.map(match => match.bindings['estimate']), ['estimate/c'])
  assert.equal(second.next, undefined)
  store.close()
})

test('aliased transitive pages deduplicate physical endpoint spellings in SQL', () => {
  const store = open()
  store.ingest([
    'dog ALIAS doggo',
    'dog EXTENDS mammal',
    'doggo EXTENDS mammal',
    'mammal EXTENDS animal'
  ].join('\n'))
  const first = page(store, 'dog EXTENDS+ ?ancestor', { aliases: true, limit: 1 })
  const second = page(store, 'dog EXTENDS+ ?ancestor', {
    aliases: true, limit: 1, cursor: first.next
  })
  assert.deepEqual(
    [...first.matches, ...second.matches].map(match => match.bindings['ancestor']),
    ['animal', 'mammal']
  )
  assert.equal(second.next, undefined)
  store.close()
})

test('post-filter scans yield a continuation when their bounded budget finds no match', () => {
  const store = open()
  store.ingest([
    ...Array.from({ length: defaultLimit }, (_, index) =>
      `expired/${index} WORKS-AT acme @2020..2021`),
    'current WORKS-AT acme @2025..2027'
  ].join('\n'))
  const first = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1 })
  assert.deepEqual(first.matches, [])
  assert.ok(first.next)
  const second = page(store, '?person WORKS-AT acme', { at: '2026', limit: 1, cursor: first.next })
  assert.deepEqual(second.matches.map(match => match.bindings['person']), ['current'])
  assert.equal(second.next, undefined)
  store.close()
})
