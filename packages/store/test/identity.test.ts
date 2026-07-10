import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Uuidv7 } from '@cavelang/core'
import { canonicalizeText, txComment, txOfLine } from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('exportText({ tx }) annotates every claim line at its indentation (spec §28.4)', () => {
  const store = open()
  store.ingest('deploy CAUSE outage @ 70%\n  BECAUSE logs\nauth USES jwt')
  const text = store.exportText({ tx: true })
  const lines = text.trimEnd().split('\n')
  assert.equal(lines.length, 6, 'one annotation per claim line')
  const rows = store.currentBeliefs()
  for (let at = 0; at < lines.length; at += 2) {
    const annotated = txOfLine(lines[at]!)
    assert.ok(annotated !== undefined && Uuidv7.is(annotated), lines[at])
    assert.ok(rows.some(row => row.tx === annotated), 'annotation carries a stored tx')
    const indent = lines[at + 1]!.match(/^ */)![0]
    assert.ok(lines[at]!.startsWith(`${indent};@ `), 'annotation shares the claim line indentation')
  }
  // A plain export carries no annotations, and the annotated text parses
  // to the same claims — comment lines are transparent (spec §8).
  assert.equal(store.exportText(), text.split('\n').filter(line => txOfLine(line) === undefined).join('\n'))
  store.close()
})

test('txComment/txOfLine round-trip; ordinary comments are not annotations', () => {
  assert.equal(txOfLine(txComment('abc')), 'abc')
  assert.equal(txOfLine('  ;@ 0198 '), '0198')
  assert.equal(txOfLine('; plain comment'), undefined)
  assert.equal(txOfLine(';@'), undefined)
  assert.equal(txOfLine(';@ two tokens'), undefined)
  assert.equal(txOfLine('auth USES jwt'), undefined)
})

test('insertResult({ ids }) replays under explicit identity: insert absent, skip present (spec §28.1)', () => {
  const store = open()
  const result = canonicalizeText('a NEEDS b\nb NEEDS c', store.registry())
  const given = [Uuidv7.next(), Uuidv7.next()]
  const first = store.insertResult(result, { ids: given })
  assert.deepEqual(first.ids, given)
  assert.equal(first.skipped, 0)
  assert.equal(store.currentBeliefs().find(row => row.subject === 'a')!.tx, given[0])

  const again = store.insertResult(result, { ids: given })
  assert.equal(again.skipped, 2)
  assert.deepEqual(again.ids, given, 'skipped rows report their existing ids')
  assert.equal(store.currentBeliefs().length, 2)

  // Mixed batches mint where no id is given — an ordinary append.
  const mixed = store.insertResult(canonicalizeText('c NEEDS d\nd NEEDS e', store.registry()), { ids: [Uuidv7.next(), undefined] })
  assert.equal(mixed.skipped, 0)
  assert.ok(Uuidv7.is(mixed.ids[1]!))
  store.close()
})

test('replayed edges deduplicate; plain appends never skip (spec §28.1)', () => {
  const store = open()
  const result = canonicalizeText('deploy CAUSE outage\n  BECAUSE logs', store.registry())
  const ids = [Uuidv7.next(), Uuidv7.next()]
  assert.equal(store.insertResult(result, { ids }).edges, 1)
  assert.equal(store.insertResult(result, { ids }).edges, 0, 'the stored edge is not re-added')

  // The same text as a plain append is a new assertion — new rows, new edge.
  const plain = store.insertResult(result)
  assert.equal(plain.skipped, 0)
  assert.equal(plain.edges, 1)
  store.close()
})
