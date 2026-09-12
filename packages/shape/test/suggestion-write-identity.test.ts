import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { suggestAliases, writeSuggestions } from '@cavelang/shape'

test('suggestion writes reject value targets without appending a misleading ALIAS row', () => {
  const store = open()
  try {
    store.ingest('42 EXISTS\n4-2 EXISTS')
    const suggestions = suggestAliases(store).map(suggestion => ({ ...suggestion,
      line: `${suggestion.entity} ALIAS ${suggestion.canonical}` }))
    assert.equal(suggestions.length, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.throws(() => writeSuggestions(store, suggestions), /suggestion.*alias relation/i)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('retained suggestion batches must describe their proposed pairs before any append', () => {
  const store = open()
  try {
    store.ingest('maria EXISTS\ngrandma-maria EXISTS\nLong_Street EXISTS\nlong-street EXISTS')
    const suggestions = suggestAliases(store)
    assert.equal(suggestions.length, 2)
    const [first, second] = suggestions
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const line of ['unrelated EXISTS', `${second!.entity} ALIAS stranger`,
      `${second!.entity} ALIAS NOT ${second!.canonical}`,
      `${second!.entity} ALIAS ${second!.canonical} @ 0%`,
      `${second!.line}\nunrelated EXISTS`]) {
      assert.throws(() => writeSuggestions(store, [first!, { ...second!, line }]), /suggestion.*alias relation/i)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const reversed = { ...second!, line: `${second!.canonical} ALIAS ${second!.entity} #suggested @ 50%` }
    assert.equal(writeSuggestions(store, [first!, reversed]).appended, 2)
    assert.equal(writeSuggestions(store, suggestions).appended, 0)
    assert.deepEqual(suggestAliases(store), [])
  } finally { store.close() }
})

test('joining individually valid suggestions cannot introduce grouping edges', () => {
  const store = open(), restored = open()
  try {
    store.ingest('maria EXISTS\ngrandma-maria EXISTS\nLong_Street EXISTS\nlong-street EXISTS')
    const suggestions = suggestAliases(store)
    assert.equal(suggestions.length, 2)
    const retained = [suggestions[0]!, { ...suggestions[1]!, line: `  ; reviewed candidate\n  ${suggestions[1]!.line}` }]
    assert.equal(writeSuggestions(store, retained).appended, 2)
    assert.deepEqual(store.db.prepare('SELECT role FROM cave_edge').all(), [])
    assert.ok(store.aliasesOf('maria').includes('grandma-maria'))
    assert.ok(store.aliasesOf('Long_Street').includes('long-street'))
    const reviewed = store.byTag('suggested').map(row => store.toClaim(row)).find(claim => claim.comment?.startsWith('reviewed candidate'))
    assert.ok(reviewed)
    assert.ok(reviewed.comment!.includes(suggestions[1]!.signals[0]!.detail))
    restored.ingest(store.exportText({ tx: true }), { strict: true })
    assert.deepEqual(restored.db.prepare('SELECT role FROM cave_edge').all(), [])
    assert.deepEqual(suggestAliases(restored), [])
  } finally { restored.close(); store.close() }
})
