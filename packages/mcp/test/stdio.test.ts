import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { Schema, open } from '@cavelang/store'
import { runMcp, readHooks, sourceFromOption, usage } from '../src/main.ts'

const cliMain = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'src', 'main.ts')

test('MCP CLI rejects invalid UTF-8 input without storing replacement text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-utf8-'))
  const db = join(dir, 'k.db')
  try {
    const seed = open(db)
    seed.ingest('retained IS record')
    const before = seed.exportText({ tx: true, maxSensitivity: 'restricted' })
    seed.close()
    const message = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
          'io.modelcontextprotocol/clientCapabilities': {}
        }, name: 'cave_add', arguments: { text: 'bad IS record' }
      }
    }) + '\n'
    const at = message.indexOf('bad') + 3
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db], {
      input: Buffer.concat([Buffer.from(message.slice(0, at)), Buffer.from([0x80]), Buffer.from(message.slice(at))]),
      encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /valid UTF-8/)
    assert.equal(result.stdout, '')
    const restored = open(db)
    try { assert.equal(restored.exportText({ tx: true, maxSensitivity: 'restricted' }), before) }
    finally { restored.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('pre-cancelled MCP startup avoids database creation and protocol input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-pre-cancel-'))
  let reads = 0
  const stdin = new Readable({ read() { reads++; this.push(null) } })
  try {
    const db = join(dir, 'absent.db')
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    assert.equal(await runMcp(['--db', db], { stdin, stdout: sink, stderr: sink, signal: AbortSignal.abort() }), 0)
    assert.equal(existsSync(db), false)
    assert.equal(output, '')
    assert.equal(reads, 0)
  } finally {
    stdin.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP retains its startup signal when cancellation occurs during announcement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-signal-capture-'))
  const stdin = new Readable({ read() {} })
  const controller = new AbortController(), other = new AbortController()
  let reads = 0, fallbackUsed = false, output = ''
  let fallback: ReturnType<typeof setTimeout> | undefined
  const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
  const stderr = new Writable({ write(_chunk, _encoding, done) {
    controller.abort()
    fallback = setTimeout(() => { fallbackUsed = true; other.abort() }, 500)
    done()
  } })
  try {
    assert.equal(await runMcp(['--db', join(dir, 'k.db')], {
      stdin, stdout, stderr,
      get signal() { return ++reads === 1 ? controller.signal : other.signal }
    }), 0)
    assert.equal(reads, 1)
    assert.equal(fallbackUsed, false)
    assert.equal(output, '')
  } finally {
    clearTimeout(fallback)
    stdin.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP retains unprintable startup and close failures together', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-unprintable-'))
  const operation = Object.create(null)
  const closing = new Error('close failed')
  Object.defineProperty(closing, 'message', { get() { throw new Error('message inaccessible') } })
  const stdin = Readable.from([])
  const stdout = new Writable({ write(_chunk, _encoding, done) { done() } })
  const stderr = new Writable({ write() { throw operation } })
  let closes = 0
  try {
    const close = DatabaseSync.prototype.close
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      close.call(this)
      closes++
      throw closing
    })
    await assert.rejects(runMcp(['--db', join(dir, 'k.db')], { stdin, stdout, stderr }), error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors[0], operation)
      assert.equal(error.errors[1], closing)
      assert.equal(error.cause, operation)
      assert.equal(error.message, 'MCP server failed: [unprintable thrown value]; store close also failed: [unprintable thrown value]')
      return true
    })
    assert.equal(closes, 1)
  } finally {
    t.mock.restoreAll()
    stdin.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP closes its database when the startup announcement throws', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-announcement-failure-'))
  const stdin = new Readable({ read() {} })
  const stdout = new Writable({ write(_chunk, _encoding, done) { done() } })
  const failure = new Error('announcement write failed')
  let closes = 0
  const close = DatabaseSync.prototype.close
  const stderr = new Writable({ write() { throw failure } })
  try {
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closes++
      return close.call(this)
    })
    await assert.rejects(runMcp(['--db', join(dir, 'k.db')], { stdin, stdout, stderr }), error => error === failure)
    assert.equal(closes, 1)
  } finally {
    t.mock.restoreAll()
    stdin.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const mode of ['announcement', 'protocol', 'close-only']) test(`MCP preserves failures through owned-store close: ${mode}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-close-errors-'))
  const db = join(dir, 'k.db')
  const seed = open(db)
  try { seed.ingest('local IS retained') } finally { seed.close() }
  const operation = new Error(`${mode} operation failed`), closing = new Error('MCP database close failed')
  const stdin = mode === 'protocol' ? new Readable({ read() { this.destroy(operation) } }) : Readable.from([])
  let output = '', closes = 0
  const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
  const stderr = new Writable({ write(_chunk, _encoding, done) {
    if (mode === 'announcement') throw operation
    done()
  } })
  try {
    const close = DatabaseSync.prototype.close
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      close.call(this)
      closes++
      throw closing
    })
    await assert.rejects(runMcp(['--db', db], { stdin, stdout, stderr }), error => {
      if (mode === 'close-only') assert.equal(error, closing)
      else {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [operation, closing])
        assert.equal(error.cause, operation)
        assert.ok(error.message.includes(operation.message))
        assert.ok(error.message.includes(closing.message))
      }
      return true
    })
    assert.equal(closes, 1)
    assert.equal(output, '', 'cleanup diagnostics never enter protocol stdout')
    t.mock.restoreAll()
    const reopened = open(db)
    try {
      assert.match(reopened.exportText({ current: true }), /local IS retained/)
      reopened.ingest('caller IS usable')
    } finally { reopened.close() }
  } finally {
    t.mock.restoreAll()
    stdin.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP rejects malformed hook files before database or protocol startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-hooks-'))
  try {
    const db = join(dir, 'absent.db')
    const path = join(dir, 'hooks.json')
    for (const config of [
      Buffer.concat([Buffer.from('{"post":"exit 0 # '), Buffer.from([0xff]), Buffer.from('"}')]),
      JSON.stringify({ post: 'exit 0 # \ud800' }),
      JSON.stringify({ ['\udc00']: 'exit 0' }),
      JSON.stringify({ ' ': 'exit 0' })
    ]) {
      writeFileSync(path, config)
      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db, '--hooks', path], {
        input: '', encoding: 'utf8', timeout: 5000
      })
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      assert.ok(result.stderr.includes(path))
      assert.equal(existsSync(db), false)
    }
    const corrected = { 'café😀': 'exit 0 # �' }
    writeFileSync(path, JSON.stringify(corrected))
    assert.deepEqual(readHooks(path), corrected)
    const recovered = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db, '--hooks', path], {
      input: '', encoding: 'utf8', timeout: 5000
    })
    assert.equal(recovered.status, 0, recovered.stderr)
    assert.match(recovered.stderr, /mcp server/)
    assert.equal(existsSync(db), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--src accepts exactly one unprefixed context form', () => {
  assert.match(usage, /--src <context>  provenance stamp.*without the src: prefix/)
  assert.equal(sourceFromOption(undefined), undefined)
  assert.equal(sourceFromOption('pipeline/nightly'), 'pipeline/nightly')
  assert.throws(() => sourceFromOption('src:pipeline/nightly'), /must not include the src: prefix/)
  assert.throws(() => sourceFromOption(''), /must be a context token/)
  assert.throws(() => sourceFromOption('pipeline nightly'), /must be a context token/)
  assert.throws(() => sourceFromOption('@src:pipeline'), /must be a context token/)
})

test('cave mcp serves Copilot current initialize-era fallback over stdio', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  try {
    const lines = createInterface({ input: child.stdout })
    const pending = new Map<number, (response: Record<string, unknown>) => void>()
    lines.on('line', line => {
      const message = JSON.parse(line) as { id: number }
      pending.get(message.id)?.(message as unknown as Record<string, unknown>)
      pending.delete(message.id)
    })
    let nextId = 0
    const rpc = (method: string, params?: unknown): Promise<Record<string, unknown>> => {
      const id = ++nextId
      const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`timeout waiting for ${method}`))
        }, 15_000)
        timer.unref()
        pending.set(id, response => {
          clearTimeout(timer)
          resolve(response)
        })
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } })}\n`)
      return promise
    }
    const text = (response: Record<string, unknown>): string =>
      ((response['result'] as Record<string, unknown>)['content'] as { text: string }[])[0]!.text

    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    assert.equal((initialized['result'] as Record<string, unknown>)['protocolVersion'], '2025-11-25')
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

    const helped = await rpc('tools/call', { name: 'cave_help', arguments: { topic: 'find' } })
    assert.match(text(helped), /cave_about/)
    const added = await rpc('tools/call', { name: 'cave_add', arguments: { text: 'auth USES jwt @ 90%' } })
    assert.match(text(added), /added 1 claim/)
    const queried = await rpc('tools/call', { name: 'cave_query', arguments: { pattern: '?x USES jwt' } })
    assert.match(text(queried), /\?x = auth/)
    for (const raw of [false, true]) {
      const invalid = await rpc('tools/call', { name: 'cave_search', arguments: { query: 'jwt\u0000 AND missing', raw } })
      assert.equal(invalid['error'], undefined, 'invalid search is a tool error, not a protocol failure')
      assert.equal((invalid['result'] as Record<string, unknown>)['isError'], true)
      assert.equal(text(invalid), 'search query must not contain NUL characters')
    }
    const recovered = await rpc('tools/call', { name: 'cave_search', arguments: { query: 'jwt' } })
    assert.notEqual((recovered['result'] as Record<string, unknown>)['isError'], true)
    assert.match(text(recovered), /auth USES jwt/)
    const unicode = await rpc('tools/call', { name: 'cave_add', arguments: { text: 'bad�name USES library\nface HAS label: "café 😀"' } })
    assert.match(text(unicode), /added 2 claim/)
    for (const bad of ['\ud800', '\udc00']) {
      for (const [name, args] of [
        ['cave_search', { query: `bad${bad}name` }],
        ['cave_search', { query: `bad${bad}name`, raw: true }],
        ['cave_neighbors', { entity: `bad${bad}name` }],
        ['cave_about', { entity: `bad${bad}name` }],
        ['cave_about', { entity: `bad${bad}name`, resolve: true }],
        ['cave_fuse', { about: `bad${bad}name` }],
        ['cave_fuse', { about: `bad${bad}name`, aliases: true }],
        ['cave_query', { pattern: `bad${bad}name USES ?target` }],
        ['cave_add', { text: `partial IS forbidden\nbad${bad}name USES library` }],
      ] as const) {
        const invalid = await rpc('tools/call', { name, arguments: args })
        assert.equal(invalid['error'], undefined, `${name}: Unicode rejection is not a protocol failure`)
        assert.equal((invalid['result'] as Record<string, unknown>)['isError'], true, name)
        assert.match(text(invalid), /unpaired UTF-16 surrogate/, name)
      }
      const valid = await rpc('tools/call', { name: 'cave_query', arguments: { pattern: 'bad�name USES ?target' } })
      assert.notEqual((valid['result'] as Record<string, unknown>)['isError'], true)
      assert.match(text(valid), /\?target = library/)
    }
    const absent = await rpc('tools/call', { name: 'cave_query', arguments: { pattern: 'partial IS forbidden' } })
    assert.match(text(absent), /no matches/i)
    const emoji = await rpc('tools/call', { name: 'cave_query', arguments: { pattern: '?x HAS label: "café 😀"' } })
    assert.match(text(emoji), /\?x = face/)
    const fused = await rpc('tools/call', { name: 'cave_fuse', arguments: {
      text: 'revenue IS 18B USD/yr +/- 3B USD/yr @ 60%\nrevenue IS 20B USD/yr +/- 0.5B USD/yr @ 95%'
    } })
    assert.match(text(fused), /posterior: 19\.97B USD\/yr/, 'named computation over stdio (spec §10.1)')

    child.stdin.end()
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 0)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp --read-only --tools serves the narrowed surface over stdio', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db,
    '--read-only', '--tools', 'cave_add,cave_query'
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const lines = createInterface({ input: child.stdout })
    const pending = new Map<number, (response: Record<string, unknown>) => void>()
    lines.on('line', line => {
      const message = JSON.parse(line) as { id: number }
      pending.get(message.id)?.(message as unknown as Record<string, unknown>)
      pending.delete(message.id)
    })
    let nextId = 0
    const rpc = (method: string, params?: unknown): Promise<Record<string, unknown>> => {
      const id = ++nextId
      const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`timeout waiting for ${method}`))
        }, 15_000)
        timer.unref()
        pending.set(id, response => {
          clearTimeout(timer)
          resolve(response)
        })
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } })}\n`)
      return promise
    }

    const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    assert.match((initialized['result'] as { instructions: string }).instructions, /read-only/)
    const listed = await rpc('tools/list')
    const names = ((listed['result'] as Record<string, unknown>)['tools'] as { name: string }[]).map(tool => tool.name)
    assert.deepEqual(names, ['cave_query'], '--read-only drops cave_add from the --tools list')
    const denied = await rpc('tools/call', { name: 'cave_add', arguments: { text: 'a USES b' } })
    assert.equal((denied['error'] as { code: number }).code, -32602)

    child.stdin.end()
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 0)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp rejects an unknown --tools name before serving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db, '--tools', 'cave_nope'
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 2)
    assert.match(stderr, /unknown tool\(s\): cave_nope/)
    assert.ok(!existsSync(db), 'validation fails before the database is touched')
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp rejects an unknown permission before opening the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db,
    '--permissions', 'read,execute-anything'
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 2)
    assert.match(stderr, /unknown permission\(s\): execute-anything/)
    assert.ok(!existsSync(db), 'permission validation fails before the database is touched')
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp rejects source tokens with trailing line terminators before startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-source-lines-'))
  try {
    for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      const db = join(dir, 'absent.db')
      const result = spawnSync(process.execPath, [
        '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db,
        '--src', `pipeline/nightly${ending}`
      ], { encoding: 'utf8', timeout: 10_000 })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 2, JSON.stringify(ending))
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /--src must be a context token/)
      assert.equal(existsSync(db), false, 'invalid source must not create a database')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp rejects a --src value that already has the src: prefix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db,
    '--src', 'src:pipeline/nightly'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 2)
    assert.match(stderr, /--src must not include the src: prefix/)
    assert.ok(!existsSync(db), 'source validation fails before the database is touched')
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp --read-only opens an existing store read-only and never migrates it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'legacy.db')
  const legacy = open(db)
  legacy.ingest('a IS b')
  legacy.db.exec('PRAGMA user_version = 0')
  legacy.close()
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db, '--read-only'
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 1)
    assert.match(stderr, /legacy\.db: schema version 0 needs migration to 2/)
    const raw = new DatabaseSync(db, { readOnly: true })
    try {
      assert.equal(Schema.versionOf(raw), 0, 'the read-only server left the schema alone')
    } finally {
      raw.close()
    }
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
