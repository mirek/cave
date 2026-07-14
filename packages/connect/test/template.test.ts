import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Value } from '@cavelang/core'
import { Template } from '@cavelang/connect'

const mappingText = [
  '; people mapping',
  'WORKS-AT IS verb ; X is employed by organization Y',
  'WORKS-AT REVERSE EMPLOYS',
  '',
  '?id IS person',
  '?id HAS name: ?name',
  '?id WORKS-AT ?company',
  '  VIA ?channel'
].join('\n')

test('mapping splits into prelude and record templates (spec §23.1)', () => {
  const { mapping, problems } = Template.parse(mappingText)
  assert.equal(problems.length, 0)
  assert.ok(mapping)
  assert.match(mapping.prelude, /WORKS-AT IS verb/)
  assert.match(mapping.prelude, /WORKS-AT REVERSE EMPLOYS/)
  assert.doesNotMatch(mapping.prelude, /\?id/)
  assert.equal(mapping.templates.length, 3)
  assert.deepEqual(mapping.variables, ['channel', 'company', 'id', 'name'])
})

test('mapping lint rejects real syntax problems and attribute variables', () => {
  const attribute = Template.parse('?id HAS ?attr: ?value')
  assert.equal(attribute.mapping, undefined)
  assert.match(attribute.problems[0]!, /variables cannot name attributes/)

  const syntax = Template.parse('?id lowercase-verb ?x')
  assert.equal(syntax.mapping, undefined)
  assert.ok(syntax.problems.length > 0)
})

test('formatValue: atoms verbatim, everything else quoted exactly (spec §23.1)', () => {
  const okText = (value: unknown, position: 'subject' | 'payload' = 'payload'): string => {
    const formatted = Template.formatValue(value, position)
    assert.equal(formatted.kind, 'ok')
    return (formatted as { text: string }).text
  }
  assert.equal(okText(42), '42')
  assert.equal(okText(true), 'true')
  assert.equal(okText('acme'), 'acme')
  assert.equal(okText('auth/middleware'), 'auth/middleware')
  assert.equal(okText('PostgreSQL'), 'PostgreSQL')
  // Payload position keeps CAVE values (§7.1) as values.
  assert.equal(okText('20B USD/yr'), '20B USD/yr')
  assert.equal(okText('2026-Q1'), '2026-Q1')
  assert.equal(okText('94.5%'), '94.5%')
  // Subject position takes single safe tokens only.
  assert.equal(okText('20B USD/yr', 'subject'), '"20B USD/yr"')
  // Verb-shaped and reserved words quote — they would change line meaning.
  assert.equal(okText('NOT'), '"NOT"')
  assert.equal(okText('WHEN'), '"WHEN"')
  assert.equal(okText('Alice Liddell'), '"Alice Liddell"')
  assert.equal(okText('say "hi"'), '`say "hi"`')
  // Newlines collapse — CAVE is line-oriented.
  assert.equal(okText('two\nlines'), '"two lines"')
  assert.deepEqual(Template.formatValue('both " and `', 'payload').kind, 'problem')
  assert.deepEqual(Template.formatValue('', 'payload').kind, 'missing')
  assert.deepEqual(Template.formatValue(null, 'payload').kind, 'missing')
  assert.deepEqual(Template.formatValue({ nested: true }, 'payload').kind, 'problem')
})

test('formatValue: tiny and huge JSON numbers emit CAVE-parseable decimals (exponent-notation bug)', () => {
  const okText = (value: unknown): string => {
    const formatted = Template.formatValue(value, 'payload')
    assert.equal(formatted.kind, 'ok')
    return (formatted as { text: string }).text
  }
  // String(1e-7) is '1e-7' — CAVE's number grammar has no exponent form,
  // so that text would round-trip as an atom and break filters and fusion.
  assert.equal(okText(1e-7), '0.0000001')
  assert.equal(okText(-1.5e-7), '-0.00000015')
  assert.equal(okText(1.5e21), '1500000000000000000000')
  for (const n of [1e-7, -1.5e-7, 1.5e21]) {
    const parsed = Value.parse(okText(n))
    assert.equal(parsed.kind, 'number')
    assert.equal(parsed.num, n)
  }
})

test('instantiate substitutes fields and drops missing lines with children (spec §23.1)', () => {
  const { mapping } = Template.parse(mappingText)
  const full = Template.instantiate(mapping!.templates, name =>
    ({ id: 'alice', name: 'Alice Liddell', company: 'acme', channel: 'referral' })[name])
  assert.equal(full.problems.length, 0)
  assert.equal(full.dropped, 0)
  assert.deepEqual(full.text.trimEnd().split('\n'), [
    'alice IS person',
    'alice HAS name: "Alice Liddell"',
    'alice WORKS-AT acme',
    '  VIA referral'
  ])

  // A missing field drops the claim line and its indented children.
  const partial = Template.instantiate(mapping!.templates, name =>
    ({ id: 'bob', name: 'Bob' })[name])
  assert.deepEqual(partial.text.trimEnd().split('\n'), [
    'bob IS person',
    'bob HAS name: Bob'
  ])
  assert.equal(partial.dropped, 2)
})

test('instantiate keeps comments and reports formatting problems', () => {
  const { mapping } = Template.parse('?id HAS note: ?note ; imported')
  const noted = Template.instantiate(mapping!.templates, () => 'fine')
  assert.equal(noted.text.trimEnd(), 'fine HAS note: fine ; imported')

  const broken = Template.instantiate(mapping!.templates, name =>
    name === 'note' ? 'both " and `' : 'fine')
  assert.equal(broken.problems.length, 1)
  assert.match(broken.problems[0]!, /\?note/)
})

test('fieldOf resolves exact keys first, then dot paths into nested JSON', () => {
  const record = { 'a.b': 'exact', a: { b: 'nested' }, items: [{ sku: 'x1' }] }
  assert.equal(Template.fieldOf(record, 'a.b'), 'exact')
  assert.equal(Template.fieldOf(record, 'items.0.sku'), 'x1')
  assert.equal(Template.fieldOf(record, 'missing.path'), undefined)
})

test('variables inside literals are never substituted (spec §23.1)', () => {
  const { mapping } = Template.parse('?id HAS greeting: "hello ?name"')
  assert.deepEqual(mapping!.variables, ['id'])
  const out = Template.instantiate(mapping!.templates, () => 'x')
  assert.equal(out.text.trimEnd(), 'x HAS greeting: "hello ?name"')
})
