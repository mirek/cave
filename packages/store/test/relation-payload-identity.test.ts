import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('entity relation objects cannot become another payload or claim modifier', () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const verb of ['IS', 'HAS', 'CUSTOM']) for (const object of ['', '42', '2026-01-01', 'owner: platform', 'NOT', 'NOT ready', 'ready @production', 'ready #tag', 'ready !', '"literal"', '`code`']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb, payload: Claim.relation(Claim.entity(object)), raw: 'provided' })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /relation|object/, `${verb}/${object}`)
      assert.throws(() => Canonical.emit(result), /relation|object/)
      assert.throws(() => store.insertResult(result), /relation|object/)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const object of ['ordinary object phrase', 'ordinary', '_', 'not', 'NOT_ready', '資料/項目', 'NOT-ready', 'ready/42']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.relation(Claim.entity(object)) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.equal(parsed.claims[0]!.claim.payload.kind, 'relation')
      assert.equal(store.insertResult(parsed).ids.length, 1)
    }
    for (const object of [Claim.text('42'), Claim.code('NOT ready')]) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.relation(object) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.payload, claim.payload)
    }
  } finally { store.close() }
})
