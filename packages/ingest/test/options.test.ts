import { test } from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import * as assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, Web, run, selectBatches, writeMcpConfig, readInstructions } from '@cavelang/ingest'

for (const field of ['force', 'embed', 'noPrelude'] as const) {
  test(`ingestion rejects malformed ${field} before reading sources`, async () => {
    const store = open()
    try {
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        const options = {
          db: ':memory:', store, patterns: [], files: ['/missing-flag-input'],
          [field]: value as never,
          agent: async () => { assert.fail('invalid options must not invoke agents') }
        }
        await assert.rejects(run(options), new RegExp(`${field} must be a boolean`))
        if (field !== 'noPrelude') {
          await assert.rejects(selectBatches(store, options), new RegExp(`${field} must be a boolean`))
        }
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      const corrected = await run({ db: ':memory:', store, patterns: [], [field]: false })
      assert.equal(corrected.failed, 0)
    } finally { store.close() }
  })
}

test('MCP config rejects malformed noPrelude before replacing a caller file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-config-flags-'))
  const path = join(dir, 'cave-mcp.json')
  try {
    writeFileSync(path, 'keep existing configuration')
    for (const value of ['true', 'false', null, 0, 1, [], {}]) {
      assert.throws(() => writeMcpConfig(':memory:', { dir, noPrelude: value as never }), /noPrelude must be a boolean/)
      assert.equal(readFileSync(path, 'utf8'), 'keep existing configuration')
    }
    writeMcpConfig(':memory:', { dir, noPrelude: true })
    assert.ok(JSON.parse(readFileSync(path, 'utf8')).mcpServers.cave.args.includes('--no-prelude'))
    writeMcpConfig(':memory:', { dir, noPrelude: false })
    assert.ok(!JSON.parse(readFileSync(path, 'utf8')).mcpServers.cave.args.includes('--no-prelude'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

for (const field of ['force', 'embed'] as const) {
  test(`file selection rejects malformed ${field} before reading paths`, () => {
    const store = open()
    try {
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        assert.throws(() => Files.select(store, ['/missing-selector-input'], { [field]: value as never }),
          new RegExp(`${field} must be a boolean`))
      }
    } finally { store.close() }
  })
}

test('web selection rejects malformed force before fetching', async () => {
  const store = open()
  try {
    for (const force of ['true', 'false', null, 0, 1, [], {}]) {
      await assert.rejects(Web.select(store, ['https://example.test/source'], {
        force: force as never, fetchImpl: async () => { assert.fail('must not fetch') }
      }), /force must be a boolean/)
    }
  } finally { store.close() }
})

test('file selection captures force and embed once for all files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-file-selection-flags-'))
  const store = open()
  try {
    for (const path of ['a.md', 'b.md']) writeFileSync(join(dir, path), path)
    const initial = Files.select(store, ['a.md', 'b.md'], { cwd: dir, embed: true })
    Files.recordDigests(store, initial.files)
    let forceReads = 0, embedReads = 0
    const selected = Files.select(store, ['a.md', 'b.md'], {
      cwd: dir,
      get force() { return ++forceReads === 1 },
      get embed() { return ++embedReads === 1 }
    })
    assert.deepEqual(selected, initial)
    assert.equal(forceReads, 1)
    assert.equal(embedReads, 1)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('source lists reject malformed collections before selecting any source', async () => {
  const store = open()
  let fetches = 0
  const fetchImpl = async () => { fetches++; return new Response('source') }
  try {
    for (const value of ['abc', null, {}, new Set(['abc']), ['https://example.test/source', 42], new Array(1)]) {
      const list = value as unknown as string[]
      await assert.rejects(Web.select(store, list, { fetchImpl }), /URLs must be an array of strings/)
      assert.throws(() => Files.select(store, list), /paths must be an array of strings/)
      assert.throws(() => Files.expand(list), /patterns must be an array of strings/)
      for (const field of ['patterns', 'files'] as const) {
        const options = { db: ':memory:', store, patterns: [], [field]: list, fetchImpl }
        await assert.rejects(selectBatches(store, options), new RegExp(`${field} must be an array of strings`))
        await assert.rejects(run(options), new RegExp(`${field} must be an array of strings`))
      }
    }
    assert.equal(fetches, 0)
    const corrected = await Web.select(store, ['https://example.test/source'], { fetchImpl })
    assert.equal(corrected.files.length, 1)
    assert.equal(fetches, 1)
  } finally { store.close() }
})

test('source snapshots retain queued URLs and manifests after caller mutation', async () => {
  for (const mode of ['web', 'batches', 'strict', 'lenient'] as const) {
    const store = open()
    const expected = Array.from({ length: 10 }, (_, index) => `https://example.test/source-${index}`)
    const sources = [...expected]
    let reads = 0
    Object.defineProperty(sources, 0, { configurable: true, enumerable: true,
      get() { reads++; return reads === 1 ? expected[0] : 'https://example.test/replaced' } })
    const fetched: string[] = []
    const fetchImpl: Web.FetchLike = async url => {
      fetched.push(url)
      await Promise.resolve()
      sources.length = 0
      sources.push('https://example.test/injected')
      return new Response(`material from ${url}`)
    }
    try {
      const options = { db: ':memory:', store, patterns: sources, fetchImpl, batchSize: 2,
        mode: 'stdout' as const, agent: async () => 'captured IS source' }
      let paths: readonly string[]
      if (mode === 'web') paths = (await Web.select(store, sources, { fetchImpl })).files.map(file => file.path)
      else if (mode === 'batches') paths = (await selectBatches(store, options)).selection.files.map(file => file.path)
      else {
        const report = await run({ ...options, policy: mode })
        assert.equal(report.applied, true)
        assert.equal(report.failed, 0)
        assert.ok(report.sources.every(source => source.status === 'accepted'))
        paths = report.sources.map(source => source.path)
        assert.ok(expected.every(url => Files.isIngested(store, url, Files.digestOf(`material from ${url}`))))
      }
      assert.equal(reads, 1, mode)
      assert.deepEqual(fetched, expected, mode)
      assert.deepEqual(paths, expected, mode)
    } finally { store.close() }
  }
})


test('source paths reject malformed Unicode instead of reading replacement filenames', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-source-unicode-'))
  const store = open()
  let fetches = 0
  const fetchImpl = async () => { fetches++; return new Response('source') }
  try {
    writeFileSync(join(dir, '�.md'), 'replacement source')
    for (const surrogate of ['\ud800', '\udc00']) {
      const bad = `${surrogate}.md`
      assert.throws(() => Files.select(store, [bad], { cwd: dir, embed: true }), /well-formed Unicode/)
      assert.throws(() => Files.expand([bad], dir), /well-formed Unicode/)
      assert.throws(() => readInstructions(join(dir, bad)), /well-formed Unicode/)
      assert.throws(() => Files.select(store, [], { cwd: dir + surrogate }), /well-formed Unicode/)
      assert.throws(() => Files.expand([], dir + surrogate), /well-formed Unicode/)
      await assert.rejects(Web.select(store, ['https://example.test/good', `https://example.test/${surrogate}`], { fetchImpl }), /well-formed Unicode/)
      for (const field of ['patterns', 'files'] as const) {
        const options = { db: ':memory:', store, cwd: dir, patterns: [], [field]: [bad], fetchImpl }
        await assert.rejects(selectBatches(store, options), /well-formed Unicode/)
        await assert.rejects(run(options), /well-formed Unicode/)
      }
    }
    assert.equal(fetches, 0)
    assert.equal(Files.select(store, ['�.md'], { cwd: dir, embed: true }).files[0]?.content, 'replacement source')
    assert.equal(readInstructions(join(dir, '�.md')), 'replacement source')
    writeFileSync(join(dir, 'café-😀.md'), 'valid Unicode source')
    assert.equal(Files.select(store, ['café-😀.md'], { cwd: dir }).files.length, 1)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})


test('run validates working directories before staging or prompt setup', async t => {
  const store = open()
  let setups = 0
  try {
    t.mock.method(fs, 'mkdtempSync', () => { setups++; throw new Error('unexpected filesystem setup') })
    syncBuiltinESMExports()
    for (const policy of ['strict', 'lenient'] as const) {
      for (const cwd of [null, 42, false, {}, [], new String('/tmp'), '/tmp/\ud800', '/tmp/\udc00']) {
        let reads = 0
        await assert.rejects(run({ db: ':memory:', store, patterns: [], policy,
          get cwd() { reads++; return cwd as never }
        }), /cwd must (?:be a string|contain well-formed Unicode)/)
        assert.equal(reads, 1)
      }
    }
    assert.equal(setups, 0)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    store.close()
  }
})
