import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cave/store'
import { query } from '@cave/query'

const fixture = (): Store => {
  const store = open()
  store.ingest([
    'auth/middleware USES jwt',
    'api/gateway USES jwt @production',
    'legacy/app USES sessions',
    'auth/middleware HAS bug: token-expiry #security',
    'billing HAS bug: rounding #billing',
    'memory-leak CAUSE app/crash @ 50%',
    'deadlock CAUSE app/crash @ 30%',
    'oom-killer CAUSE app/crash @ 20%',
    'terrier EXTENDS dog',
    'dog EXTENDS mammal',
    'mammal EXTENDS animal',
    'monorepo CONTAINS packages/api',
    'ChatGPT HAS weekly-users: 900M users/wk',
    'blog HAS weekly-users: 5K users/wk'
  ].join('\n'))
  return store
}

test('?x USES jwt — all systems using jwt (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, '?x USES jwt')
  assert.deepEqual(matches.map(match => match.bindings['x']), ['auth/middleware', 'api/gateway'])
  assert.equal(matches[0]!.row?.verb, 'USES')
  store.close()
})

test('?x HAS bug: ?bug #security — scoped to tagged claims (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, '?x HAS bug: ?bug #security')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'auth/middleware', bug: 'token-expiry' })
  store.close()
})

test('confidence filter (spec §12.1: WHERE conf >= 0.7 → none; >= 0.3 → two)', () => {
  const store = fixture()
  assert.equal(query(store, '?cause CAUSE app/crash\n  WHERE conf >= 0.7').length, 0)
  const likely = query(store, '?cause CAUSE app/crash\n  WHERE conf >= 0.3')
  assert.deepEqual(likely.map(match => match.bindings['cause']), ['memory-leak', 'deadlock'])
  store.close()
})

test('?x ?verb ?y @production — all production facts (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, '?x ?verb ?y @production')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'api/gateway', verb: 'USES', y: 'jwt' })
  store.close()
})

test('transitive EXTENDS+ (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, 'terrier EXTENDS+ animal')
  assert.equal(matches.length, 1)
  const up = query(store, 'terrier EXTENDS+ ?ancestor')
  assert.deepEqual(
    up.map(match => match.bindings['ancestor']).sort(),
    ['animal', 'dog', 'mammal']
  )
  store.close()
})

test('inverse verbs compile to the same physical query (spec §12.1)', () => {
  const store = fixture()
  const inverse = query(store, '?x PART-OF monorepo')
  const forward = query(store, 'monorepo CONTAINS ?x')
  assert.deepEqual(inverse.map(match => match.bindings), forward.map(match => match.bindings))
  assert.deepEqual(inverse[0]!.bindings, { x: 'packages/api' })
  assert.equal(inverse[0]!.row?.verb, 'CONTAINS')
  store.close()
})

test('transitive inverse: ?x PART-OF+ walks CONTAINS downward', () => {
  const store = open()
  store.ingest('org CONTAINS monorepo\nmonorepo CONTAINS packages/api')
  const matches = query(store, 'packages/api PART-OF+ ?container')
  assert.deepEqual(
    matches.map(match => match.bindings['container']).sort(),
    ['monorepo', 'org']
  )
  store.close()
})

test('value filter (spec §12.2: WHERE value > …)', () => {
  const store = fixture()
  const big = query(store, '?x HAS weekly-users: ?n\n  WHERE value > 100000000')
  assert.equal(big.length, 1)
  assert.deepEqual(big[0]!.bindings, { x: 'ChatGPT', n: '900M users/wk' })
  store.close()
})

test('queries run over current beliefs by default (spec §9.1)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60%')
  store.ingest('server IS compromised @ 0% ; retracted')
  const current = query(store, 'server IS compromised')
  assert.equal(current.length, 1)
  assert.equal(current[0]!.row?.conf, 0)
  assert.equal(query(store, 'server IS compromised', { all: true }).length, 2)
  store.close()
})

test('NOT patterns match negated rows only (spec §5.6)', () => {
  const store = open()
  store.ingest('server IS NOT compromised @ 90% @src:forensics')
  assert.equal(query(store, 'server IS compromised').length, 0)
  const negated = query(store, 'server IS NOT compromised')
  assert.equal(negated.length, 1)
  store.close()
})

test('tx date filter (spec §12.2)', () => {
  const store = fixture()
  assert.equal(query(store, '?x USES jwt\n  WHERE tx > 2020-01-01').length, 2)
  assert.equal(query(store, '?x USES jwt\n  WHERE tx < 2020-01-01').length, 0)
  store.close()
})

test('repeated variable forces equality', () => {
  const store = open()
  store.ingest('a NEEDS a\nb NEEDS c')
  const matches = query(store, '?x NEEDS ?x')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'a' })
  store.close()
})

test('code literal terms in patterns', () => {
  const store = open()
  store.ingest('`<=` FIX token-expiry')
  const matches = query(store, '?fix FIX token-expiry')
  assert.deepEqual(matches[0]!.bindings, { fix: '`<=`' })
  store.close()
})

test('transitive patterns reject filters', () => {
  const store = fixture()
  assert.throws(() => query(store, 'terrier EXTENDS+ ?x\n  WHERE conf >= 0.5'), /transitive/)
  store.close()
})
