import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { SourceSpan } from '@cavelang/core'

test('HTTP source links preserve IPv6 host brackets without decoding other brackets', () => {
  for (const [source, href] of [
    ['https://[2001:db8::1]/notes', 'https://[2001:db8::1]/notes'],
    ['http://[::1]:8080/design notes', 'http://[::1]:8080/design%20notes'],
    ['https://[2001:DB8::1]/a[b]?q=[x]', 'https://[2001:DB8::1]/a%5Bb%5D?q=%5Bx%5D'],
    ['https://user[meta]:pass@[::1]/notes', 'https://user%5Bmeta%5D:pass@[::1]/notes'],
  ]) {
    for (const span of [undefined, { startLine: 2, endLine: 3 }]) {
      const reference = SourceSpan.parse(SourceSpan.context(source!, span))!
      assert.equal(reference.source, source)
      assert.equal(reference.href, href + (span === undefined ? '' : '#L2-L3'))
      assert.ok(URL.canParse(reference.href!))
    }
  }
  for (const source of ['https://%5B::1%5D/notes', 'https://[bad]/notes', 'https://[::1]:99999/notes']) {
    assert.equal(SourceSpan.parse(SourceSpan.context(source))?.href, undefined)
  }
})

test('unspanned HTTP sources retain their existing fragment links', () => {
  const source = 'https://example.com/design%20notes#section é'
  const reference = SourceSpan.parse(SourceSpan.context(source))!
  assert.equal(reference.source, source)
  assert.equal(reference.location, source)
  assert.equal(reference.href, 'https://example.com/design%20notes#section%20%C3%A9')
  const spanned = SourceSpan.parse(SourceSpan.context(source, { startLine: 2, endLine: 3 }))!
  assert.equal(spanned.source, source)
  assert.deepEqual(spanned.span, { startLine: 2, endLine: 3 })
  assert.equal(spanned.href, undefined, 'source fragments and line anchors cannot share one fragment')
})

test('malformed source Unicode is rejected without interrupting reference lists', () => {
  for (const value of ['\ud800', '\udc00', 'before\ud800%20after', '%ED%A0%80', '%ED%B0%80', '%C0%AF']) {
    assert.equal(SourceSpan.unescape(value), undefined, JSON.stringify(value))
    assert.equal(SourceSpan.parse(`src:${value}`), undefined)
    assert.deepEqual(SourceSpan.ofContexts(['src:first#L1', `src:${value}`, 'src:last#L2'])
      .map(reference => reference.source), ['first', 'last'])
  }
  for (const source of ['😀', 'é', 'replacement�', 'nul\0tail']) {
    assert.equal(SourceSpan.unescape(SourceSpan.escape(source)), source)
    assert.equal(SourceSpan.parse(SourceSpan.context(source))?.source, source)
  }
})

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

test('URL links preserve existing percent escapes while encoding raw characters', () => {
  const source = 'https://example.com/a%2Fb/design%20notes?q=%25&raw=x y&unicode=é&bad=%zz'
  for (const span of [undefined, { startLine: 2, endLine: 3 }]) {
    const reference = SourceSpan.parse(SourceSpan.context(source, span))!
    assert.equal(reference.source, source)
    assert.equal(reference.href,
      `https://example.com/a%2Fb/design%20notes?q=%25&raw=x%20y&unicode=%C3%A9&bad=%25zz${span === undefined ? '' : '#L2-L3'}`)
  }
})

test('source line anchors reject unsafe integers rather than rounding evidence locations', () => {
  for (const fragment of ['L9007199254740993', 'L1-L9007199254740993', 'L9007199254740992-L9007199254740993']) {
    assert.equal(SourceSpan.parse(`src:file#${fragment}`), undefined, fragment)
  }
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 1e21, Infinity, NaN, 1.5, 0, -1]) {
    for (const span of [{ startLine: value, endLine: value }, { startLine: 1, endLine: value }]) {
      assert.throws(() => SourceSpan.context('file', span), /invalid source line span/)
    }
  }
  const span = { startLine: Number.MAX_SAFE_INTEGER - 1, endLine: Number.MAX_SAFE_INTEGER }
  const context = SourceSpan.context('file', span)
  assert.equal(context, 'src:file#L9007199254740990-L9007199254740991')
  assert.deepEqual(SourceSpan.parse(context)?.span, span)
})
for (const field of ['startLine', 'endLine'] as const) {
  for (const later of [0, 99]) {
    test(`source contexts capture ${field} before formatting (${later})`, () => {
      let reads = 0
      const expected = { startLine: 2, endLine: 4 }
      const span = { ...expected,
        get [field]() { return ++reads <= (field === 'startLine' ? 3 : 2) ? expected[field] : later },
      }
      const context = SourceSpan.context('notes.md', span)
      assert.equal(context, 'src:notes.md#L2-L4')
      assert.deepEqual(SourceSpan.parse(context)?.span, expected)
      assert.equal(reads, 1)
    })
  }

  test(`source contexts retain invalid initial ${field} in validation and diagnostics`, () => {
    let reads = 0
    const span = { startLine: 2, endLine: 4,
      get [field]() { return ++reads === 1 ? 0 : field === 'startLine' ? 2 : 4 },
    }
    assert.throws(() => SourceSpan.context('notes.md', span), error => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, `invalid source line span ${JSON.stringify({ startLine: 2, endLine: 4, [field]: 0 })}`)
      return true
    })
    assert.equal(reads, 1)
  })
}

for (const field of ['startLine', 'endLine'] as const) {
  for (const kind of ['bigint', 'circular', 'throwing JSON'] as const) {
    test(`invalid source ${field} retains its diagnostic for ${kind}`, () => {
      const circular: { self?: unknown } = {}
      circular.self = circular
      const value = kind === 'bigint' ? 1n : kind === 'circular' ? circular :
        { toJSON() { throw new Error('unrelated serialization failure') } }
      const span = { startLine: 1, endLine: 2, [field]: value } as unknown as SourceSpan.LineSpan
      assert.throws(() => SourceSpan.context('notes.md', span), error => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'invalid source line span [unprintable span]')
        return true
      })
      assert.equal(SourceSpan.context('notes.md', { startLine: 1, endLine: 2 }), 'src:notes.md#L1-L2')
    })
  }
}

for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
  test(`source line fragments reject trailing ${JSON.stringify(ending)}`, () => {
    for (const fragment of ['L1', 'L1-L2']) {
      const canonical = `src:notes.md#${fragment}`
      assert.equal(SourceSpan.parse(canonical + ending), undefined)
      assert.ok(SourceSpan.parse(canonical))
      assert.deepEqual(SourceSpan.ofContexts([canonical + ending, canonical]).map(reference => reference.context), [canonical])
    }
  })
}

test('malformed HTTP source identities retain provenance without a navigable link', () => {
  for (const source of ['https://', 'https://[bad]/', 'https://exa mple.com/', 'https://example.com:99999/']) {
    for (const span of [undefined, { startLine: 2, endLine: 3 }]) {
      const context = SourceSpan.context(source, span)
      const reference = SourceSpan.parse(context)!
      assert.equal(reference.context, context)
      assert.equal(reference.source, source)
      assert.deepEqual(reference.span, span)
      assert.equal(reference.href, undefined, source)
    }
  }
})
