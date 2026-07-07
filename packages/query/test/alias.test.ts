import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { query } from '@cavelang/query'

const fixture = (): Store => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'pg ALIAS postgres',
    'billing USES postgres',
    'analytics USES postgresql',
    'search USES elastic',
    'postgresql HAS license: permissive'
  ].join('\n'))
  return store
}

test('term slots resolve through the alias closure only when opted in (spec §13.6)', () => {
  const store = fixture()
  assert.deepEqual(query(store, '?x USES postgres').map(match => match.bindings['x']), ['billing'])
  assert.deepEqual(
    query(store, '?x USES postgres', { aliases: true }).map(match => match.bindings['x']).sort(),
    ['analytics', 'billing']
  )
  const chained = query(store, '?x USES pg', { aliases: true })
  assert.deepEqual(chained.map(match => match.bindings['x']).sort(), ['analytics', 'billing'],
    'closure is transitive across chained ALIAS claims')
  store.close()
})

test('bindings and rows keep stored names untouched (spec §13.6, open decision 2)', () => {
  const store = fixture()
  const matches = query(store, 'pg HAS license: ?l', { aliases: true })
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { l: 'permissive' })
  assert.equal(matches[0]!.row?.subject, 'postgresql', 'union-of-rows, never rewritten')
  store.close()
})

test('subject terms resolve too, and inverse verbs compose with aliases (spec §12.1, §13.6)', () => {
  const store = fixture()
  assert.equal(query(store, 'pg USED-BY ?x').length, 0)
  assert.deepEqual(
    query(store, 'pg USED-BY ?x', { aliases: true }).map(match => match.bindings['x']).sort(),
    ['analytics', 'billing']
  )
  store.close()
})

test('unmerge by retraction drops the widened matches (spec §13.6)', () => {
  const store = fixture()
  store.ingest('postgres ALIAS postgresql @ 0% ; merged in error')
  assert.deepEqual(
    query(store, '?x USES postgres', { aliases: true }).map(match => match.bindings['x']),
    ['billing']
  )
  store.close()
})

test('transitive patterns hop through aliases (spec §12.1, §13.6)', () => {
  const store = open()
  store.ingest([
    'terrier EXTENDS dog',
    'hound ALIAS dog',
    'hound EXTENDS mammal'
  ].join('\n'))
  assert.equal(query(store, 'terrier EXTENDS+ mammal').length, 0)
  const matches = query(store, 'terrier EXTENDS+ ?ancestor', { aliases: true })
  assert.deepEqual(matches.map(match => match.bindings['ancestor']).sort(), ['dog', 'mammal'])
  assert.equal(query(store, 'terrier EXTENDS+ mammal', { aliases: true }).length, 1)
  store.close()
})

test('transitive endpoint terms resolve through the closure, matches dedupe (spec §13.6)', () => {
  const store = open()
  store.ingest([
    'beast ALIAS animal',
    'dog EXTENDS animal',
    'dog EXTENDS beast'
  ].join('\n'))
  const matches = query(store, '?x EXTENDS+ animal', { aliases: true })
  assert.deepEqual(matches.map(match => match.bindings['x']), ['dog'],
    'one answer even though two stored spellings match')
  store.close()
})

test('repeated variables compare alias-equal across entity slots (spec §13.6)', () => {
  const store = open()
  store.ingest('svc ALIAS service\nsvc NEEDS service')
  assert.equal(query(store, '?x NEEDS ?x').length, 0)
  const matches = query(store, '?x NEEDS ?x', { aliases: true })
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'svc' })
  store.close()
})

test('values are not entities: alias closure never touches attribute values (spec §13.6)', () => {
  const store = open()
  store.ingest('fast ALIAS quick\nbuild HAS speed: fast')
  assert.equal(query(store, 'build HAS speed: quick', { aliases: true }).length, 0)
  assert.equal(query(store, 'build HAS speed: fast', { aliases: true }).length, 1)
  store.close()
})

test('closure reads current beliefs even over the full history (spec §13.6)', () => {
  const store = fixture()
  store.ingest('postgres ALIAS postgresql @ 0%')
  const all = query(store, '?x USES postgres', { aliases: true, all: true })
  assert.deepEqual(all.map(match => match.bindings['x']), ['billing'],
    'a retracted merge does not resolve, not even under all')
  store.close()
})
