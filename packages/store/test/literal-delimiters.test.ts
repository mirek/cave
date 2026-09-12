import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const kind of ['text', 'code'] as const) test(`structured ${kind} literals reject their own delimiter`, () => {
  for (const field of ['subject', 'object', 'attribute', 'metric'] as const) for (const raw of ['', 'provided raw']) {
    const store = open()
    try {
      store.ingest('original IS retained')
      const before = store.exportText({ tx: true })
      const delimiter = kind === 'text' ? '"' : '`'
      const term = Claim[kind](`first${delimiter}second`)
      const value = kind === 'text' ? Value.ofText(term.text) : Value.ofCode(term.text)
      const claim = Claim.of({ subject: field === 'subject' ? term : Claim.entity('subject'), verb: field === 'attribute' ? 'HAS' : 'IS', raw,
        payload: field === 'attribute' ? Claim.attribute('name', value) : field === 'metric' ? Claim.metric(value) : Claim.relation(field === 'object' ? term : Claim.entity('object')) })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /delimiter/i, field)
      assert.throws(() => Canonical.emit(result), /delimiter/i, field)
      assert.throws(() => store.insertResult(result), /delimiter/i, field)
      assert.equal(store.exportText({ tx: true }), before)
      const safe = Claim[kind](kind === 'text' ? 'a `code` fragment' : 'a "quoted" fragment')
      const valid = Claim.of({ subject: safe, verb: 'IS', payload: Claim.relation(safe) })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(valid), store.registry())
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.subject, safe)
      assert.deepEqual(parsed.claims[0]!.claim.payload, valid.payload)
    } finally { store.close() }
  }
})
