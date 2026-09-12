import { readFileSync } from 'node:fs'
import { Module, createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transform } from 'esbuild'

// Execute the extension source with host/resource doubles. The packaged-query
// test separately exercises the real grammar and WASM assets.
const filename = resolve('src/extension.ts')
const { code } = await transform(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' })
const require = createRequire(import.meta.url)

function extension(failure) {
  const events = []
  const failures = new Set(Array.isArray(failure) ? failure : [failure])
  let provider
  const host = {
    SemanticTokensLegend: class { constructor(types) { this.tokenTypes = types } },
    SemanticTokens: class { constructor(data) { this.data = data } },
    SemanticTokensBuilder: class {
      constructor() { if (failures.has('builder')) throw new Error('builder failed') }
      build() {
        if (failures.has('build')) throw new Error('build failed')
        return { data: new Uint32Array() }
      }
    },
    languages: {
      registerDocumentSemanticTokensProvider(_selector, value) {
        if (failures.has('register')) throw new Error('registration failed')
        provider = value
        return { dispose() {
          events.push('unregister')
          if (failures.has('unregister')) throw new Error('unregistration failed')
        } }
      },
    },
  }
  const runtime = {
    Language: { async load() { return {} } },
    Parser: class {
      static async init() {}
      constructor() {
        if (failures.has('parser')) throw new Error('parser allocation failed')
        events.push('parser allocated')
      }
      setLanguage() { if (failures.has('language')) throw new Error('incompatible language') }
      parse() {
        events.push('parse')
        return { rootNode: {}, delete() {
          events.push('tree deleted')
          if (failures.has('tree-delete')) throw new Error('tree deletion failed')
        } }
      }
      delete() {
        events.push('parser deleted')
        if (failures.has('delete')) throw new Error('parser deletion failed')
      }
    },
    Query: class {
      constructor() { events.push('query allocated') }
      captures() {
        if (failures.has('captures')) throw new Error('query failed')
        return []
      }
      delete() {
        events.push('query deleted')
        if (failures.has('query-delete')) throw new Error('query deletion failed')
      }
    },
  }
  const module = new Module(filename)
  module.filename = filename
  module.require = name => name === 'vscode' ? host : name === 'web-tree-sitter' ? runtime : require(name)
  module._compile(code, filename)
  const context = { subscriptions: [], asAbsolutePath: path => resolve(path) }
  return { activate: () => module.exports.activate(context), context, events, provider: () => provider }
}

test('extension disposal unregisters tokens and releases native resources exactly once', async () => {
  const fixture = extension()
  await fixture.activate()
  const provider = fixture.provider()
  provider.provideDocumentSemanticTokens({ getText: () => 'a IS b' })
  assert.equal(fixture.events.filter(event => event === 'tree deleted').length, 1)
  for (const subscription of fixture.context.subscriptions) {
    subscription.dispose()
    subscription.dispose()
  }
  assert.deepEqual(fixture.events.slice(-3), ['unregister', 'parser deleted', 'query deleted'])
  assert.equal(fixture.events.filter(event => event === 'parser deleted').length, 1)
  assert.equal(fixture.events.filter(event => event === 'query deleted').length, 1)
  const before = [...fixture.events]
  assert.equal(provider.provideDocumentSemanticTokens({ getText: () => assert.fail('disposed provider read') }).data.length, 0)
  assert.deepEqual(fixture.events, before)
})

test('cancelled token requests skip document reads and preserve subsequent requests', async () => {
  const fixture = extension()
  await fixture.activate()
  try {
    const before = [...fixture.events]
    const result = fixture.provider().provideDocumentSemanticTokens(
      { getText: () => assert.fail('cancelled request read the document') },
      { isCancellationRequested: true }
    )
    assert.equal(result.data.length, 0)
    assert.deepEqual(fixture.events, before)
    fixture.provider().provideDocumentSemanticTokens(
      { getText: () => 'a IS b' }, { isCancellationRequested: false }
    )
    assert.deepEqual(fixture.events.slice(-2), ['parse', 'tree deleted'])
  } finally { fixture.context.subscriptions[0].dispose() }
})

for (const failure of ['language', 'register']) {
  test(`failed ${failure} setup releases allocated native resources`, async () => {
    const fixture = extension(failure)
    await assert.rejects(fixture.activate())
    assert.deepEqual(fixture.events.slice(-2), ['parser deleted', 'query deleted'])
    assert.equal(fixture.context.subscriptions.length, 0)
  })
}

test('query failure releases the per-document tree and preserves extension cleanup', async () => {
  const fixture = extension('captures')
  await fixture.activate()
  assert.throws(() => fixture.provider().provideDocumentSemanticTokens({ getText: () => 'a IS b' }), /query failed/)
  assert.equal(fixture.events.at(-1), 'tree deleted')
  fixture.context.subscriptions[0].dispose()
  assert.deepEqual(fixture.events.slice(-3), ['unregister', 'parser deleted', 'query deleted'])
})

test('host unregistration failure still releases native resources', async () => {
  const fixture = extension('unregister')
  await fixture.activate()
  assert.throws(() => fixture.context.subscriptions[0].dispose(), /unregistration failed/)
  assert.deepEqual(fixture.events.slice(-3), ['unregister', 'parser deleted', 'query deleted'])
  assert.doesNotThrow(() => fixture.context.subscriptions[0].dispose())
})

test('parser construction failure releases the previously allocated query', async () => {
  const fixture = extension('parser')
  await assert.rejects(fixture.activate(), /parser allocation failed/)
  assert.deepEqual(fixture.events, ['query allocated', 'query deleted'])
  assert.equal(fixture.context.subscriptions.length, 0)
})

for (const failure of ['builder', 'build']) {
  test(`token ${failure} failure releases the document tree`, async () => {
    const fixture = extension(failure)
    await fixture.activate()
    try {
      assert.throws(
        () => fixture.provider().provideDocumentSemanticTokens({ getText: () => 'a IS b' }),
        new RegExp(`${failure} failed`)
      )
      assert.deepEqual(fixture.events.slice(-2), ['parse', 'tree deleted'])
    } finally { fixture.context.subscriptions[0].dispose() }
    assert.deepEqual(fixture.events.slice(-3), ['unregister', 'parser deleted', 'query deleted'])
  })
}

test('parser disposal failure still frees the query and prevents later document reads', async () => {
  const fixture = extension('delete')
  await fixture.activate()
  assert.throws(() => fixture.context.subscriptions[0].dispose(), /parser deletion failed/)
  assert.deepEqual(fixture.events.slice(-3), ['unregister', 'parser deleted', 'query deleted'])
  const before = [...fixture.events]
  assert.doesNotThrow(() => fixture.context.subscriptions[0].dispose())
  assert.equal(fixture.provider().provideDocumentSemanticTokens({
    getText: () => assert.fail('disposed provider read'),
  }).data.length, 0)
  assert.deepEqual(fixture.events, before)
})


test('activation retains its original failure when native cleanup also fails', async () => {
  const fixture = extension(['language', 'delete', 'query-delete'])
  await assert.rejects(fixture.activate(), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.cause, error.errors[0])
    assert.equal(error.errors[0].message, 'incompatible language')
    const cleanup = error.errors[1]
    assert.ok(cleanup instanceof AggregateError)
    assert.deepEqual(cleanup.errors.map(error => error.message), ['parser deletion failed', 'query deletion failed'])
    return true
  })
  assert.deepEqual(fixture.events.slice(-2), ['parser deleted', 'query deleted'])
  assert.equal(fixture.context.subscriptions.length, 0)
})

