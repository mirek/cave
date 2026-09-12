import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const kind of ['attribute', 'metric'] as const) test(`unquoted ${kind} values retain text and metadata boundaries`, () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const raw of ['', 'ready @production', 'ready #tag', 'ready !', 'ready +/- 2', 'ready (2σ)', 'two  words', 'two\twords', ' leading', 'trailing ', '"literal"', '`code`']) {
      const value = Value.parse(raw)
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'HAS', raw: 'provided',
        payload: kind === 'attribute' ? Claim.attribute('status', value) : Claim.metric(value) })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /value/, raw)
      assert.throws(() => Canonical.emit(result), /value/)
      assert.throws(() => store.insertResult(result), /value/)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const value of [Value.parse('NOT ready'), Value.parse('two words'), Value.parse('20B USD/yr'), Value.ofText('ready @production'), Value.ofCode('two  words'), Value.ofText('')]) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'HAS', payload: Claim.attribute('status', value) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.payload, claim.payload)
      assert.deepEqual(parsed.claims[0]!.claim.contexts, [])
      assert.equal(store.insertResult(parsed).ids.length, 1)
    }
  } finally { store.close() }
})
