import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const role of ['WHEN', 'VIA', 'BECAUSE'] as const) test(`${role} preserves an entity named NOT`, () => {
  for (const verb of ['EXISTS', 'IS']) for (const negated of [false, true]) {
    const parent = Claim.of({ subject: Claim.entity('parent'), verb: 'EXISTS', payload: Claim.none })
    const child = Claim.of({ subject: Claim.entity('NOT'), verb, negated,
      payload: verb === 'EXISTS' ? Claim.none : Claim.relation(Claim.entity('ready')),
      contexts: ['production'], conf: 0.7, comment: 'condition' })
    const result = { claims: [{ line: 1, claim: parent }, { line: 2, claim: child }], edges: [{ parent: 0, child: 1, role }] }
    const source = Canonical.emit(result)
    const parsed = Canonical.canonicalizeText(source)
    assert.deepEqual(parsed.problems, [], source)
    assert.deepEqual(parsed.claims.map(entry => Key.of(entry.claim)), result.claims.map(entry => Key.of(entry.claim)), source)
    assert.deepEqual(parsed.edges, result.edges)
    assert.equal(parsed.claims[1]!.claim.conf, child.conf)
    assert.equal(parsed.claims[1]!.claim.comment, child.comment)
    const store = open(), restored = open()
    try {
      assert.equal(store.insertResult({ ...result, problems: [], registry: store.registry() }).ids.length, 2)
      for (const tx of [false, true]) {
        assert.deepEqual(Canonical.canonicalizeText(store.exportText({ tx })).problems, [])
      }
      assert.equal(restored.ingest(store.exportText(), { strict: true }).ids.length, 2)
      assert.deepEqual(restored.currentBeliefs().map(row => row.claim_key), store.currentBeliefs().map(row => row.claim_key))
    } finally { restored.close(); store.close() }
  }
})
