import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { query } from '@cavelang/query'
import { open, QuerySql } from '@cavelang/store'

const ids = (rows: readonly { id: string }[]): string[] =>
  rows.map(row => row.id).sort()

test('shared current-belief SQL agrees with store and CAVE-Q retraction semantics', () => {
  const store = open()
  try {
    store.ingest('api USES jwt')
    store.ingest('api USES jwt @ 0%')
    store.ingest('worker USES queue')

    const direct = store.db.prepare(`SELECT * FROM (${QuerySql.current()}) ORDER BY tx`).all() as { id: string }[]
    assert.deepEqual(ids(direct), ids(store.currentBeliefs()))
    assert.deepEqual(store.forward('api'), [])
    assert.deepEqual(query(store, 'api USES ?dependency'), [])
    assert.deepEqual(
      query(store, 'worker USES ?dependency').map(match => match.bindings['dependency']),
      ['queue']
    )
  } finally {
    store.close()
  }
})

test('shared alias closure agrees with store traversal and CAVE-Q matching', () => {
  const store = open()
  try {
    store.ingest('service ALIAS api\napi USES jwt')
    const closure = store.db.prepare(
      `${QuerySql.aliasClosure()} SELECT name FROM alias_closure ORDER BY name`
    ).all('service') as { name: string }[]

    assert.deepEqual(closure.map(row => row.name).sort(), [...store.aliasesOf('service')].sort())
    assert.deepEqual(ids(store.forward('service', { aliases: true })
      .filter(fact => fact.verb === 'USES').map(fact => fact.row)),
      ids(query(store, 'service USES ?dependency', { aliases: true }).flatMap(match => match.row ?? [])))
  } finally {
    store.close()
  }
})

test('shared as-of reconstruction agrees with CAVE-Q at an exact transaction', () => {
  const store = open()
  try {
    const first = store.ingest('api USES jwt').ids[0]!
    store.ingest('api USES jwt @ 0%')
    const boundary = QuerySql.asOfBoundary(first)!
    const direct = store.db.prepare(
      `SELECT * FROM (${QuerySql.current(QuerySql.claims(boundary))})`
    ).all() as { id: string }[]
    const matched = query(store, 'api USES jwt', { asOf: first }).flatMap(match => match.row ?? [])

    assert.deepEqual(ids(direct), [first])
    assert.deepEqual(ids(matched), [first])
  } finally {
    store.close()
  }
})
