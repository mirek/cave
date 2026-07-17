import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { defaultTheme, highlighter, paint, type Span } from '@cavelang/highlight'

const textOf = (input: string, span: Span): string =>
  input.slice(span.start, span.end)

test('captures a full claim line (spec §3.2)', async () => {
  const input = 'auth/middleware USES jwt @staging @ 90% #security ! ; note'
  const spans = (await highlighter()).spans(input)
  const byCapture = new Map(spans.map(span => [span.capture, textOf(input, span)]))
  assert.equal(byCapture.get('keyword'), 'USES')
  assert.equal(byCapture.get('label'), '@staging')
  assert.equal(byCapture.get('constant'), '@ 90%')
  assert.equal(byCapture.get('tag'), 'security')
  assert.equal(byCapture.get('operator'), '!')
  assert.equal(byCapture.get('comment'), '; note')
  assert.deepEqual(
    spans.filter(span => span.capture === 'variable').map(span => textOf(input, span)),
    ['auth/middleware', 'jwt']
  )
})

test('captures values, units and uncertainty (spec §7)', async () => {
  const input = 'OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr (1σ)'
  const spans = (await highlighter()).spans(input)
  const of = (capture: string): string[] =>
    spans.filter(span => span.capture === capture).map(span => textOf(input, span))
  assert.deepEqual(of('property'), ['revenue:'])
  assert.deepEqual(of('number'), ['~20B', '2B'])
  assert.deepEqual(of('type'), ['USD/yr', 'USD/yr'])
  assert.deepEqual(of('operator'), ['+/-'])
  assert.deepEqual(of('constant'), ['(1σ)'])
})

test('captures trajectory arrows as operators', async () => {
  const input = 'revenue IS 20B -> 40B USD/yr'
  const spans = (await highlighter()).spans(input)
  const operators = spans
    .filter(span => span.capture === 'operator')
    .map(span => textOf(input, span))
  assert.deepEqual(operators, ['->'])
})

test('qualifier keywords and negation (spec §8.2)', async () => {
  const input = 'server CAUSE crash\n  WHEN NOT cache/enabled'
  const spans = (await highlighter()).spans(input)
  const keywords = spans
    .filter(span => span.capture.startsWith('keyword'))
    .map(span => textOf(input, span))
  assert.deepEqual(keywords, ['CAUSE', 'WHEN', 'NOT'])
})

test('highlights negative values and Unicode entities without grammar gaps', async () => {
  const input = 'München HAS température: -3.5 C\n東京 CONTAINS 渋谷'
  const spans = (await highlighter()).spans(input)
  const of = (capture: string): string[] =>
    spans.filter(span => span.capture === capture).map(span => textOf(input, span))
  assert.deepEqual(of('variable'), ['München', '東京', '渋谷'])
  assert.deepEqual(of('property'), ['température:'])
  assert.deepEqual(of('number'), ['-3.5'])
})

test('spans are disjoint and ordered', async () => {
  const input = 'deploy NEEDS docker #env:prod ; staged\npool HAS max: 20 conn'
  const spans = (await highlighter()).spans(input)
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i]!.start >= spans[i - 1]!.end)
  }
})

test('ansi renders colors and resets; plain text passes through', async () => {
  const { ansi } = await highlighter()
  const out = ansi('jwt IS token-format')
  assert.ok(out.includes(`\u001B[${defaultTheme['keyword']}mIS\u001B[0m`))
  assert.ok(out.endsWith('token-format'))
  assert.equal(out.replaceAll(/\u001B\[[0-9;]*m/gu, ''), 'jwt IS token-format')
  assert.equal(ansi(''), '')
})

test('paint respects a custom theme and skips unthemed captures', () => {
  const spans: Span[] = [{ start: 4, end: 6, capture: 'keyword' }]
  assert.equal(paint('jwt IS x', spans, { keyword: '1' }), 'jwt \u001B[1mIS\u001B[0m x')
  assert.equal(paint('jwt IS x', spans, {}), 'jwt IS x')
})
