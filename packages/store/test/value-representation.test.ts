import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const position of ['attribute', 'metric', 'delta'] as const) test(`structured ${position} values agree with their emitted text`, () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    const numeric = Value.parse('1')
    const invalid: Value.t[] = [
      { ...numeric, num: 2 }, { ...numeric, approx: true }, { ...numeric, unit: 'ms' },
      { ...numeric, kind: 'date' as const }, { ...numeric, from: 1 }, { ...numeric, to: 2 }
    ]
    if (position !== 'delta') invalid.push(
      { ...Value.parse('1 -> 2'), from: 0 }, { ...Value.parse('1 -> 2'), to: 3 },
      { ...Value.ofText('hello'), approx: true }, { ...Value.ofCode('x'), num: 1 }
    )
    for (const value of invalid) {
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: position === 'metric' ? 'IS' : 'HAS', raw: 'provided',
        payload: position === 'metric' ? Claim.metric(value) : Claim.attribute('amount', position === 'delta' ? numeric : value),
        ...(position === 'delta' ? { delta: value } : {}) })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /value/, JSON.stringify(value))
      assert.throws(() => Canonical.emit(result), /value/)
      assert.throws(() => store.insertResult(result), /value/)
      assert.equal(store.exportText({ tx: true }), before)
    }
    for (const raw of ['1', '~1ms', '20B USD/yr']) {
      const value = Value.parse(raw)
      const claim = Claim.of({ subject: Claim.entity('subject'), verb: 'HAS', payload: Claim.attribute('amount', value), delta: Value.parse('0.1') })
      const parsed = Canonical.canonicalizeText(Canonical.emitClaim(claim))
      assert.deepEqual(parsed.problems, [])
      assert.deepEqual(parsed.claims[0]!.claim.payload, claim.payload)
      assert.deepEqual(parsed.claims[0]!.claim.delta, claim.delta)
      assert.equal(store.insertResult(parsed).ids.length, 1)
    }
  } finally { store.close() }
})
