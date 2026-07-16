import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { standardRegistry } from '@cavelang/canonical'
import * as Pattern from '../src/pattern.ts'
import { compile, query } from '../src/compile.ts'

const compiled = (input: string, support = false) =>
  compile(Pattern.parse(input), standardRegistry, { support })

test('transitive plans seed forward, reverse, and support recursion from concrete endpoints', () => {
  const forward = compiled('root REACHES+ ?destination')
  assert.match(forward.sql, /SELECT src, dst FROM cur WHERE src = \?/)
  assert.match(forward.sql, /JOIN cur ON cur\.src = h\.dst/)

  const reverse = compiled('?source REACHES+ leaf')
  assert.match(reverse.sql, /SELECT src, dst FROM cur WHERE dst = \?/)
  assert.match(reverse.sql, /JOIN cur ON cur\.dst = h\.src/)

  const both = compiled('root REACHES+ leaf', true)
  assert.match(both.sql, /SELECT src, dst FROM cur WHERE src = \?/)
  assert.match(both.sql, /support\(src, dst, edge_id\)/)

  const unbound = compiled('?source REACHES+ ?destination')
  assert.match(unbound.sql, /SELECT src, dst FROM cur\n  UNION/)
  assert.doesNotMatch(unbound.sql, /FROM cur WHERE (?:src|dst) = \?/)
})

test('SQLite plans reverse seeds through the object index', () => {
  const store = open()
  store.ingest('root REACHES branch\nbranch REACHES leaf\nunrelated REACHES elsewhere')
  const reverse = compiled('?source REACHES+ leaf')
  const details = store.db.prepare(`EXPLAIN QUERY PLAN ${reverse.sql}`)
    .all(...reverse.params).map(row => String(row['detail']))
  assert.ok(details.some(detail => detail.includes('idx_cave_object')), details.join('\n'))
  store.close()
})

test('seeded traversal preserves chain, branch, cycle, and unbound semantics', () => {
  const store = open()
  store.ingest([
    'root REACHES left',
    'root REACHES right',
    'left REACHES leaf',
    'cycle/a REACHES cycle/b',
    'cycle/b REACHES cycle/a',
    'other REACHES isolated'
  ].join('\n'))
  assert.deepEqual(
    query(store, 'root REACHES+ ?destination').map(match => match.bindings['destination']),
    ['leaf', 'left', 'right']
  )
  assert.deepEqual(
    query(store, '?source REACHES+ leaf').map(match => match.bindings['source']),
    ['left', 'root']
  )
  assert.deepEqual(
    query(store, '?node REACHES+ ?node').map(match => match.bindings['node']),
    ['cycle/a', 'cycle/b']
  )
  assert.ok(query(store, '?source REACHES+ ?destination').some(match =>
    match.bindings['source'] === 'other' && match.bindings['destination'] === 'isolated'))
  store.close()
})
