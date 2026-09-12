import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const raw of ['', 'caller supplied raw']) for (const field of ['subject', 'object', 'context'] as const) {
  test(`structured newline claims reject before append: ${field}/raw=${raw !== ''}`, () => {
    const store = open()
    try {
      store.ingest('original IS retained')
      const before = store.exportText({ tx: true })
      const claim = Claim.of({
        subject: Claim.code(field === 'subject' ? 'first\nsecond' : 'subject'), verb: 'IS',
        payload: Claim.relation(Claim.text(field === 'object' ? 'first\nsecond' : 'object')),
        contexts: field === 'context' ? ['first\nsecond'] : [], raw
      })
      const valid = Claim.of({ subject: Claim.entity('earlier'), verb: 'IS', payload: Claim.relation(Claim.entity('valid')) })
      const result = { claims: [{ line: 1, claim: valid }, { line: 2, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /newline/i)
      assert.throws(() => Canonical.emit(result), /newline/i)
      assert.throws(() => store.insertResult(result), /newline/i)
      assert.equal(store.exportText({ tx: true }), before)
      store.ingest('; first comment\nvalid IS accepted ; second comment')
      const restored = open()
      try { restored.ingest(store.exportText(), { strict: true }); assert.equal(restored.currentBeliefs().length, 2) }
      finally { restored.close() }
    } finally { store.close() }
  })
}
