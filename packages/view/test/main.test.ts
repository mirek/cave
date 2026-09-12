import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { Server } from 'node:http'
import { getEventListeners } from 'node:events'
import { open } from '@cavelang/store'
import { runServe } from '@cavelang/view'

test('viewer rejects blank hosts before accessing its database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-host-option-'))
  const db = join(dir, 'absent.db')
  try {
    for (const host of ['', '   ', '\t']) {
      let output = '', errors = ''
      const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
      const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
      assert.equal(await runServe(['--db', db, '--host', host, '--port', '0'], { stdout, stderr }), 1)
      assert.equal(output, '')
      assert.match(errors, /--host expects a non-empty hostname or address/)
      assert.equal(existsSync(db), false)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('viewer rejects blank ports before accessing its database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-port-option-'))
  const db = join(dir, 'absent.db')
  try {
    for (const port of ['', '   ', '\t']) {
      let output = '', errors = ''
      const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
      const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
      assert.equal(await runServe(['--db', db, '--port', port], { stdout, stderr }), 1)
      assert.equal(output, '')
      assert.match(errors, /--port expects 0\.\.65535/)
      assert.equal(existsSync(db), false)
    }
    open(db).close()
    const controller = new AbortController()
    let output = '', errors = ''
    const stdout = new Writable({ write(chunk, _encoding, done) {
      output += String(chunk)
      controller.abort()
      done()
    } })
    const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
    assert.equal(await runServe(['--db', db, '--port', '0'], { stdout, stderr, signal: controller.signal }), 0)
    assert.match(output, /at http:\/\/127\.0\.0\.1:[1-9]\d*\//)
    assert.equal(errors, '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('viewer shutdown waits on the signal captured at startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-signal-capture-'))
  const db = join(dir, 'k.db')
  open(db).close()
  const controller = new AbortController(), other = new AbortController()
  let reads = 0, fallbackUsed = false
  let fallback: ReturnType<typeof setTimeout> | undefined
  const stdout = new Writable({ write(_chunk, _encoding, done) {
    controller.abort()
    fallback = setTimeout(() => { fallbackUsed = true; other.abort() }, 500)
    done()
  } })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  try {
    const code = await runServe(['--db', db, '--port', '0'], {
      stdout, stderr,
      get signal() { return ++reads === 1 ? controller.signal : other.signal }
    })
    assert.equal(code, 0)
    assert.equal(reads, 1)
    assert.equal(fallbackUsed, false)
  } finally { clearTimeout(fallback); rmSync(dir, { recursive: true, force: true }) }
})

for (const mode of ['announcement', 'shutdown']) test(`viewer ${mode} failure closes its listener and database`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-announcement-failure-'))
  const db = join(dir, 'k.db')
  open(db).close()
  const failure = new Error(`viewer ${mode} failed`)
  let databaseCloses = 0
  let listener: Server | undefined
  const close = DatabaseSync.prototype.close
  const listen = Server.prototype.listen
  const closeServer = Server.prototype.close
  const controller = new AbortController()
  const stdout = new Writable({ write(_chunk, _encoding, done) {
    if (mode === 'announcement') throw failure
    controller.abort()
    done()
  } })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  try {
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      databaseCloses++
      return close.call(this)
    })
    t.mock.method(Server.prototype, 'listen', function (this: Server, ...args: Parameters<Server['listen']>) {
      listener = this
      return listen.apply(this, args)
    })
    if (mode === 'shutdown') t.mock.method(Server.prototype, 'close', function (this: Server, callback?: (error?: Error) => void) {
      return closeServer.call(this, error => callback?.(error ?? failure))
    })
    await assert.rejects(runServe(['--db', db, '--port', '0'], { stdout, stderr, signal: controller.signal }), error => error === failure)
    assert.ok(listener)
    assert.equal(listener.listening, false)
    assert.equal(databaseCloses, 1)
  } finally {
    t.mock.restoreAll()
    if (listener?.listening) await new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pre-cancelled viewer startup avoids database access and HTTP startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-pre-cancel-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    store.ingest('existing IS preserved')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const signal = AbortSignal.abort(new Error('cancel before serving'))
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    for (const path of [db, join(dir, 'absent.db')]) {
      assert.equal(await runServe(['--db', path, '--port', '0'], { stdout: sink, stderr: sink, signal }), 0)
      assert.equal(output, '')
    }
    assert.equal(existsSync(join(dir, 'absent.db')), false)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const mode of ['combined', 'unprintable', 'await-close']) test(`viewer preserves cleanup ordering: ${mode}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-cleanup-order-'))
  const db = join(dir, 'k.db')
  open(db).close()
  const announcement = new Error('announcement failed'), shutdown = new Error('listener close failed')
  const connections = new Error('connection cleanup failed'), database = new Error('database close failed')
  if (mode === 'unprintable') {
    Object.defineProperty(announcement, 'message', { get() { throw new Error('message unavailable') } })
    Object.defineProperty(database, 'message', { value: Object.create(null) })
  }
  const controller = new AbortController()
  let closes = 0, released = false, settled = false
  let release: (() => void) | undefined, listener: Server | undefined
  let command: Promise<number> | undefined
  const stdout = new Writable({ write(_chunk, _encoding, done) {
    if (mode !== 'await-close') throw announcement
    controller.abort()
    done()
  } })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  try {
    const closeDb = DatabaseSync.prototype.close, closeServer = Server.prototype.close, closeConnections = Server.prototype.closeAllConnections
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      closeDb.call(this)
      closes++
      if (mode !== 'await-close') throw database
    })
    t.mock.method(Server.prototype, 'close', function (this: Server, callback?: (error?: Error) => void) {
      listener = this
      return closeServer.call(this, error => {
        if (mode !== 'await-close') callback?.(error ?? shutdown)
        else release = () => { released = true; callback?.(error) }
      })
    })
    t.mock.method(Server.prototype, 'closeAllConnections', function (this: Server) {
      closeConnections.call(this)
      if (mode === 'await-close') throw connections
    })
    command = runServe(['--db', db, '--port', '0'], { stdout, stderr, signal: controller.signal })
    void command.then(() => { settled = true }, () => { settled = true })
    if (mode === 'await-close') {
      for (let attempt = 0; attempt < 100 && release === undefined; attempt++) await new Promise<void>(resolve => setImmediate(resolve))
      assert.ok(release)
      assert.equal(settled, false)
      assert.equal(closes, 0, 'database remains open until listener shutdown settles')
      release()
      await assert.rejects(command, error => error === connections)
      assert.equal(released, true)
    } else await assert.rejects(command, error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [announcement, shutdown, database])
      assert.equal(error.cause, announcement)
      if (mode === 'unprintable') {
        assert.equal(error.message, 'viewer failed: [unprintable thrown value]; listener close failed; [unprintable thrown value]')
      } else for (const failure of error.errors) assert.ok(error.message.includes(failure.message))
      return true
    })
    assert.equal(closes, 1)
    assert.equal(listener?.listening, false)
  } finally {
    controller.abort()
    release?.()
    if (command) await command.catch(() => {})
    t.mock.restoreAll()
    if (listener?.listening) await new Promise<void>(resolve => listener!.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const duringAnnouncement of [false, true]) test(`viewer runtime server errors trigger cleanup and retry, during announcement=${duringAnnouncement}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-view-runtime-error-'))
  const db = join(dir, 'store.db')
  const controller = new AbortController()
  const failure = new Error('runtime listener failed')
  let listener: Server | undefined, command: Promise<number> | undefined
  let done = false
  try {
    const seed = open(db)
    seed.ingest('retained IS fact')
    const before = seed.exportText({ tx: true, maxSensitivity: 'restricted' })
    seed.close()
    const listen = Server.prototype.listen
    t.mock.method(Server.prototype, 'listen', function (this: Server, ...args: Parameters<Server['listen']>) {
      listener = this
      return listen.apply(this, args)
    })
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    let announced!: () => void
    const ready = new Promise<void>(resolve => { announced = resolve })
    const stdout = new Writable({ write(_chunk, _encoding, callback) {
      if (duringAnnouncement) listener!.emit('error', failure)
      announced(); callback()
    } })
    command = runServe(['--db', db, '--port', '0'], { stdout, stderr: sink, signal: controller.signal })
    const outcome = command.then(value => ({ value }), error => ({ error }))
    void command.then(() => { done = true }, () => { done = true })
    await ready
    assert.ok(listener)
    if (!duringAnnouncement) listener.emit('error', failure)
    const deadline = Date.now() + 2000
    while (!done && Date.now() < deadline) await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(done, true, 'runtime failure must wake the command without abort')
    assert.deepEqual(await outcome, { error: failure })
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    assert.equal(listener.listening, false)
    assert.equal(controller.signal.aborted, false)
    const store = open(db)
    try { assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before) } finally { store.close() }
    const retryController = new AbortController()
    const retryOut = new Writable({ write(_chunk, _encoding, callback) { retryController.abort(); callback() } })
    assert.equal(await runServe(['--db', db, '--port', '0'], { stdout: retryOut, stderr: sink, signal: retryController.signal }), 0)
  } finally {
    controller.abort()
    await command?.catch(() => {})
    t.mock.restoreAll()
    if (listener?.listening) await new Promise<void>(resolve => listener!.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
