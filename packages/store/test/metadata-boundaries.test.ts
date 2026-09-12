import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Tag } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const field of ['context', 'tag'] as const) test(`structured ${field} metadata retains token boundaries`, () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    const invalid = field === 'context' ? ['', 'two words', 'tab\tword', 'a;comment'] : ['', 'two words', 'tab\tword', 'a;comment', 'key:value']
    for (const value of invalid) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.relation(Claim.entity('object')), raw: 'provided',
        contexts: field === 'context' ? [value] : [], tags: field === 'tag' ? [Tag.of(value)] : [] })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /metadata|tag|context/, value)
      assert.throws(() => Canonical.emit(result), /metadata|tag|context/, value)
      assert.throws(() => store.insertResult(result), /metadata|tag|context/, value)
      assert.equal(store.exportText({ tx: true }), before)
    }
    if (field === 'tag') for (const value of ['two words', 'tab\tword', 'a;comment']) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.relation(Claim.entity('object')), tags: [Tag.of('key', value)] })
      assert.throws(() => Canonical.emitClaim(claim), /metadata|tag/, value)
      assert.throws(() => store.insertResult({ claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }), /metadata|tag/, value)
      assert.equal(store.exportText({ tx: true }), before)
    }
    const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'IS', payload: Claim.relation(Claim.entity('object')),
      contexts: ['src:actor', 'https://example.test/page#section', '資料'], tags: [Tag.of('team', 'scope:sub'), Tag.of('flag'), Tag.of('empty', '')] })
    const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
    assert.deepEqual(parsed.problems, [])
    assert.deepEqual(parsed.claims[0]!.claim.contexts, claim.contexts)
    assert.deepEqual(parsed.claims[0]!.claim.tags, claim.tags)
  } finally { store.close() }
})
