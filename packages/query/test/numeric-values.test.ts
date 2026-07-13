import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'

test('WHERE value accepts multiplied numeric values with units', () => {
  const store = open()
  store.ingest('ChatGPT HAS weekly-users: 900M users/wk\nblog HAS weekly-users: 5K users/wk')

  const matches = query(store, '?x HAS weekly-users: ?n\n  WHERE value >= 0.9B users/wk')

  assert.deepEqual(matches.map(match => match.bindings['x']), ['ChatGPT'])
  store.close()
})

test('exact numeric attribute values compare normalized number and unit', () => {
  const store = open()
  store.ingest('ChatGPT HAS weekly-users: 900M users/wk')

  assert.equal(query(store, 'ChatGPT HAS weekly-users: 0.9B users/wk').length, 1)
  assert.equal(query(store, 'ChatGPT HAS weekly-users: 900M requests/wk').length, 0)
  store.close()
})
