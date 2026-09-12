import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('a rejected grouping parent is diagnosed without discarding independent full claims', () => {
  const input = [
    'broken IS prefix"suffix',
    '  CUSTOM IS verb',
    '    WHEN enabled',
    'last CUSTOM value'
  ].join('\n')
  const result = Canonical.canonicalizeText(input)
  assert.deepEqual(result.problems.map(problem => problem.line), [1, 2])
  assert.match(result.problems[1]!.message, /grouped claim has no canonicalized parent/)
  assert.deepEqual(result.claims.map(entry => entry.line), [2, 3, 4])
  assert.deepEqual(result.edges, [{ parent: 0, child: 1, role: 'WHEN' }])
  assert.equal(result.registry.declared.has('CUSTOM'), true)
  const reparsed = Canonical.canonicalizeText(Canonical.emit(result))
  assert.deepEqual(reparsed.problems, [])
  assert.deepEqual(reparsed.edges, result.edges)
  for (const strict of [false, true]) {
    const store = open()
    try {
      store.ingest('original IS retained')
      const before = store.exportText({ tx: true })
      if (strict) {
        assert.throws(() => store.ingest(input, { strict }), /line 2: grouped claim/)
        assert.equal(store.exportText({ tx: true }), before)
        assert.equal(store.registry().declared.has('CUSTOM'), false)
      } else {
        const ingested = store.ingest(input)
        assert.deepEqual(ingested.problems, result.problems)
        assert.equal(ingested.ids.length, 3)
        assert.equal(store.registry().declared.has('CUSTOM'), true)
      }
    } finally { store.close() }
  }
})
