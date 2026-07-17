import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Language, Parser, Query } from 'web-tree-sitter'

test('the packaged query captures trajectory arrows as VS Code operators', async () => {
  await Parser.init({ locateFile: () => resolve('dist/web-tree-sitter.wasm') })
  const language = await Language.load(resolve('dist/tree-sitter-cave.wasm'))
  const query = new Query(language, readFileSync(resolve('dist/highlights.scm'), 'utf8'))
  const parser = new Parser()
  parser.setLanguage(language)
  const source = 'revenue IS 20B -> 40B USD/yr'
  const tree = parser.parse(source)
  assert.ok(tree)

  try {
    const arrow = query.captures(tree.rootNode).find(({ name, node }) =>
      name === 'operator' && source.slice(node.startIndex, node.endIndex) === '->')
    assert.ok(arrow)
  } finally {
    tree.delete()
    query.delete()
    parser.delete()
  }
})
