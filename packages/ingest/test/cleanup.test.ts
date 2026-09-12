import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { open } from '@cavelang/store'
import { run, writeMcpConfig } from '../src/run.ts'

const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error]
const cases = [
  { name: 'strict all failures', policy: 'strict', work: true, prompt: true, close: true, stage: true },
  { name: 'strict unprintable failures', policy: 'strict', work: true, prompt: true, close: true, stage: true, unprintable: true },
  { name: 'strict work and close', policy: 'strict', work: true, prompt: false, close: true, stage: false },
  { name: 'strict close and removal', policy: 'strict', work: false, prompt: false, close: true, stage: true },
  { name: 'strict removal after commit', policy: 'strict', work: false, prompt: false, close: false, stage: true },
  { name: 'lenient work and removal', policy: 'lenient', work: true, prompt: true, close: false, stage: false },
  { name: 'lenient removal after commit', policy: 'lenient', work: false, prompt: true, close: false, stage: false },
] as const
for (const fixture of cases) test(`ingestion cleanup retains ordered failures: ${fixture.name}`, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-ingest-cleanup-test-'))
  const db = join(dir, 'target.db'), store = open(db)
  store.ingest('local IS retained')
  fs.writeFileSync(join(dir, 'source.md'), 'Local source material')
  const operation = new Error('operation cancelled'), promptError = new Error('prompt removal failed')
  const closeError = new Error('stage close failed'), stageError = new Error('stage removal failed')
  if ('unprintable' in fixture) {
    Object.defineProperty(operation, 'message', { value: Object.create(null) })
    Object.defineProperty(promptError, 'message', { get() { throw new Error('message unavailable') } })
  }
  const controller = new AbortController()
  let promptDir = '', stageDir = '', agentCalled = false, closes = 0
  const removals: string[] = []
  try {
    const mkdir = fs.mkdtempSync, remove = fs.rmSync, close = DatabaseSync.prototype.close
    t.mock.method(fs, 'mkdtempSync', ((prefix, ...args) => {
      const created = Reflect.apply(mkdir, fs, [prefix, ...args])
      if (String(prefix).endsWith('cave-prompt-')) promptDir = String(created)
      if (String(prefix).endsWith('cave-ingest-stage-')) stageDir = String(created)
      return created
    }) as typeof fs.mkdtempSync)
    t.mock.method(fs, 'rmSync', ((path, options) => {
      remove(path, options)
      if (String(path) === promptDir) { removals.push('prompt'); if (fixture.prompt) throw promptError }
      if (String(path) === stageDir) { removals.push('stage'); if (fixture.stage) throw stageError }
    }) as typeof fs.rmSync)
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const location = this.location()
      close.call(this)
      if (agentCalled && location !== null && stageDir !== '' && fs.realpathSync(location) === fs.realpathSync(join(stageDir, 'stage.db'))) {
        closes++
        if (fixture.close) throw closeError
      }
    })
    syncBuiltinESMExports()
    const expected = [fixture.work && operation, fixture.prompt && promptError, fixture.close && closeError, fixture.stage && stageError].filter(Boolean)
    await assert.rejects(run({ db, store, cwd: dir, patterns: ['source.md'], mode: 'stdout', policy: fixture.policy,
      signal: controller.signal, agent: async () => {
        agentCalled = true
        if (fixture.work) controller.abort(operation)
        return 'accepted IS retained'
      }
    }), error => {
      assert.deepEqual(leaves(error), expected)
      if (expected.length === 1) assert.equal(error, expected[0])
      else {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.cause, error.errors[0])
        if ('unprintable' in fixture) {
          assert.ok(error.message.includes('[unprintable thrown value]'))
          assert.ok(error.message.includes(closeError.message))
          assert.ok(error.message.includes(stageError.message))
        } else for (const expectedError of expected) assert.ok(error.message.includes((expectedError as Error).message))
      }
      return true
    })
    assert.equal(agentCalled, true)
    assert.deepEqual(removals, fixture.policy === 'strict' ? ['prompt', 'stage'] : ['prompt'])
    assert.equal(closes, fixture.policy === 'strict' ? 1 : 0)
    assert.equal(fs.existsSync(promptDir), false)
    if (stageDir !== '') assert.equal(fs.existsSync(stageDir), false)
    const committed = !fixture.work && (fixture.policy === 'lenient' || !fixture.close)
    assert.equal(store.exportText({ current: true }).includes('accepted IS retained'), committed)
    store.ingest('caller IS usable')
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports()
    store.close(); fs.rmSync(dir, { recursive: true, force: true })
    for (const path of [promptDir, stageDir]) if (path) fs.rmSync(path, { recursive: true, force: true })
  }
})

test('standalone configuration keeps write failure when owned-directory removal fails', t => {
  const writing = new Error('configuration write failed'), removing = new Error('configuration removal failed')
  let directory = '', removals = 0
  try {
    const mkdir = fs.mkdtempSync, remove = fs.rmSync, write = fs.writeFileSync
    t.mock.method(fs, 'mkdtempSync', ((prefix, ...args) => {
      const created = Reflect.apply(mkdir, fs, [prefix, ...args])
      if (String(prefix).endsWith('cave-ingest-')) directory = String(created)
      return created
    }) as typeof fs.mkdtempSync)
    t.mock.method(fs, 'writeFileSync', ((path, ...args) => {
      if (basename(String(path)) === 'cave-mcp.json') throw writing
      return Reflect.apply(write, fs, [path, ...args])
    }) as typeof fs.writeFileSync)
    t.mock.method(fs, 'rmSync', ((path, options) => {
      remove(path, options)
      if (String(path) === directory) { removals++; throw removing }
    }) as typeof fs.rmSync)
    syncBuiltinESMExports()
    assert.throws(() => writeMcpConfig('fixture.db'), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [writing, removing])
      assert.equal(error.cause, writing)
      return true
    })
    assert.equal(removals, 1)
    assert.equal(fs.existsSync(directory), false)
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
})
