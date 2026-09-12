import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '@cavelang/eval'
import { open } from '@cavelang/store'

for (const mode of ['cancel', 'cancel-unprintable', 'fixture-read', 'remove-only', 'keep'] as const) test(`evaluation retains its failure through root cleanup: ${mode}`, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-root-test-'))
  const golden = join(dir, 'source.golden.cave')
  fs.writeFileSync(join(dir, 'source.md'), 'A local fixture')
  fs.writeFileSync(golden, 'item IS retained')
  const operation = new Error('evaluation operation failed'), cleanup = new Error('evaluation root removal failed')
  if (mode === 'cancel-unprintable') {
    Object.defineProperty(operation, 'message', { value: Object.create(null) })
    Object.defineProperty(cleanup, 'message', { get() { throw new Error('message unavailable') } })
  }
  const controller = new AbortController()
  let root = '', removals = 0, calls = 0, runDb = ''
  try {
    const mkdir = fs.mkdtempSync, remove = fs.rmSync, read = fs.readFileSync
    t.mock.method(fs, 'mkdtempSync', ((prefix, ...args) => {
      const created = Reflect.apply(mkdir, fs, [prefix, ...args])
      if (String(prefix).endsWith('cave-eval-')) root = String(created)
      return created
    }) as typeof fs.mkdtempSync)
    t.mock.method(fs, 'rmSync', ((path, options) => {
      remove(path, options)
      if (String(path) === root) { removals++; throw cleanup }
    }) as typeof fs.rmSync)
    t.mock.method(fs, 'readFileSync', ((path, ...args) => {
      if (mode === 'fixture-read' && String(path) === golden) { assert.notEqual(root, ''); throw operation }
      return Reflect.apply(read, fs, [path, ...args])
    }) as typeof fs.readFileSync)
    syncBuiltinESMExports()
    await assert.rejects(run({ suites: [dir], mode: 'stdout', keep: mode === 'keep', signal: controller.signal,
      agent: async (_prompt, _files, context) => {
        calls++
        runDb = context.db
        if (mode.startsWith('cancel') || mode === 'keep') controller.abort(operation)
        return 'item IS retained'
      }
    }), error => {
      if (mode === 'keep') assert.equal(error, operation)
      else if (mode === 'remove-only') assert.equal(error, cleanup)
      else {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [operation, cleanup])
        assert.equal(error.cause, operation)
        if (mode === 'cancel-unprintable') assert.equal(error.message, '[unprintable thrown value]; evaluation cleanup also failed: [unprintable thrown value]')
        else {
          assert.ok(error.message.includes(operation.message))
          assert.ok(error.message.includes(cleanup.message))
        }
      }
      return true
    })
    assert.equal(calls, mode === 'fixture-read' ? 0 : 1)
    assert.equal(removals, mode === 'keep' ? 0 : 1)
    assert.equal(fs.existsSync(root), mode === 'keep')
    if (mode === 'keep') {
      const reopened = open(runDb)
      try { reopened.ingest('caller IS usable') } finally { reopened.close() }
    }
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports()
    if (root) fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
