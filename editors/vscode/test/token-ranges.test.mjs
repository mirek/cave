import { readFileSync } from 'node:fs'
import { Module, createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transform } from 'esbuild'
import * as runtime from 'web-tree-sitter'

const filename = resolve('src/extension.ts')
const { code } = await transform(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' })
const require = createRequire(import.meta.url)

test('real provider preserves UTF-16 ranges across Unicode, CRLF and incomplete edits', async () => {
  let provider
  const host = {
    SemanticTokensLegend: class { constructor(types) { this.tokenTypes = types } },
    Range: class {
      constructor(row, column, endRow, endColumn) {
        this.start = { line: row, character: column }
        this.end = { line: endRow, character: endColumn }
      }
    },
    SemanticTokens: class { constructor(data) { this.data = data } },
    SemanticTokensBuilder: class {
      tokens = []
      push(range, type) { this.tokens.push({ range, type }) }
      build() { return this.tokens }
    },
    languages: {
      registerDocumentSemanticTokensProvider(_selector, value) {
        provider = value
        return { dispose() {} }
      }
    }
  }
  const module = new Module(filename)
  module.filename = filename
  module.require = name => name === 'vscode' ? host : name === 'web-tree-sitter' ? runtime : require(name)
  module._compile(code, filename)
  const context = { subscriptions: [], asAbsolutePath: path => resolve(path) }
  await module.exports.activate(context)
  try {
    const lines = [
      '𐐀pi HAS label: "🚀 database" @production ; café',
      'café USES postgres',
      'broken HAS label: "unfinished',
      'next IS service'
    ]
    const tokens = provider.provideDocumentSemanticTokens({ getText: () => lines.join('\r\n') })
    const pieces = tokens.map(({ range, type }) => {
      assert.equal(range.start.line, range.end.line)
      const line = lines[range.start.line]
      assert.ok(line !== undefined)
      assert.ok(range.start.character >= 0)
      assert.ok(range.end.character > range.start.character)
      assert.ok(range.end.character <= line.length)
      return { type, text: line.slice(range.start.character, range.end.character) }
    })
    for (const [type, text] of [
      ['variable', '𐐀pi'], ['keyword', 'HAS'], ['string', '"🚀 database"'],
      ['macro', '@production'], ['comment', '; café'], ['variable', 'café'],
      ['keyword', 'USES'], ['keyword', 'IS']
    ]) assert.ok(pieces.some(piece => piece.type === type && piece.text === text), `${type}: ${text}`)
    const ordered = [...tokens].sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character)
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1].range
      const current = ordered[i].range
      assert.ok(previous.end.line < current.start.line || previous.end.character <= current.start.character,
        'semantic token ranges do not overlap')
    }
  } finally {
    for (const subscription of context.subscriptions) subscription.dispose()
  }
})
