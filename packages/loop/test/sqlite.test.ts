import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { heuristicPolicy, memoryStoreOfText, reconstruct, sqliteStore } from '@cavelang/loop'
import { knowledge } from '../src/demo.ts'

test('sqliteStore reconstructs the same recovery as the in-memory store', () => {
  const db = open(':memory:')
  try {
    db.ingest(knowledge)
    const sql = reconstruct(sqliteStore(db), heuristicPolicy({ maxSteps: 12 }), ['reject-valid-tokens'])
    const memory = reconstruct(memoryStoreOfText(knowledge), heuristicPolicy({ maxSteps: 12 }), ['reject-valid-tokens'])
    assert.deepEqual(
      sql.claims.map(claim => claim.raw).sort(),
      memory.claims.map(claim => claim.raw).sort()
    )
    assert.deepEqual(
      sql.trace.map(step => step.cue.entity),
      memory.trace.map(step => step.cue.entity)
    )
  } finally {
    db.close()
  }
})

test('sqliteStore names inverse relations and skips retracted facts', () => {
  const db = open(':memory:')
  try {
    db.ingest([
      'monorepo CONTAINS packages/api',
      'legacy CONTAINS packages/api',
      'legacy CONTAINS packages/api @ 0%',
      'other DEPENDS-ON packages/api'
    ].join('\n'))
    const store = sqliteStore(db)
    const reverse = store.reverse('packages/api')
    assert.deepEqual(
      reverse.map(edge => `${edge.rel ?? `${edge.verb}?`} ${edge.to}`),
      ['PART-OF monorepo', 'DEPENDS-ON? other'],
      'inverse names come from the registry; retraction removes the edge'
    )
    assert.deepEqual(store.topicsOf('packages/api'), ['monorepo'])
    assert.deepEqual(store.expandTopic('monorepo'), ['packages/api'])
  } finally {
    db.close()
  }
})

test('sqliteStore claimsAbout returns current beliefs from either endpoint', () => {
  const db = open(':memory:')
  try {
    db.ingest([
      'auth USES jwt @ 60%',
      'auth USES jwt @ 90%',
      'jwt HAS ttl: 15min'
    ].join('\n'))
    const store = sqliteStore(db)
    const about = store.claimsAbout('jwt').map(claim => claim.raw)
    assert.deepEqual(about.sort(), ['auth USES jwt @ 90%', 'jwt HAS ttl: 15min'], 'superseded beliefs are gone')
  } finally {
    db.close()
  }
})
