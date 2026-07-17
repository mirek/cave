import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { query } from '@cavelang/query'

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

test('transitive closure crosses the former 32-hop boundary without truncation', () => {
  const store = open()
  const hops = 80
  const node = (index: number): string => `chain/${index.toString().padStart(3, '0')}`
  store.ingest(Array.from({ length: hops }, (_, index) =>
    `${node(index)} REACHES ${node(index + 1)}`).join('\n'))

  assert.equal(query(store, `${node(0)} REACHES+ ${node(32)}`).length, 1, '32 hops')
  assert.equal(query(store, `${node(0)} REACHES+ ${node(33)}`).length, 1, '33 hops')
  assert.equal(query(store, `${node(0)} REACHES+ ${node(hops)}`).length, 1, 'long chain')
  assert.deepEqual(
    query(store, `${node(0)} REACHES+ ?destination`).map(match => match.bindings['destination']),
    Array.from({ length: hops }, (_, index) => node(index + 1)),
    'a partly bound traversal returns the complete ordered chain'
  )

  const supported = query(store, `${node(0)} REACHES+ ${node(hops)}`, { support: true })
  assert.equal(supported.length, 1)
  assert.equal(supported[0]!.rows?.length, hops, 'every edge on the long path remains visible as support')
  store.close()
})

test('transitive matches carry their supporting edge rows under support (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, 'terrier EXTENDS+ animal', { support: true })
  assert.equal(matches.length, 1)
  assert.equal(matches[0]!.row, undefined, 'still no single matched row')
  assert.deepEqual(
    matches[0]!.rows!.map(row => `${row.subject}->${row.object}`).sort(),
    ['dog->mammal', 'mammal->animal', 'terrier->dog']
  )

  // Edges off the path are not support: terrier->dog reaches, but never
  // supports, dog's own ancestry.
  const up = query(store, 'dog EXTENDS+ ?ancestor', { support: true })
  const mammal = up.find(match => match.bindings['ancestor'] === 'mammal')!
  assert.deepEqual(mammal.rows!.map(row => `${row.subject}->${row.object}`), ['dog->mammal'])

  assert.equal(query(store, 'terrier EXTENDS+ animal')[0]!.rows, undefined, 'off by default')
  store.close()
})

test('support composes with aliases: edges across alias links support the connection', () => {
  const store = open()
  store.ingest('terrier EXTENDS doggo\ndog EXTENDS animal\ndoggo ALIAS dog')
  const matches = query(store, 'terrier EXTENDS+ animal', { aliases: true, support: true })
  assert.equal(matches.length, 1)
  assert.deepEqual(
    matches[0]!.rows!.map(row => `${row.subject}->${row.object}`).sort(),
    ['dog->animal', 'terrier->doggo']
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

test('deprecated and preferred verb spellings query one history (spec §5.8)', () => {
  const store = open()
  const old = store.ingest('alice WORKS-AT acme @ 60%')
  const renamed = store.ingest('WORKS-AT RENAMED-TO EMPLOYED-BY')
  store.ingest('alice EMPLOYED-BY acme @ 90%')
  assert.equal(query(store, 'alice WORKS-AT acme').length, 1)
  assert.equal(query(store, 'alice EMPLOYED-BY acme').length, 1)
  assert.equal(query(store, 'alice EMPLOYED-BY acme')[0]!.row?.conf, 0.9)
  assert.equal(query(store, 'alice EMPLOYED-BY acme', { all: true }).length, 2)
  assert.equal(query(store, 'alice EMPLOYED-BY acme', { asOf: old.ids[0]! }).length, 0)
  assert.equal(query(store, 'alice EMPLOYED-BY acme', { asOf: renamed.ids[0]! }).length, 1)
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

test('queries run over supported current beliefs by default (spec §9.1, §9.3)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60%')
  store.ingest('server IS compromised @ 0% ; retracted')
  assert.equal(query(store, 'server IS compromised').length, 0, 'retracted → no current support')
  const explicit = query(store, 'server IS compromised\n  WHERE conf <= 1')
  assert.equal(explicit.length, 1, 'explicit conf filter sees the retracted current row')
  assert.equal(explicit[0]!.row?.conf, 0)
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

test('?x EXTENDS+ ?x finds cycles only and cycle-safe closure terminates', () => {
  const acyclic = open()
  acyclic.ingest('a EXTENDS b\nb EXTENDS c')
  assert.deepEqual(query(acyclic, '?x EXTENDS+ ?x'), [])
  acyclic.close()
  const cyclic = open()
  cyclic.ingest('a EXTENDS b\nb EXTENDS a\nc EXTENDS d')
  assert.deepEqual(
    query(cyclic, '?x EXTENDS+ ?x').map(match => match.bindings['x']).sort(),
    ['a', 'b']
  )
  cyclic.close()
})

test('VERB and VERB+ agree on retracted edges (spec §9.3)', () => {
  const store = open()
  store.ingest('terrier EXTENDS dog')
  store.ingest('terrier EXTENDS dog @ 0% ; retracted')
  assert.equal(query(store, 'terrier EXTENDS dog').length, 0, 'no current support')
  assert.equal(query(store, 'terrier EXTENDS+ dog').length, 0)
  assert.equal(query(store, 'terrier EXTENDS dog\n  WHERE conf <= 0.5').length, 1, 'explicit conf filter opts back in')
  assert.equal(query(store, 'terrier EXTENDS dog', { all: true }).length, 2)
  store.close()
})

test('tx date filters use whole-day intervals (spec §12.2)', () => {
  const store = open()
  store.ingest('a USES jwt')
  const row = store.currentBeliefs()[0]!
  const instant = new Date(parseInt(row.tx.slice(0, 8) + row.tx.slice(9, 13), 16)).toISOString()
  const day = instant.slice(0, 10)
  assert.equal(query(store, `?x USES jwt\n  WHERE tx = ${day}`).length, 1, 'recorded that day')
  assert.equal(query(store, `?x USES jwt\n  WHERE tx <= ${day}`).length, 1, '<= includes the boundary day')
  assert.equal(query(store, `?x USES jwt\n  WHERE tx > ${day}`).length, 0, '> excludes the boundary day')
  assert.equal(query(store, `?x USES jwt\n  WHERE tx >= ${day}`).length, 1)
  assert.equal(query(store, `?x USES jwt\n  WHERE tx != ${day}`).length, 0)
  assert.equal(query(store, `?x USES jwt\n  WHERE tx = ${instant.slice(0, 19)}`).length, 1, 'a zoneless second is UTC')
  store.close()
})

test('bound date/number objects match metric rows', () => {
  const store = open()
  store.ingest('latency IS 30ms\ndeploy PRECEDES 2026-01-01')
  assert.equal(query(store, 'latency IS 30ms').length, 1)
  assert.equal(query(store, 'deploy PRECEDES 2026-01-01').length, 1)
  const inverse = query(store, '2026-01-01 FOLLOWS deploy')
  assert.equal(inverse.length, 1, 'inverse pattern reaches the same metric row')
  store.close()
})
