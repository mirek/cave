import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { open } from '@cavelang/store'
import { queryRecords, Record } from '@cavelang/query'

const fixtureText = readFileSync(
  new URL('./fixtures/query-match-v1.json', import.meta.url),
  'utf8'
)

test('cave.query-match/v1 fixture remains decodable', () => {
  const record = Record.decode(fixtureText)
  assert.deepEqual(record.bindings, { service: 'api' })
  assert.deepEqual(JSON.parse(Record.encode(record)), JSON.parse(fixtureText))
})

test('queryRecords returns versioned claim records without storage columns', () => {
  const store = open()
  try {
    store.ingest('api USES jwt @ 90%')
    const matches = queryRecords(store, '?service USES jwt')
    assert.equal(matches[0]?.format, Record.format)
    assert.equal(matches[0]?.version, Record.version)
    assert.deepEqual(matches[0]?.bindings, { service: 'api' })
    assert.equal(matches[0]?.claim?.claim.verb, 'USES')
    assert.doesNotMatch(JSON.stringify(matches), /claim_key|raw_line|value_text/)
    assert.deepEqual(Record.decode(JSON.stringify(matches[0])), matches[0])
    assert.throws(() => Record.decode({ format: Record.format, version: 2 }), /unsupported.*version 2/)
  } finally {
    store.close()
  }
})

test('queryRecords versions transitive support claims too', () => {
  const store = open()
  try {
    store.ingest('a EXTENDS b\nb EXTENDS c')
    const matches = queryRecords(store, 'a EXTENDS+ c', { support: true })
    assert.equal(matches[0]?.support?.length, 2)
    assert.ok(matches[0]?.support?.every(record => record.format === 'cave.claim'))
  } finally {
    store.close()
  }
})
