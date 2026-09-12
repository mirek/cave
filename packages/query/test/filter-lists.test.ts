import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'

test('long WHERE lists retain all requirements beyond SQLite parameter limits', () => {
  const store = open()
  try {
    store.ingest('high IS service @ 80%\nlow IS service @ 20%\nzero IS service @ 0%')
    const input = '?x IS service\n' + Array.from({ length: 33_000 }, (_, i) => `WHERE conf >= -${i}`).join('\n')
    assert.deepEqual(query(store, input).map(row => row.bindings['x']), ['high', 'low', 'zero'])
    assert.deepEqual(query(store, input + '\nWHERE conf > 0.5').map(row => row.bindings['x']), ['high'])
    assert.equal(query(store, input + '\nWHERE conf > 1').length, 0)
  } finally { store.close() }
})

test('short and grouped WHERE filters agree across operators, nulls, units and metadata', () => {
  const store = open()
  try {
    store.ingest('high HAS score: 42ms @ 80% @scope #flat #key:value\nlow HAS score: 2ms @ 20%\ntext HAS score: "text" @ 0%\nunitless HAS score: 42')
    const row = store.currentBeliefs()[0]!
    const day = new Date(parseInt(row.tx.slice(0, 8) + row.tx.slice(9, 13), 16)).toISOString().slice(0, 10)
    const filters = [
      ...['=', '!=', '<', '<=', '>', '>='].flatMap(op => [
        `WHERE conf ${op} 0.2`, `WHERE conf ${op} 5e-324`,
        `WHERE value ${op} 42`, `WHERE value ${op} 42ms`,
        `WHERE tx ${op} ${day}`, `WHERE tx ${op} 2020-01-01`,
      ]),
      'WHERE tag = flat', 'WHERE tag = key', 'WHERE tag = key:value',
      'WHERE tag = key:wrong', 'WHERE context = scope', 'WHERE context = absent',
    ]
    for (const filter of filters) {
      const input = '?x HAS score: ?value\n'
      const expected = query(store, input + filter).map(result => result.row!.id)
      for (const size of [16, 17, 1500]) {
        assert.deepEqual(query(store, input + Array.from({ length: size }, () => filter).join('\n'))
          .map(result => result.row!.id), expected, `${size}: ${filter}`)
      }
    }
    const mixed = ['WHERE conf > 0.5', 'WHERE value >= 42ms', 'WHERE tag = key', 'WHERE context = scope', `WHERE tx = ${day}`]
    assert.deepEqual(query(store, '?x HAS score: ?value\n' + Array.from({ length: 1500 }, (_, i) => mixed[i % mixed.length]).join('\n'))
      .map(result => result.bindings['x']), ['high'])
  } finally { store.close() }
})
