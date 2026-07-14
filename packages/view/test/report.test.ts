import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { report } from '@cavelang/view'

/**
 * A store exercising every §31 construct: repeated solutions for query
 * blocks, one uncontested attribute for the inline splice, one fact
 * contested across sources (§26 resolution is the fix), a transitive
 * chain (solutions without rows), and an alias pair for the closure.
 */
const fixture = () => {
  const store = open()
  store.ingest(`
api-gateway IS service
checkout IS service
api-gateway HAS owner: platform-team @src:cli
checkout HAS owner: payments-team @src:cli
checkout HAS owner: shop-team @src:audit
acme HAS revenue: ~20B USD/yr @src:cli @ 90%
microservice EXTENDS service
api-gateway IS microservice
billing USES postgres
postgres ALIAS postgresql
analytics USES postgresql
`)
  return store
}

const today = (): string => new Date().toISOString().slice(0, 10)

test('markdown without live constructs passes through verbatim (spec §31.1)', () => {
  const store = fixture()
  const template = '# Title\n\nProse with a `code span` and ?tokens.\n'
  const rendered = report(store, template)
  assert.equal(rendered.markdown, template)
  assert.equal(rendered.citations, 0)
  assert.deepEqual(rendered.problems, [])
  store.close()
})

test('query block without a fragment renders cited bullets (spec §31.1)', () => {
  const store = fixture()
  const rendered = report(store, [
    '## Services',
    '',
    '```cave-q',
    '?svc IS service',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- \?svc = api-gateway \[\^c1\]/)
  assert.match(rendered.markdown, /- \?svc = checkout \[\^c2\]/)
  // Footnote definitions: canonical line, tx date, claim key (spec §31.2).
  assert.match(rendered.markdown, /\[\^c1\]: `api-gateway IS service` — \d{4}-\d{2}-\d{2}, claim key `\["e:api-gateway","IS",0,"r:e:service",\[\]\]`/)
  assert.ok(rendered.markdown.includes(today()))
  assert.equal(rendered.citations, 2)
  store.close()
})

test('fragment renders per solution with ?var substitution and [^?] placement', () => {
  const store = fixture()
  const rendered = report(store, [
    '| service | owner |',
    '|---|---|',
    '```cave-q',
    '?svc HAS owner: ?who @src:cli',
    '| ?svc | ?who [^?] |',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /\| api-gateway \| platform-team \[\^c1\] \|/)
  assert.match(rendered.markdown, /\| checkout \| payments-team \[\^c2\] \|/)
  // The header passed through above the rendered rows.
  assert.match(rendered.markdown, /\| service \| owner \|\n\|---\|---\|\n\| api-gateway/)
  store.close()
})

test('fragment without [^?] gets the citation appended to its last line', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'acme HAS revenue: ?v',
    'Revenue stands at **?v**.',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Revenue stands at \*\*~20B USD\/yr\*\*\. \[\^c1\]/)
  // The canonical line in the citation carries the §9.5 stamp and confidence.
  assert.match(rendered.markdown, /\[\^c1\]: `acme HAS revenue: ~20B USD\/yr @src:cli @ 90%`/)
  store.close()
})

test('WHERE filters ride with the block pattern (spec §12.2)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    '?svc HAS owner: ?who',
    'WHERE context = src:audit',
    '- ?who [^?]',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- shop-team \[\^c1\]/)
  assert.doesNotMatch(rendered.markdown, /platform-team/)
  store.close()
})

test('an unbound ?token passes through — fragments are prose (§29.3 convention)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'acme HAS revenue: ?v',
    '?v — but what about ?margin?',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /~20B USD\/yr — but what about \?margin\?/)
  store.close()
})

test('a query with no solutions renders nothing — the honest empty section', () => {
  const store = fixture()
  const rendered = report(store, [
    '## Violations',
    '```cave-q',
    '?x HAS violation: ?v',
    '- ?x: ?v',
    '```',
    'End.'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, '## Violations\nEnd.\n')
  assert.equal(rendered.citations, 0)
  store.close()
})

test('transitive solutions carry no row and cite nothing (§24.2 rule)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'api-gateway IS+ ?type',
    '- reaches ?type [^?]',
    '```'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /- reaches microservice\n/)
  assert.match(rendered.markdown, /- reaches service\n/)
  assert.equal(rendered.citations, 0)
  assert.doesNotMatch(rendered.markdown, /\[\^/)
  store.close()
})

