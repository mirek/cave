import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { memoryStoreOfText } from '@cave/loop'

test('forward and inverse-named reverse traversal (spec §18 store contract)', () => {
  const store = memoryStoreOfText('monorepo CONTAINS packages/api')
  assert.deepEqual(
    store.forward('monorepo').map(edge => ({ rel: edge.rel, to: edge.to })),
    [{ rel: 'CONTAINS', to: 'packages/api' }]
  )
  assert.deepEqual(
    store.reverse('packages/api').map(edge => ({ rel: edge.rel, to: edge.to })),
    [{ rel: 'PART-OF', to: 'monorepo' }]
  )
})

test('reverse read without declaration is un-named (spec §5.5)', () => {
  const store = memoryStoreOfText('a LOGS b')
  const [edge] = store.reverse('b')
  assert.equal(edge!.rel, undefined)
  assert.equal(edge!.verb, 'LOGS')
})

test('current-belief resolution: last claim per key wins (spec §9.1)', () => {
  const store = memoryStoreOfText([
    'a USES b @ 40%',
    'a USES b @ 90%'
  ].join('\n'))
  const [edge] = store.forward('a')
  assert.equal(edge!.conf, 0.9)
  assert.equal(store.forward('a').length, 1)
})

test('negated and retracted facts are not traversable', () => {
  const store = memoryStoreOfText([
    'a BLOCKS NOT b',
    'a USES c',
    'a USES c @ 0%'
  ].join('\n'))
  assert.deepEqual(store.forward('a'), [])
})

test('topic expansion in both directions (spec §11.2)', () => {
  const store = memoryStoreOfText([
    'topic/auth CONTAINS token-expiry',
    'topic/auth CONTAINS auth/middleware'
  ].join('\n'))
  assert.deepEqual(store.expandTopic('topic/auth'), ['token-expiry', 'auth/middleware'])
  assert.deepEqual(store.topicsOf('token-expiry'), ['topic/auth'])
})

test('claimsAbout returns content from either endpoint', () => {
  const store = memoryStoreOfText([
    'auth/middleware HAS bug: token-expiry',
    'token-expiry CAUSE reject-valid-tokens'
  ].join('\n'))
  const about = store.claimsAbout('token-expiry')
  assert.equal(about.length, 1, 'attribute values are not graph endpoints')
  const middleware = store.claimsAbout('auth/middleware')
  assert.equal(middleware.length, 1)
})
