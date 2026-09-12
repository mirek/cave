import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('structured metrics require a metric value kind', () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const value of [Value.parse('ready'), Value.ofText('ready'), Value.ofCode('ready')]) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.metric(value), raw: 'provided' })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /metric/)
      assert.throws(() => Canonical.emit(result), /metric/)
      assert.throws(() => store.insertResult(result), /metric/)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const raw of ['42', '2026-01-01', '1 -> 2']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.metric(Value.parse(raw)) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.payload, claim.payload)
      assert.equal(store.insertResult(parsed).ids.length, 1)
    }
  } finally { store.close() }
})

test('textual comparison qualifiers retain payload identity through emission and storage', () => {
  for (const operator of ['=', '!=', '>', '<', '>=', '<=']) for (const raw of ['ready', '"ready now"', '`ready()`']) {
    const input = `parent EXISTS\n  WHEN status ${operator} ${raw} @production #checked\n  UNLESS status ${operator} ${raw}`
    const result = Canonical.canonicalizeText(input)
    assert.deepEqual(result.problems, [])
    assert.equal(result.claims[1]!.claim.payload.kind, 'relation')
    const reparsed = Canonical.canonicalizeText(Canonical.emit(result))
    assert.deepEqual(reparsed.problems, [])
    assert.deepEqual(reparsed.claims.map(entry => Key.of(entry.claim)), result.claims.map(entry => Key.of(entry.claim)))
    assert.deepEqual(reparsed.edges, result.edges)
    const store = open(), restored = open()
    try {
      assert.equal(store.ingest(input, { strict: true }).ids.length, 3)
      assert.equal(restored.ingest(store.exportText(), { strict: true }).ids.length, 3)
      assert.deepEqual(restored.currentBeliefs().map(row => row.claim_key), store.currentBeliefs().map(row => row.claim_key))
    } finally { restored.close(); store.close() }
  }
})