test('repeated citations of one row share a footnote (spec §31.2)', () => {
  const store = fixture()
  const rendered = report(store, [
    '```cave-q',
    'acme HAS revenue: ?v',
    '```',
    '',
    'Inline again: `cave-q: acme HAS revenue: ?v`.'
  ].join('\n'))
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Inline again: ~20B USD\/yr\[\^c1\]\./)
  assert.equal(rendered.citations, 1)
  assert.equal(rendered.markdown.match(/\[\^c1\]:/g)?.length, 1)
  store.close()
})

test('inline splice: one variable, one solution, value plus citation (spec §31.1)', () => {
  const store = fixture()
  const rendered = report(store, 'Revenue reached `cave-q: acme HAS revenue: ?v` this year.\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Revenue reached ~20B USD\/yr\[\^c1\] this year\./)
  assert.equal(rendered.citations, 1)
  store.close()
})

test('inline splice: contested fact is ambiguous; --resolve picks the §26 winner', () => {
  const store = fixture()
  const ambiguous = report(store, 'Owner: `cave-q: checkout HAS owner: ?who`\n')
  assert.equal(ambiguous.problems.length, 1)
  assert.match(ambiguous.problems[0]!.message, /ambiguous.*2 matches.*--resolve/s)
  assert.equal(ambiguous.problems[0]!.line, 1)
  assert.match(ambiguous.markdown, /Owner: \*\(ambiguous: 2 matches\)\*/)

  // src:cli (class 4) outranks the content source (root class 2).
  const resolved = report(store, 'Owner: `cave-q: checkout HAS owner: ?who`\n', { resolve: true })
  assert.deepEqual(resolved.problems, [])
  assert.match(resolved.markdown, /Owner: payments-team\[\^c1\]/)
  store.close()
})

test('inline splice: no match and wrong variable count are problems', () => {
  const store = fixture()
  const rendered = report(store, [
    'Missing: `cave-q: nobody HAS nothing: ?x`',
    'Two vars: `cave-q: ?svc HAS owner: ?who`',
    'No vars: `cave-q: api-gateway IS service`'
  ].join('\n'))
  assert.equal(rendered.problems.length, 3)
  assert.match(rendered.problems[0]!.message, /no match/)
  assert.equal(rendered.problems[0]!.line, 1)
  assert.match(rendered.problems[1]!.message, /exactly one \?variable, got 2/)
  assert.equal(rendered.problems[1]!.line, 2)
  assert.match(rendered.problems[2]!.message, /exactly one \?variable, got 0/)
  assert.match(rendered.markdown, /Missing: \*\(no match\)\*/)
  assert.match(rendered.markdown, /Two vars: \*\(invalid query\)\*/)
  store.close()
})

test('inline splice: longer delimiters carry a backtick code literal (spec §31.1)', () => {
  const store = open()
  store.ingest('config HAS default: `null`')
  const rendered = report(store, 'Default set on ``cave-q: ?who HAS default: `null` ``.\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Default set on config\[\^c1\]\./)
  assert.equal(rendered.citations, 1)
  // The cited canonical line carries a backtick run, so its footnote
  // definition needs a longer delimiter (and padding) to stay a valid span.
  assert.match(rendered.markdown, /\[\^c1\]: `` config HAS default: `null` `` — \d{4}-\d{2}-\d{2}/)
  store.close()
})

test('inline splice: padded delimiters strip one space each side (CommonMark)', () => {
  const store = fixture()
  const rendered = report(store, 'Revenue: `` cave-q: acme HAS revenue: ?v ``.\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /Revenue: ~20B USD\/yr\[\^c1\]\./)
  store.close()
})

test('a code span quoting the splice syntax stays literal', () => {
  const store = fixture()
  const template = 'The construct is `` `cave-q: <pattern>` `` in prose.\n'
  const rendered = report(store, template)
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, template)
  assert.equal(rendered.citations, 0)
  store.close()
})

test('a stray backtick before a splice keeps CommonMark span boundaries', () => {
  const store = fixture()
  // The first span is ` then ` — the following cave-q: text sits outside
  // any code span (its backtick never closes), so nothing splices.
  const template = 'Tick ` then `cave-q: acme HAS revenue: ?v` done.\n'
  const rendered = report(store, template)
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, template)
  assert.equal(rendered.citations, 0)
  store.close()
})

test('aliases widen matching when opted in (spec §13.6)', () => {
  const store = fixture()
  const plain = report(store, '```cave-q\n?x USES postgres\n- ?x\n```\n')
  assert.doesNotMatch(plain.markdown, /analytics/)
  const closed = report(store, '```cave-q\n?x USES postgres\n- ?x\n```\n', { aliases: true })
  assert.match(closed.markdown, /- billing/)
  assert.match(closed.markdown, /- analytics/)
  store.close()
})

test('asOf renders the report at a past boundary (spec §12.3)', () => {
  const store = open()
  const first = store.ingest('acme HAS revenue: 10B USD/yr @src:cli')
  store.ingest('acme HAS revenue: 20B USD/yr @src:cli')
  const now = report(store, 'Revenue: `cave-q: acme HAS revenue: ?v`\n')
  assert.match(now.markdown, /Revenue: 20B USD\/yr/)
  const then = report(store, 'Revenue: `cave-q: acme HAS revenue: ?v`\n', { asOf: first.ids[0]! })
  assert.deepEqual(then.problems, [])
  assert.match(then.markdown, /Revenue: 10B USD\/yr/)
  store.close()
})

test('other fenced blocks pass through verbatim, splices inside them inert', () => {
  const store = fixture()
  const template = [
    '```cave',
    'auth USES jwt @ 90%',
    '```',
    '~~~',
    'Inert: `cave-q: acme HAS revenue: ?v`',
    '~~~'
  ].join('\n')
  const rendered = report(store, template)
  assert.deepEqual(rendered.problems, [])
  assert.equal(rendered.markdown, `${template}\n`)
  assert.equal(rendered.citations, 0)
  store.close()
})

test('a failing query block is marked in place, not vanished (spec §31.3)', () => {
  const store = fixture()
  const rendered = report(store, [
    'Before.',
    '```cave-q',
    'not-even a-pattern extra tokens here',
    '```',
    'After.'
  ].join('\n'))
  assert.equal(rendered.problems.length, 1)
  assert.equal(rendered.problems[0]!.line, 3)
  // §31.3: the rendered document still emits, problems marked in place —
  // the block must not silently vanish from the output.
  assert.equal(rendered.markdown, 'Before.\n*(invalid query)*\nAfter.\n')
  store.close()
})

test('an empty query block is marked in place, not vanished (spec §31.3)', () => {
  const store = fixture()
  const rendered = report(store, [
    'Before.',
    '```cave-q',
    '```',
    'After.'
  ].join('\n'))
  assert.equal(rendered.problems.length, 1)
  assert.match(rendered.problems[0]!.message, /empty cave-q block/)
  assert.equal(rendered.markdown, 'Before.\n*(invalid query)*\nAfter.\n')
  store.close()
})

test('problems: bad pattern, empty block, unclosed fence — with template lines', () => {
  const store = fixture()
  const rendered = report(store, [
    'Intro.',
    '```cave-q',
    'not-even a-pattern extra tokens here',
    '```',
    '```cave-q',
    '```',
    '```cave-q',
    '?svc IS service'
  ].join('\n'))
  assert.equal(rendered.problems.length, 3)
  assert.equal(rendered.problems[0]!.line, 3)
  assert.match(rendered.problems[1]!.message, /empty cave-q block/)
  assert.match(rendered.problems[2]!.message, /unclosed cave-q block/)
  // The unclosed block still renders its solutions.
  assert.match(rendered.markdown, /- \?svc = api-gateway/)
  store.close()
})

test('longer variable names substitute before shorter prefixes', () => {
  const store = open()
  store.ingest('a REL b')
  const rendered = report(store, '```cave-q\n?x REL ?xl\n?x and ?xl [^?]\n```\n')
  assert.deepEqual(rendered.problems, [])
  assert.match(rendered.markdown, /a and b \[\^c1\]/)
  store.close()
})
