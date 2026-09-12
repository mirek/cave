import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('sigma overrides retain every finite magnitude through canonical and store export', () => {
  for (const sigmaLevel of [Number.MIN_VALUE, 1e-300, 1e-7, 0.5, 2, 1e21, Number.MAX_VALUE]) {
    const parent = Claim.of({ subject: Claim.entity('parent'), verb: 'EXISTS', payload: Claim.none })
    const child = Claim.of({ subject: Claim.entity('item'), verb: 'IS', payload: Claim.metric(Value.parse('42')),
      sigmaLevel, contexts: ['production'], comment: 'measured' })
    const standalone = Canonical.canonicalizeText(Canonical.emitClaim(child))
    assert.deepEqual(standalone.problems, [])
    assert.equal(standalone.claims[0]!.claim.sigmaLevel, sigmaLevel)
    for (const role of ['WHEN', 'QUALIFIES'] as const) {
      const result = { claims: [{ line: 1, claim: parent }, { line: 2, claim: child }], edges: [{ parent: 0, child: 1, role }] }
      const store = open(), restored = open()
      try {
        store.insertResult({ ...result, problems: [], registry: store.registry() })
        for (const tx of [false, true]) {
          const source = store.exportText({ tx })
          const parsed = Canonical.canonicalizeText(source)
          assert.deepEqual(parsed.problems, [], source)
          assert.deepEqual(parsed.claims.map(entry => Key.of(entry.claim)), result.claims.map(entry => Key.of(entry.claim)))
          assert.deepEqual(parsed.edges, result.edges)
          assert.equal(parsed.claims[1]!.claim.sigmaLevel ?? 2, sigmaLevel)
          assert.equal(parsed.claims[1]!.claim.comment, child.comment)
        }
        restored.ingest(store.exportText(), { strict: true })
        assert.equal(restored.currentBeliefs().find(row => row.subject === 'item')!.sigma_level, sigmaLevel)
      } finally { restored.close(); store.close() }
    }
  }
})

test('canonical emission rejects invalid structured sigma overrides', () => {
  const base = Claim.of({ subject: Claim.entity('item'), verb: 'EXISTS', payload: Claim.none })
  for (const sigmaLevel of [0, -1, NaN, Infinity]) {
    const claim = { ...base, sigmaLevel }
    assert.throws(() => Canonical.emitClaim(claim), /sigma/)
    assert.throws(() => Canonical.emit({ claims: [{ line: 1, claim }], edges: [] }), /sigma/)
  }
})
