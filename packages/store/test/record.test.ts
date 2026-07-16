import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Key } from '@cavelang/core'
import { open, Record } from '@cavelang/store'

const fixtureText = readFileSync(
  new URL('./fixtures/claim-record-v1.json', import.meta.url),
  'utf8'
)

test('cave.claim/v1 fixture decodes and preserves its semantic identity', () => {
  const record = Record.decode(fixtureText)
  assert.equal(record.format, 'cave.claim')
  assert.equal(record.version, 1)
  assert.equal(Key.of(record.claim), record.key)
  assert.equal(record.canonical, record.claim.raw)
  assert.deepEqual(JSON.parse(Record.encode(record)), JSON.parse(fixtureText))
})

test('recordOf maps storage columns to the stable semantic contract', () => {
  const store = open()
  try {
    store.ingest('api HAS owner: platform @src:inventory #team:core @ 90%')
    const record = store.recordOf(store.currentBeliefs()[0]!)
    const json = Record.encode(record)
    assert.equal(record.claim.payload.kind, 'attribute')
    assert.deepEqual(record.provenance.sources, ['inventory'])
    assert.doesNotMatch(json, /claim_key|raw_line|value_text|value_num/)
    assert.equal(Record.decode(json).key, record.key)
  } finally {
    store.close()
  }
})

test('record decoder rejects malformed and unknown future versions', () => {
  assert.throws(() => Record.decode({ format: 'cave.claim', version: 2 }), /unsupported.*version 2/)
  assert.throws(() => Record.decode({ format: 'row', version: 1 }), /expected format/)
  assert.throws(() => Record.decode({ format: 'cave.claim', version: 1 }), /malformed/)
})
