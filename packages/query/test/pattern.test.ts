import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Pattern } from '@cavelang/query'

test('variables, wildcards and terms (spec §12.1)', () => {
  const pattern = Pattern.parse('?x USES jwt')
  assert.deepEqual(pattern.subject, { kind: 'var', name: 'x' })
  assert.deepEqual(pattern.verb, { kind: 'verb', name: 'USES', transitive: false })
  assert.deepEqual(pattern.payload, { kind: 'object', object: { kind: 'term', text: 'jwt' } })
  assert.deepEqual(Pattern.parse('_ USES jwt').subject, { kind: 'wildcard' })
})

test('attribute pattern with value variable and tag filter (spec §12.1)', () => {
  const pattern = Pattern.parse('?x HAS bug: ?bug #security')
  assert.deepEqual(pattern.payload, {
    kind: 'attribute',
    attribute: 'bug',
    value: { kind: 'var', name: 'bug' }
  })
  assert.deepEqual(pattern.tags, [{ key: 'security' }])
})

test('verb variable and context filter (spec §12.1: ?x ?verb ?y @production)', () => {
  const pattern = Pattern.parse('?x ?verb ?y @production')
  assert.deepEqual(pattern.verb, { kind: 'var', name: 'verb' })
  assert.deepEqual(pattern.contexts, ['production'])
})

test('transitive marker (spec §12.1: terrier EXTENDS+ animal)', () => {
  const pattern = Pattern.parse('terrier EXTENDS+ animal')
  assert.deepEqual(pattern.verb, { kind: 'verb', name: 'EXTENDS', transitive: true })
})

test('WHERE filters (spec §12.2)', () => {
  const pattern = Pattern.parse([
    '?cause CAUSE app/crash',
    '  WHERE conf >= 0.7',
    '  WHERE tag = security',
    '  WHERE context = production',
    '  WHERE value > 1000 req/s',
    '  WHERE tx > 2026-01-01'
  ].join('\n'))
  assert.deepEqual(pattern.filters, [
    { field: 'conf', op: '>=', value: 0.7 },
    { field: 'tag', op: '=', key: 'security' },
    { field: 'context', op: '=', value: 'production' },
    { field: 'value', op: '>', value: 1000, unit: 'req/s' },
    { field: 'tx', op: '>', value: '2026-01-01' }
  ])
})

test('confidence filters accept percentages', () => {
  const pattern = Pattern.parse('?x USES ?y\nWHERE conf >= 70%')
  assert.deepEqual(pattern.filters, [{ field: 'conf', op: '>=', value: 0.7 }])
})

test('NOT patterns', () => {
  const pattern = Pattern.parse('?x IS NOT compromised')
  assert.equal(pattern.negated, true)
})

test('scoped tag filter', () => {
  const pattern = Pattern.parse('?x CAUSE ?y #topic:auth-security')
  assert.deepEqual(pattern.tags, [{ key: 'topic', value: 'auth-security' }])
})

test('errors: empty, missing verb, bad filter', () => {
  assert.throws(() => Pattern.parse(''), /empty query/)
  assert.throws(() => Pattern.parse('?x'), /subject and a verb/)
  assert.throws(() => Pattern.parse('?x lowercase y'), /verb position/)
  assert.throws(() => Pattern.parse('?x USES y\nWHERE nope = 1'), /unknown filter field/)
  assert.throws(() => Pattern.parse('?x USES y\nOOPS conf > 1'), /expected WHERE/)
})
