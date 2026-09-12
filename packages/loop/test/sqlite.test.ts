import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { heuristicPolicy, memoryStoreOfText, reconstruct, reconstructAsync, sqliteStore } from '@cavelang/loop'
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

test('revised equal-score edges retain the same traversal order in both adapters', () => {
  const text = 'a CAUSE b @ 50%\na CAUSE c\nb HAS value: 1\nc HAS value: 2\na CAUSE b'
  const db = open()
  try {
    db.ingest(text)
    const sql = reconstruct(sqliteStore(db), heuristicPolicy({ maxSteps: 2 }), ['a'])
    const memory = reconstruct(memoryStoreOfText(text), heuristicPolicy({ maxSteps: 2 }), ['a'])
    assert.deepEqual(sql.trace.map(step => step.cue.entity), ['a', 'c'])
    assert.deepEqual(memory.trace.map(step => step.cue.entity), sql.trace.map(step => step.cue.entity))
    assert.deepEqual(memory.claims.map(claim => claim.raw).sort(), sql.claims.map(claim => claim.raw).sort())
  } finally { db.close() }
})

test('both adapters collect mixed-direction evidence in transaction order', () => {
  const text = 'parent CAUSE focus\nfocus HAS value: 1\nother USES focus\nfocus USES focus\nfocus HAS value: 2'
  const db = open()
  try {
    db.ingest(text)
    const sql = sqliteStore(db)
    const memory = memoryStoreOfText(text)
    const expected = sql.claimsAbout('focus').map(claim => claim.raw)
    assert.deepEqual(expected, ['parent CAUSE focus', 'other USES focus', 'focus USES focus', 'focus HAS value: 2'])
    assert.deepEqual(memory.claimsAbout('focus').map(claim => claim.raw), expected)
    const returned = memory.claimsAbout('focus')
    returned.pop()
    assert.deepEqual(memory.claimsAbout('focus').map(claim => claim.raw), expected)
  } finally { db.close() }
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

test('sqliteStore claim collection reads only the requested entity history', t => {
  const db = open()
  try {
    db.ingest(Array.from({ length: 1000 }, (_, index) => `unrelated-${index} IS noise`).join('\n'))
    db.ingest(Array.from({ length: 1000 }, (_, index) => `jwt HAS ttl: ${index}min`).join('\n'))
    db.ingest('auth USES jwt @ 60%\nauth USES jwt @ 90%\njwt HAS ttl: 15min\njwt USES jwt\njwt HAS ttl: 20min @ 0%')
    const expected = db.currentBeliefs().filter(row => row.subject === 'jwt' || row.object === 'jwt').map(row => db.toClaim(row))
    let rowsRead = 0
    const prepare = db.db.prepare.bind(db.db)
    t.mock.method(db.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      const all = statement.all.bind(statement)
      t.mock.method(statement, 'all', (...args: Parameters<typeof all>) => {
        const rows = all(...args)
        rowsRead += rows.length
        return rows
      })
      return statement
    })
    const adapter = sqliteStore(db)
    assert.throws(() => adapter.claimsAbout('\ud800'), /unpaired UTF-16 surrogate/)
    assert.deepEqual(adapter.claimsAbout('jwt'), expected)
    assert.ok(rowsRead < 20, `entity lookup returned ${rowsRead} rows to JavaScript`)
    db.ingest('jwt HAS ttl: 30min')
    assert.ok(adapter.claimsAbout('jwt').some(claim => claim.raw === 'jwt HAS ttl: 30min'))
  } finally { db.close() }
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


test('async SQLite reconstruction observes peer commits between awaited expansions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-loop-live-'))
  const path = join(dir, 'knowledge.db'), writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('a USES b\nb USES c\nc IS original')
  const reader = open(path, { access: 'read-only' })
  try {
    const policy = heuristicPolicy({ maxSteps: 8 })
    let updated = false
    const result = await reconstructAsync(sqliteStore(reader), {
      done: async state => {
        if (state.steps === 1 && !updated) {
          await Promise.resolve()
          writer.ingest('b USES c @ 0%\nb USES d\nd IS replacement')
          updated = true
        }
        return policy.done(state)
      },
      select: async state => policy.select(state),
      score: async (edge, cue) => policy.score(edge, cue)
    }, ['a'])
    assert.equal(updated, true)
    const claims = result.claims.map(claim => claim.raw)
    assert.ok(claims.includes('a USES b'))
    assert.ok(claims.includes('b USES d'))
    assert.ok(claims.includes('d IS replacement'))
    assert.ok(!claims.includes('c IS original'))
    assert.ok(result.trace.some(step => step.cue.entity === 'd'))
    assert.ok(!result.trace.some(step => step.cue.entity === 'c'))
    assert.deepEqual(reader.currentBeliefs(), writer.currentBeliefs())
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})
