import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createBrowserHighlighter } from '@cavelang/highlight/browser'

const resolvePath = (specifier: string): string =>
  fileURLToPath(import.meta.resolve(specifier))

test('browser entry loads emitted WASM assets and the shared query', async () => {
  const highlighter = await createBrowserHighlighter({
    parserWasmUrl: resolvePath('web-tree-sitter/web-tree-sitter.wasm'),
    languageWasmUrl: resolvePath('@cavelang/tree-sitter-cave/wasm'),
    querySource: readFileSync(resolvePath('@cavelang/tree-sitter-cave/highlights'), 'utf8'),
  })
  const source = 'server IS NOT compromised @ 90% #security'
  const captures = new Map(highlighter.spans(source).map(span => [
    `${span.capture}:${source.slice(span.start, span.end)}`,
    true,
  ]))

  assert.equal(captures.get('keyword:IS'), true)
  assert.equal(captures.get('keyword.operator:NOT'), true)
  assert.equal(captures.get('constant:@ 90%'), true)
  assert.equal(captures.get('tag:security'), true)
})
