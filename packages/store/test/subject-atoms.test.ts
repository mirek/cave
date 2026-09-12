import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('structured subjects retain one non-metadata atom through emission', () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const subject of ['', 'two words', 'tab\tword', 'leading ', 'a;comment', '@actor', '#tag', '+/-1', '!', '(2σ)', '"quoted"', '`code`']) {
      const claim = Claim.of({ subject: Claim.entity(subject), verb: 'IS', payload: Claim.relation(Claim.entity('object')), raw: 'provided' })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /subject.*atom/i, JSON.stringify(subject))
      assert.throws(() => Canonical.emit(result), /subject.*atom/i, JSON.stringify(subject))
      assert.throws(() => store.insertResult(result), /subject.*atom/i, JSON.stringify(subject))
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const subject of [Claim.entity('scope/item'), Claim.entity('資料'), Claim.entity('code:literal'), Claim.text('two words'), Claim.code('@literal; value')]) {
      const claim = Claim.of({ subject, verb: 'IS', payload: Claim.relation(Claim.entity('ordinary object phrase')) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim), store.registry())
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.subject, subject)
      assert.deepEqual(parsed.claims[0]!.claim.payload, Claim.relation(Claim.entity('ordinary-object-phrase')))
    }
  } finally { store.close() }
})
