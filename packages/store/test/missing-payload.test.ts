import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('structured claims without payloads require EXISTS', () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const verb of ['HAS', 'IS', 'CUSTOM']) for (const negated of [false, true]) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb, negated, payload: Claim.none, raw: 'provided', contexts: ['production'] })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /payload|object/, verb)
      assert.throws(() => Canonical.emit(result), /payload|object/, verb)
      assert.throws(() => store.insertResult(result), /payload|object/, verb)
      assert.equal(store.exportText({ tx: true }), before)
      const parent = Claim.of({ subject: Claim.entity('parent'), verb: 'EXISTS', payload: Claim.none })
      assert.throws(() => Canonical.emit({ ...result, claims: [{ line: 1, claim: parent }, { line: 2, claim }], edges: [{ parent: 0, child: 1, role: 'WHEN' }] }), /payload|object/)
    }
    for (const negated of [false, true]) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'EXISTS', negated, payload: Claim.none, contexts: ['production'] })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.payload, Claim.none)
      assert.equal(parsed.claims[0]!.claim.negated, negated)
      assert.equal(store.insertResult(parsed).ids.length, 1)
    }
  } finally { store.close() }
})
