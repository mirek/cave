import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { check, suggestAliases } from '@cavelang/shape'

const longChain = (links = 12000): string => [
  'maria ALIAS source/0',
  ...Array.from({ length: links }, (_, index) => `source/${index} ALIAS source/${index + 1}`),
  `source/${links} ALIAS grandma-maria`,
  'maria HAS home: north',
  'grandma-maria HAS home: south'
].join('\n')

test('health reports retain disagreements across alias groups beyond the SQL parameter limit', () => {
  const store = open()
  try {
    store.ingest(longChain(33000))
    const disagreements = check(store).disagreements
    assert.equal(disagreements.length, 1)
    assert.deepEqual(disagreements[0]!.entities, ['grandma-maria', 'maria'])
  } finally { store.close() }
})

test('health scope batches retain evidence beyond the SQL parameter limit', () => {
  const store = open()
  try {
    store.ingest([
      'left ALIAS right',
      ...Array.from({ length: 33000 }, (_, index) => `left HAS field-${index}: 1 @prod @west`),
      'right HAS field-32999: 2 @west @prod',
      'right HAS field-32999: 3 @staging'
    ].join('\n'))
    const report = check(store)
    assert.equal(report.disagreements.length, 1)
    const conflict = report.disagreements[0]!
    assert.equal(conflict.about, 'HAS field-32999')
    assert.deepEqual(conflict.entities, ['left', 'right'])
    assert.deepEqual(conflict.rows.map(row => row.value_text).sort(), ['1', '2'])
    assert.equal(report.coverage.rows, 33003)
  } finally { store.close() }
})

test('alias discovery excludes candidates connected through long infrastructure chains', () => {
  const store = open()
  try {
    store.ingest(longChain())
    assert.deepEqual(suggestAliases(store), [])
  } finally { store.close() }
})
