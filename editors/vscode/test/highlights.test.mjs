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

test('the packaged query distinguishes explicit claim markers from contexts', async () => {
  await Parser.init({ locateFile: () => resolve('dist/web-tree-sitter.wasm') })
  const language = await Language.load(resolve('dist/tree-sitter-cave.wasm'))
  const query = new Query(language, readFileSync(resolve('dist/highlights.scm'), 'utf8'))
  const parser = new Parser()
  parser.setLanguage(language)
  const source = '@claim WHEN EXISTS @claim'
  const tree = parser.parse(source)
  assert.ok(tree)
  try {
    const captures = query.captures(tree.rootNode)
    assert.ok(captures.some(({ name, node }) => name === 'keyword' && node.text === '@claim'))
    assert.ok(captures.some(({ name, node }) => name === 'label' && node.text === '@claim'))
    assert.ok(captures.some(({ name, node }) => name === 'variable' && node.text === 'WHEN'))
  } finally { tree.delete(); query.delete(); parser.delete() }
})


test('the packaged grammar treats explicit numeric-looking subjects as entities', async () => {
  await Parser.init({ locateFile: () => resolve('dist/web-tree-sitter.wasm') })
  const language = await Language.load(resolve('dist/tree-sitter-cave.wasm'))
  const query = new Query(language, readFileSync(resolve('dist/highlights.scm'), 'utf8'))
  const parser = new Parser()
  parser.setLanguage(language)
  try {
    for (const subject of ['42', '2026-01-01', '-1', '3.14']) {
      const tree = parser.parse(`@claim ${subject} EXISTS`)
      assert.ok(tree)
      try {
        assert.equal(tree.rootNode.hasError, false)
        const captures = query.captures(tree.rootNode)
        assert.ok(captures.some(({ name, node }) => name === 'keyword' && node.text === '@claim'))
        assert.ok(captures.some(({ name, node }) => name === 'variable' && node.text === subject))
        assert.ok(!captures.some(({ name }) => name === 'number'))
      } finally { tree.delete() }
    }
  } finally { query.delete(); parser.delete() }
})
