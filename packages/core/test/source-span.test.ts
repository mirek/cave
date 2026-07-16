import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { SourceSpan } from '@cavelang/core'

test('source spans format and parse one-based inclusive line ranges (spec §9.8)', () => {
  const context = SourceSpan.context('docs/design notes#1.md', { startLine: 10, endLine: 20 })
  assert.equal(context, 'src:docs/design%20notes%231.md#L10-L20')
  assert.deepEqual(SourceSpan.parse(context), {
    context,
    source: 'docs/design notes#1.md',
    span: { startLine: 10, endLine: 20 },
    location: 'docs/design notes#1.md#L10-L20'
  })
})

test('URL references expose links; malformed references fail safely', () => {
  const context = SourceSpan.context('https://example.com/a?q=x y', { startLine: 7, endLine: 7 })
  assert.deepEqual(SourceSpan.parse(context), {
    context,
    source: 'https://example.com/a?q=x y',
    span: { startLine: 7, endLine: 7 },
    location: 'https://example.com/a?q=x y#L7',
    href: 'https://example.com/a?q=x%20y#L7'
  })
  assert.equal(SourceSpan.parse('production'), undefined)
  assert.equal(SourceSpan.parse('src:bad%ZZ#L1'), undefined)
  assert.equal(SourceSpan.parse('src:file#L0'), undefined)
  assert.throws(() => SourceSpan.context('file', { startLine: 3, endLine: 2 }), /invalid source line span/)
})

test('unspanned source identity remains available', () => {
  assert.deepEqual(SourceSpan.ofContexts(['production', 'src:cli', 'src:file#L2-L3']), [
    { context: 'src:cli', source: 'cli', location: 'cli' },
    {
      context: 'src:file#L2-L3', source: 'file', span: { startLine: 2, endLine: 3 }, location: 'file#L2-L3'
    }
  ])
})