test('token generation retains query and tree-cleanup failures together', async () => {
  const fixture = extension(['captures', 'tree-delete'])
  await fixture.activate()
  try {
    assert.throws(() => fixture.provider().provideDocumentSemanticTokens({ getText: () => 'a IS b' }), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, error.errors[0])
      assert.deepEqual(error.errors.map(error => error.message), ['query failed', 'tree deletion failed'])
      return true
    })
    assert.equal(fixture.events.filter(event => event === 'tree deleted').length, 1)
  } finally { fixture.context.subscriptions[0].dispose() }
})

test('disposal retains every failure in cleanup order and never retries resources', async () => {
  const fixture = extension(['unregister', 'delete', 'query-delete'])
  await fixture.activate()
  assert.throws(() => fixture.context.subscriptions[0].dispose(), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.cause, error.errors[0])
    assert.deepEqual(error.errors.map(error => error.message), [
      'unregistration failed', 'parser deletion failed', 'query deletion failed'
    ])
    return true
  })
  const before = [...fixture.events]
  assert.doesNotThrow(() => fixture.context.subscriptions[0].dispose())
  assert.equal(fixture.provider().provideDocumentSemanticTokens({ getText: () => assert.fail('disposed read') }).data.length, 0)
  assert.deepEqual(fixture.events, before)
})
