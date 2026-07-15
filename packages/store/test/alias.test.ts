import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'

test('aliasesOf walks current positive ALIAS claims as undirected edges (spec §13.6)', () => {
  const store = open()
  store.ingest('js ALIAS javascript\necmascript ALIAS javascript')
  assert.deepEqual(store.aliasesOf('js'), ['js', 'ecmascript', 'javascript'])
  assert.deepEqual(store.aliasesOf('ecmascript'), ['ecmascript', 'javascript', 'js'])
  assert.deepEqual(store.aliasesOf('python'), ['python'], 'no aliases → the entity alone')
  store.close()
})

test('unmerge = ALIAS retraction @ 0% (spec §13.6)', () => {
  const store = open()
  store.ingest('js ALIAS javascript')
  assert.deepEqual(store.aliasesOf('js'), ['js', 'javascript'])
  store.ingest('js ALIAS javascript @ 0% ; merged in error')
  assert.deepEqual(store.aliasesOf('js'), ['js'])
  assert.equal(store.history(store.claimsAbout('js')[0]!.claim_key).length, 2, 'both histories survive intact')
  store.close()
})

test('negated ALIAS never links (spec §13.6)', () => {
  const store = open()
  store.ingest('java ALIAS NOT javascript')
  assert.deepEqual(store.aliasesOf('java'), ['java'])
  store.close()
})

test('literal terms are not entities: closure and traversal skip them (spec §13.6)', () => {
  const store = open()
  store.ingest([
    'error-a ALIAS "connection refused"',
    'error-b ALIAS "connection refused"',
    'error-a ALIAS err-a',
    'retry-a ALIAS `retry()`',
    'retry-b ALIAS `retry()`',
    'error-a AFFECTS billing',
    'error-b AFFECTS search'
  ].join('\n'))
  assert.deepEqual(store.aliasesOf('error-a'), ['error-a', 'err-a'],
    'the literal name and anything reachable through it stay out')
  assert.deepEqual(store.aliasesOf('error-b'), ['error-b'])
  assert.deepEqual(store.aliasesOf('retry-a'), ['retry-a'], 'code literals never link either')
  const affects = store.forward('error-a', { aliases: true })
    .filter(fact => fact.verb === 'AFFECTS').map(fact => fact.target)
  assert.deepEqual(affects, ['billing'], 'traversal does not widen through a shared literal')
  store.close()
})

test('traversal matches through the closure only when opted in (spec §13.6)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'billing USES postgres',
    'analytics USES postgresql'
  ].join('\n'))
  // The ALIAS row itself is an ordinary relational fact and traverses like
  // any other — filter to USES to see the widened matches alone.
  const uses = (facts: { verb: string, source: string }[]): string[] =>
    facts.filter(fact => fact.verb === 'USES').map(fact => fact.source).sort()
  assert.deepEqual(uses(store.reverse('postgres')), ['billing'])
  assert.deepEqual(uses(store.reverse('postgres', { aliases: true })), ['analytics', 'billing'])
  const targets = store.forward('analytics', { aliases: true }).map(fact => fact.target)
  assert.deepEqual(targets, ['postgresql'], 'union-of-rows: stored names come back untouched')
  store.close()
})

test('forward through the closure widens the subject side (spec §13.6)', () => {
  const store = open()
  store.ingest([
    'k8s ALIAS kubernetes',
    'k8s CONTAINS kubelet',
    'kubernetes CONTAINS api-server'
  ].join('\n'))
  const contains = (facts: { verb: string, target: string }[]): string[] =>
    facts.filter(fact => fact.verb === 'CONTAINS').map(fact => fact.target).sort()
  assert.deepEqual(contains(store.forward('k8s')), ['kubelet'])
  assert.deepEqual(contains(store.forward('k8s', { aliases: true })), ['api-server', 'kubelet'])
  assert.deepEqual(store.topicMembers('kubernetes', { aliases: true }).sort(), ['api-server', 'kubelet'])
  assert.deepEqual(store.topicsOf('kubelet', { aliases: true }).sort(), ['k8s'])
  store.close()
})

test('claimsAbout through the closure keeps both belief series visible (spec §13.6)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres HAS version: 16',
    'postgresql HAS version: 15'
  ].join('\n'))
  const about = store.claimsAbout('postgres', { aliases: true })
  const versions = about.filter(row => row.attribute === 'version').map(row => row.value_text).sort()
  assert.deepEqual(versions, ['15', '16'], 'union surfaces the disagreement instead of silently merging')
  assert.equal(store.claimsAbout('postgres').filter(row => row.attribute === 'version').length, 1)
  store.close()
})
