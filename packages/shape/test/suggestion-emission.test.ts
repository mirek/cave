import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { emitClaim } from '@cavelang/canonical'
import { suggestAliases, writeSuggestions } from '@cavelang/shape'

test('numeric-looking alias names retain their entity identity through discovery and replay', () => {
  for (const [canonical, entity] of [['42', '4-2'], ['42', '4_2'], ['2026-01-01', '2026_01_01'], ['1ms', '1-ms']]) {
    const store = open(), restored = open()
    try {
      store.ingest(`${canonical} EXISTS\n${entity} EXISTS\n${canonical} USES engine`)
      const suggestions = suggestAliases(store)
      assert.equal(suggestions.length, 1)
      assert.equal(suggestions[0]!.canonical, canonical)
      assert.equal(suggestions[0]!.entity, entity)
      assert.equal(writeSuggestions(store, suggestions).appended, 1)
      assert.ok(store.aliasesOf(entity!).includes(canonical!))
      assert.ok(store.forward(entity!, { aliases: true }).some(fact => fact.target === 'engine'))
      assert.deepEqual(suggestAliases(store), [])
      assert.equal(writeSuggestions(store, suggestions).appended, 0)
      restored.ingest(store.exportText({ tx: true }), { strict: true })
      assert.ok(restored.aliasesOf(entity!).includes(canonical!))
      assert.deepEqual(suggestAliases(restored), [])
    } finally { restored.close(); store.close() }
  }
})

test('discovery reports pairs with no representable entity object without changing history', () => {
  const store = open()
  try {
    store.ingest('42 HAS email: "shared@example.test"\n43 HAS email: "shared@example.test"')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => suggestAliases(store), /alias relation.*42.*43|alias relation.*43.*42/i)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('representation failures outside the selected limit do not suppress valid top suggestions', () => {
  const store = open()
  try {
    store.ingest('Long_Street EXISTS\nlong-street EXISTS')
    const expected = suggestAliases(store, { limit: 1 })
    assert.equal(expected.length, 1)
    store.ingest('42 HAS email: "shared@example.test"\n43 HAS email: "shared@example.test"')
    assert.deepEqual(suggestAliases(store, { limit: 1 }), expected)
    assert.throws(() => suggestAliases(store, { limit: 2 }), /cannot represent an alias relation/)
    assert.throws(() => suggestAliases(store), /cannot represent an alias relation/)
  } finally { store.close() }
})

test('reviewing reversed suggestions targets their actual series and preserves independent confirmations', () => {
  for (const confirmed of [false, true]) for (const [canonical, entity] of [['42', '4-2'], ['2026-01-01', '2026_01_01']]) {
    const store = open(), restored = open()
    try {
      store.ingest(`${canonical} EXISTS\n${entity} EXISTS`)
      const suggestions = suggestAliases(store)
      assert.equal(writeSuggestions(store, suggestions).appended, 1)
      const row = store.byTag('suggested')[0]!
      const claim = store.toClaim(row)
      assert.equal(claim.subject.text, canonical)
      assert.ok(claim.contexts.includes('src:suggest/alias'))
      if (confirmed) store.ingest(emitClaim({ ...claim, conf: 1, contexts: [] }), { strict: true })
      store.ingest(emitClaim({ ...claim, conf: 0 }), { strict: true })
      assert.equal(store.aliasesOf(entity!).includes(canonical!), confirmed)
      assert.equal(store.history(row.claim_key).length, 2)
      assert.equal(writeSuggestions(store, suggestions).appended, 0)
      assert.deepEqual(suggestAliases(store), [])
      restored.ingest(store.exportText({ tx: true }), { strict: true })
      assert.equal(restored.aliasesOf(entity!).includes(canonical!), confirmed)
      assert.deepEqual(suggestAliases(restored), [])
    } finally { restored.close(); store.close() }
  }
})
