import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { parseDocument } from '@cavelang/parser'

test('explicit claims disambiguate subjects without changing continuations or contexts', () => {
  const parsed = parseDocument('@claim WHEN EXISTS @claim\n  @claim IS EXISTS\n  IS EXISTS\n  WHEN @claim NOT EXISTS\n  WHEN NOT @claim NOT EXISTS')
  assert.deepEqual(parsed.diagnostics, [])
  const materialized = parsed.lines.filter(line => ['claim', 'continuation', 'qualifier'].includes(line.kind))
  assert.deepEqual(materialized.map(line => line.kind), ['claim', 'claim', 'continuation', 'qualifier', 'qualifier'])
  const root = materialized[0]!
  assert.equal(root.kind, 'claim')
  if (root.kind === 'claim') {
    assert.deepEqual(root.claim.subject, { kind: 'entity', text: 'WHEN' })
    assert.deepEqual(root.claim.meta.contexts, ['claim'])
  }
  assert.equal(parseDocument('IS EXISTS').diagnostics.length, 1)
  assert.equal(parseDocument('WHEN EXISTS').diagnostics.length, 1)
})

test('explicit claim markers compose with recursive prefixes and reject missing bodies', () => {
  const parsed = parseDocument('@claim\n  WHEN EXISTS\n  IS EXISTS')
  assert.deepEqual(parsed.diagnostics, [])
  assert.deepEqual(parsed.lines.filter(line => line.kind === 'claim').map(line => line.claim.subject.text), ['WHEN', 'IS'])
  for (const source of ['@claim', 'parent EXISTS\n  WHEN @claim']) assert.ok(parseDocument(source).diagnostics.length > 0)
})
