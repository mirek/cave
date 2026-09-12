import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Language, Parser, Query } from 'web-tree-sitter'
import { createHighlighter, highlighter as sharedHighlighter } from '@cavelang/highlight'

test('failed parser setup releases the parser and compiled query', async t => {
  await Parser.init()
  const language = await Language.load(fileURLToPath(import.meta.resolve('@cavelang/tree-sitter-cave/wasm')))
  const parserDelete = t.mock.method(Parser.prototype, 'delete')
  const queryDelete = t.mock.method(Query.prototype, 'delete')
  const setup = t.mock.method(Parser.prototype, 'setLanguage', () => {
    throw new Error('injected parser setup failure')
  })
  assert.throws(() => createHighlighter(language, ''), /injected parser setup failure/)
  assert.equal(parserDelete.mock.callCount(), 1)
  assert.equal(queryDelete.mock.callCount(), 1)
  setup.mock.restore()
})

test('owned highlighters release resources once and reject use after close', async t => {
  await Parser.init()
  const language = await Language.load(fileURLToPath(import.meta.resolve('@cavelang/tree-sitter-cave/wasm')))
  const parserDelete = t.mock.method(Parser.prototype, 'delete')
  const queryDelete = t.mock.method(Query.prototype, 'delete')
  const parse = t.mock.method(Parser.prototype, 'parse')
  const owned = createHighlighter(language, '')
  t.after(() => owned.close())
  assert.deepEqual(owned.spans('api IS service'), [])
  assert.equal(owned.ansi('api IS service'), 'api IS service')
  const calls = parse.mock.callCount()
  owned.close()
  owned.close()
  assert.equal(parserDelete.mock.callCount(), 1)
  assert.equal(queryDelete.mock.callCount(), 1)
  assert.throws(() => owned.spans('api IS service'), /Highlighter is closed/)
  assert.throws(() => owned.ansi('api IS service'), /Highlighter is closed/)
  assert.equal(parse.mock.callCount(), calls)
})

test('the shared process highlighter does not expose caller-owned cleanup', async () => {
  const first = await sharedHighlighter()
  assert.equal('close' in first, false)
  assert.equal(await sharedHighlighter(), first)
  assert.ok(first.spans('api IS service').length > 0)
})

test('failed highlighter setup retains setup and both cleanup failures', async t => {
  await Parser.init()
  const language = await Language.load(fileURLToPath(import.meta.resolve('@cavelang/tree-sitter-cave/wasm')))
  const setupFailure = new Error('setup failed'), parserFailure = new Error('parser cleanup failed'), queryFailure = new Error('query cleanup failed')
  const deleteParser = Parser.prototype.delete, deleteQuery = Query.prototype.delete
  t.mock.method(Parser.prototype, 'setLanguage', () => { throw setupFailure })
  const parserDelete = t.mock.method(Parser.prototype, 'delete', function (this: Parser) { deleteParser.call(this); throw parserFailure })
  const queryDelete = t.mock.method(Query.prototype, 'delete', function (this: Query) { deleteQuery.call(this); throw queryFailure })
  assert.throws(() => createHighlighter(language, ''), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.cause, setupFailure)
    assert.equal(error.errors[0], setupFailure)
    const cleanup = error.errors[1]
    assert.ok(cleanup instanceof AggregateError)
    assert.deepEqual(cleanup.errors, [parserFailure, queryFailure])
    return true
  })
  assert.equal(parserDelete.mock.callCount(), 1)
  assert.equal(queryDelete.mock.callCount(), 1)
})

test('highlighter capture and tree cleanup failures remain available together', async t => {
  await Parser.init()
  const language = await Language.load(fileURLToPath(import.meta.resolve('@cavelang/tree-sitter-cave/wasm')))
  const owned = createHighlighter(language, '')
  const captureFailure = new Error('capture failed'), treeFailure = new Error('tree cleanup failed')
  const parse = Parser.prototype.parse
  let deletions = 0
  t.mock.method(Parser.prototype, 'parse', function (this: Parser, ...args: Parameters<typeof parse>) {
    const tree = parse.apply(this, args)!
    const remove = tree.delete.bind(tree)
    t.mock.method(tree, 'delete', () => { deletions++; remove(); throw treeFailure })
    return tree
  })
  t.mock.method(Query.prototype, 'captures', () => { throw captureFailure })
  try {
    assert.throws(() => owned.spans('a IS b'), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, captureFailure)
      assert.deepEqual(error.errors, [captureFailure, treeFailure])
      return true
    })
    assert.equal(deletions, 1)
  } finally { owned.close() }
})

test('highlighter close retains both failures and prevents resource reuse or repeated cleanup', async t => {
  await Parser.init()
  const language = await Language.load(fileURLToPath(import.meta.resolve('@cavelang/tree-sitter-cave/wasm')))
  const owned = createHighlighter(language, '')
  const parserFailure = new Error('parser cleanup failed'), queryFailure = new Error('query cleanup failed')
  const deleteParser = Parser.prototype.delete, deleteQuery = Query.prototype.delete
  const parserDelete = t.mock.method(Parser.prototype, 'delete', function (this: Parser) { deleteParser.call(this); throw parserFailure })
  const queryDelete = t.mock.method(Query.prototype, 'delete', function (this: Query) { deleteQuery.call(this); throw queryFailure })
  assert.throws(() => owned.close(), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.cause, parserFailure)
    assert.deepEqual(error.errors, [parserFailure, queryFailure])
    return true
  })
  assert.doesNotThrow(() => owned.close())
  assert.throws(() => owned.spans('a IS b'), /closed/)
  assert.throws(() => owned.ansi('a IS b'), /closed/)
  assert.equal(parserDelete.mock.callCount(), 1)
  assert.equal(queryDelete.mock.callCount(), 1)
})
