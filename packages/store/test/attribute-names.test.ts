import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('structured attribute names retain their payload boundary', () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const attribute of ['', 'two words', 'tab\tlabel', ' leading', 'trailing ', '@meta', '#tag', '+/-uncertainty', '"label"', '`label`']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'HAS', payload: Claim.attribute(attribute, Value.parse('42')), raw: 'provided' })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /attribute/, attribute)
      assert.throws(() => Canonical.emit(result), /attribute/, attribute)
      assert.throws(() => store.insertResult(result), /attribute/, attribute)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const attribute of ['amount', 'a:b', ':', 'NOT', '!', '資料/項目']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'HAS', payload: Claim.attribute(attribute, Value.parse('42')) })
      const result = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(result.problems, [], attribute)
      assert.deepEqual(result.claims[0]!.claim.payload, claim.payload, attribute)
      assert.equal(store.insertResult(result).ids.length, 1)
    }
  } finally { store.close() }
})
