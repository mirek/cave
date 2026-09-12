import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('explicit claim emission preserves reserved subjects, grouping and stored identities', () => {
  for (const name of ['WHEN', 'UNLESS', 'IS', 'NOT', 'API']) for (const verb of ['IS', 'EXISTS', 'CUSTOM']) for (const negated of [false, true]) {
    const claim = Claim.of({ subject: Claim.entity(name), verb, negated,
      payload: verb === 'EXISTS' ? Claim.none : Claim.relation(Claim.entity('ready')), contexts: ['claim'], comment: 'retained' })
    const standalone = Canonical.canonicalizeText(Canonical.emitClaim(claim))
    assert.deepEqual(standalone.problems, [], `${name}/${verb}/${negated}`)
    assert.equal(Key.of(standalone.claims[0]!.claim), Key.of(claim))
    for (const role of ['QUALIFIES', 'WHEN'] as const) {
      const parent = Claim.of({ subject: Claim.entity('parent'), verb: 'EXISTS', payload: Claim.none })
      const claims = [{ line: 1, claim: parent }, { line: 2, claim }]
      const edges = [{ parent: 0, child: 1, role }]
      const store = open(), restored = open()
      try {
        store.insertResult({ claims, edges, problems: [], registry: store.registry() })
        const exported = store.exportText({ tx: true })
        const parsed = Canonical.canonicalizeText(exported)
        assert.deepEqual(parsed.problems, [], exported)
        assert.deepEqual(parsed.claims.map(entry => Key.of(entry.claim)), claims.map(entry => Key.of(entry.claim)))
        assert.deepEqual(parsed.edges, edges)
        assert.equal(parsed.claims[1]!.claim.comment, claim.comment)
        restored.ingest(exported, { strict: true })
        assert.deepEqual(restored.currentBeliefs().map(row => row.claim_key), store.currentBeliefs().map(row => row.claim_key))
      } finally { restored.close(); store.close() }
    }
  }
})
