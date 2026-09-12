import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Uncertainty, Value } from '@cavelang/core'
import { canonicalizeText, emit, emitClaim } from '@cavelang/canonical'

test('emitters reject invalid structured uncertainty deltas in full and abbreviated claims', () => {
  const base = Claim.of({ subject: Claim.entity('item'), verb: 'EXISTS', payload: Claim.none })
  for (const delta of [Value.parse('0'), Value.parse('-1'), Value.parse('ready'),
    Value.parse('1 -> 2'), Value.ofText('1'), Value.ofCode('1')]) {
    const claim = { ...base, delta }
    assert.throws(() => emitClaim(claim), Uncertainty.InvalidUncertaintyError)
    assert.throws(() => emit({ claims: [{ line: 1, claim }], edges: [] }), Uncertainty.InvalidUncertaintyError)
    assert.throws(() => emit({ claims: [{ line: 1, claim: base }, { line: 2, claim }],
      edges: [{ parent: 0, child: 1, role: 'WHEN' }] }), Uncertainty.InvalidUncertaintyError)
  }
})

test('uncertainty emission preserves positive scalars, units and approximation', () => {
  for (const raw of ['0.0000001', '2B USD/yr', '~0.5', Value.formatNumber(Number.MIN_VALUE), Value.formatNumber(Number.MAX_VALUE)]) {
    const delta = Value.parse(raw)
    const claim = Claim.of({ subject: Claim.entity('item'), verb: 'EXISTS', payload: Claim.none, delta })
    const parsed = canonicalizeText(emitClaim(claim))
    assert.deepEqual(parsed.problems, [])
    assert.deepEqual(parsed.claims[0]!.claim.delta, delta)
  }
})
