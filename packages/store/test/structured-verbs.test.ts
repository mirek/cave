import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('structured verbs obey the parser lexical rule before append', () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const verb of ['', 'uses', 'Uses', '-USES', 'USE1', 'USES NOW', 'IS;comment', 'IS\r', 'IS\u2028', 'IS\u2029']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb, payload: Claim.relation(Claim.entity('object')), raw: 'provided' })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /verb/i, JSON.stringify(verb))
      assert.throws(() => Canonical.emit(result), /verb/i, JSON.stringify(verb))
      assert.throws(() => store.insertResult(result), /verb/i, JSON.stringify(verb))
      assert.equal(store.exportText({ tx: true }), before)
    }
    assert.ok(Canonical.canonicalizeText('subject IS\r object').problems.length > 0)
    for (const verb of ['IS', 'USES-', 'CUSTOM-VERB']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb, payload: Claim.relation(Claim.entity('object')) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.equal(parsed.claims[0]!.claim.verb, verb)
    }
    assert.deepEqual(Canonical.canonicalizeText('subject IS object\r\nother USES object\r\n').problems, [])
  } finally { store.close() }
})
