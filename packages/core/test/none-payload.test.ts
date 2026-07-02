import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key } from '@cave/core'

test('object-less EXISTS claim (spec §5.2)', () => {
  const claim = Claim.of({ subject: Claim.entity('memory-leak'), verb: 'EXISTS', payload: Claim.none, contexts: ['production'] })
  assert.equal(claim.payload.kind, 'none')
})

test('none payload keys differently from a relation', () => {
  const bare = Claim.of({ subject: Claim.entity('x'), verb: 'EXISTS', payload: Claim.none })
  const rel = Claim.of({ subject: Claim.entity('x'), verb: 'EXISTS', payload: Claim.relation(Claim.entity('y')) })
  assert.notEqual(Key.of(bare), Key.of(rel))
})
