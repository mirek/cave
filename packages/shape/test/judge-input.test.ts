import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { judgePrompt, suggestAliases } from '@cavelang/shape'

test('judge prompts retain candidate descriptions and endpoints throughout evidence reads', t => {
  const store = open()
  try {
    store.ingest('Long_Street EXISTS\nlong-street EXISTS\nmaria EXISTS\ngrandma-maria EXISTS\nunrelated HAS city: elsewhere')
    const suggestions = suggestAliases(store).map(suggestion => ({ ...suggestion }))
    assert.equal(suggestions.length, 2)
    const expected = judgePrompt(store, suggestions)
    const prepare = store.db.prepare.bind(store.db)
    let changed = false
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (!changed && sql.includes('SELECT c.raw_line AS line')) {
        changed = true
        for (const suggestion of suggestions) {
          suggestion.entity = 'unrelated'
          suggestion.canonical = 'unrelated'
          suggestion.line = 'unrelated ALIAS unrelated'
        }
        suggestions.reverse()
      }
      return prepare(sql)
    })
    assert.equal(judgePrompt(store, suggestions), expected)
    assert.equal(changed, true)
  } finally { store.close() }
})
