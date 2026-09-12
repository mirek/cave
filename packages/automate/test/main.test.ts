import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getEventListeners } from 'node:events'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { open } from '@cavelang/store'
import { declareAutomations, settle, watchCycle } from '@cavelang/automate'
import { runAutomate } from '../src/main.ts'
import type { SettleReport } from '@cavelang/automate'

const maxTxOf = (store: ReturnType<typeof open>): null | string =>
  (store.db.prepare('SELECT MAX(tx) AS t FROM cave_claim').get() as { t: null | string }).t

for (const phase of ['poll', 'cycle']) for (const persistent of [false, true]) for (const unprintable of [false, true]) test(`automation stops and cleans up when ${phase} error reporting fails (persistent=${persistent}, unprintable=${unprintable})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-report-failure-'))
  const db = join(dir, 'k.db'), seed = open(db)
  try { declareAutomations(seed, 'automation/watch HAS automation: `?x IS hot => hook/log`') } finally { seed.close() }
  const operation = unprintable ? Object.create(null) : new Error(phase === 'poll' ? 'poll read failed' : 'cycle output failed')
  const diagnostic = new Error('diagnostic output failed')
  if (unprintable) Object.defineProperty(diagnostic, 'message', { get() { throw new Error('message unavailable') } })
  const controller = new AbortController()
  let command: Promise<number> | undefined, finished = false
  let tick: (() => void) | undefined, cleared = 0, reads = 0, failRead = false, reports = 0
  let errors = ''
  let owned: DatabaseSync | undefined, closes = 0
  const stdout = new Writable({ write(_chunk, _encoding, done) { done() } })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++) await new Promise<void>(resolve => setImmediate(resolve))
    assert.ok(condition(), 'command must settle without waiting for cancellation')
  }
  try {
    const handle = {} as ReturnType<typeof setInterval>
    t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; return handle })
    t.mock.method(globalThis, 'clearInterval', (value: unknown) => { assert.equal(value, handle); cleared++ })
    t.mock.method(stdout, 'write', (chunk: unknown) => {
      if (String(chunk).includes('automation/watch: fired')) throw operation
      return true
    })
    t.mock.method(stderr, 'write', (chunk: unknown) => {
      if (++reports === 1 || persistent) throw diagnostic
      errors += String(chunk)
      return true
    })
    const close = DatabaseSync.prototype.close
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      close.call(this)
      if (this === owned) closes++
    })
    const prepare = DatabaseSync.prototype.prepare
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      if (sql === 'SELECT MAX(tx) AS t FROM cave_claim') {
        owned ??= this
        reads++
        if (failRead) { failRead = false; throw operation }
      }
      return prepare.call(this, sql)
    })
    command = runAutomate(['--db', db], { stdout, stderr, signal: controller.signal })
    void command.then(() => { finished = true }, () => { finished = true })
    await waitFor(() => tick !== undefined)
    const writer = open(db)
    try { writer.ingest('api IS hot') } finally { writer.close() }
    failRead = phase === 'poll'
    assert.doesNotThrow(() => tick!())
    await waitFor(() => finished)
    if (persistent) await assert.rejects(command, error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors[1], diagnostic)
      assert.ok(error.errors[0] instanceof AggregateError)
      assert.equal(error.cause, error.errors[0])
      assert.equal(error.errors[0].errors[1], diagnostic)
      return true
    })
    else assert.equal(await command, 1)
    assert.equal(controller.signal.aborted, false)
    assert.equal(closes, 1)
    assert.equal(cleared, 1)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    if (!persistent) {
      if (unprintable) {
        assert.ok(errors.includes('[unprintable thrown value]; diagnostic output also failed: [unprintable thrown value]'))
      } else {
        assert.match(errors, /diagnostic output failed/)
        assert.match(errors, phase === 'poll' ? /poll read failed/ : /cycle output failed/)
      }
    }
    const before = reads
    tick!()
    assert.equal(reads, before)
    const reopened = open(db)
    try { reopened.ingest('caller IS usable') } finally { reopened.close() }
  } finally {
    controller.abort()
    if (command) await command.catch(() => {})
    t.mock.restoreAll()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('automation polling retries a failed watermark read and ignores callbacks after shutdown', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-poll-'))
  const db = join(dir, 'k.db'), seed = open(db)
  try { declareAutomations(seed, 'automation/watch HAS automation: `?x IS hot => hook/log`') } finally { seed.close() }
  const controller = new AbortController()
  let command: Promise<number> | undefined
  let tick: (() => void) | undefined, cleared = 0, reads = 0, fail = false
  let output = '', errors = ''
  const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
  const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++) await new Promise<void>(resolve => setImmediate(resolve))
    assert.ok(condition(), 'watch made the expected progress')
  }
  try {
    const handle = {} as ReturnType<typeof setInterval>
    t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; return handle })
    t.mock.method(globalThis, 'clearInterval', (value: unknown) => { assert.equal(value, handle); cleared++ })
    const prepare = DatabaseSync.prototype.prepare
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      if (sql === 'SELECT MAX(tx) AS t FROM cave_claim') {
        reads++
        if (fail) { fail = false; throw new Error('poll watermark unavailable') }
      }
      return prepare.call(this, sql)
    })
    command = runAutomate(['--db', db], { stdout, stderr, signal: controller.signal })
    await waitFor(() => tick !== undefined)
    const writer = open(db)
    try { writer.ingest('api IS hot') } finally { writer.close() }
    fail = true
    assert.doesNotThrow(() => tick!())
    assert.match(errors, /poll watermark unavailable/)
    tick!()
    await waitFor(() => output.includes('automation/watch: fired 1 solution(s)'))
    controller.abort()
    assert.equal(await command, 0)
    assert.equal(cleared, 1)
    const before = reads
    assert.doesNotThrow(() => tick!())
    assert.equal(reads, before, 'retained callbacks cannot read the closed store')
    const reopened = open(db)
    try {
      const report = await settle(reopened)
      assert.ok(report.automations.every(automation => automation.fired === 0), 'the retried cycle processed the pending event exactly once')
    } finally { reopened.close() }
  } finally {
    controller.abort()
    if (command) await command
    t.mock.restoreAll()
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const mode of ['list', 'once', 'declare', 'retract', 'close-only', 'cancel', 'watch']) {
  test(`automation reports owned-store close failures: ${mode}`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-automate-close-'))
    const db = join(dir, 'k.db'), seed = open(db)
    try {
      seed.ingest('local IS retained')
      if (mode === 'retract') declareAutomations(seed, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    } finally { seed.close() }
    const controller = new AbortController()
    let closes = 0, errors = ''
    const close = DatabaseSync.prototype.close
    const outputError = new Error('automation output failed')
    const stdout = new Writable({ write(chunk, _encoding, done) {
      if (mode === 'watch' && String(chunk).includes('watching')) controller.abort()
      done()
    } })
    const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
    const input = mode === 'cancel' ? new Readable({ read() { controller.abort(new Error('cancel declaration')) } }) : Readable.from(['declared IS retained'])
    try {
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
        close.call(this)
        closes++
        throw new Error('automation store close failed')
      })
      if (!['close-only', 'cancel', 'watch'].includes(mode)) t.mock.method(stdout, 'write', () => { throw outputError })
      const args = mode === 'watch' ? [] : mode === 'retract' ? ['--retract', 'watch'] : mode === 'cancel' ? ['--declare'] : mode === 'close-only' ? ['--list'] : [`--${mode}`]
      assert.equal(await runAutomate(['--db', db, ...args], { stdin: input, stdout, stderr, signal: controller.signal }), 1)
      assert.equal(closes, 1)
      assert.match(errors, /automation store close failed/)
      if (!['close-only', 'cancel', 'watch'].includes(mode)) assert.match(errors, /automation output failed/)
      t.mock.restoreAll()
      const reopened = open(db)
      try {
        const current = reopened.exportText({ current: true })
        assert.match(current, /local IS retained/)
        if (mode === 'declare') assert.match(current, /declared IS retained/, 'output and cleanup errors do not undo committed declaration input')
        if (mode === 'cancel') assert.doesNotMatch(current, /declared IS retained/)
        reopened.ingest('caller IS usable')
      } finally { reopened.close() }
    } finally {
      t.mock.restoreAll()
      input.destroy()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('automation commands capture the caller cancellation signal before retraction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-signal-capture-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const signal = AbortSignal.abort(new Error('cancelled command'))
    let reads = 0
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    assert.equal(await runAutomate(['--db', db, '--retract', 'watch'], {
      stdout: sink,
      stderr: sink,
      get signal() { return ++reads === 1 ? signal : undefined }
    }), 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(reads, 1)
    assert.equal(output, '')
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('pre-cancelled automation commands do not retract declarations or create databases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-pre-cancel-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    const context = { signal: controller.signal, stdout: sink, stderr: sink }
    assert.equal(await runAutomate(['--db', db, '--retract', 'watch'], context), 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(output, '')
    for (const mode of [['--once'], ['--declare', join(dir, 'missing.cave')], ['--list']]) {
      const absent = join(dir, 'absent.db')
      assert.equal(await runAutomate(['--db', absent, ...mode], context), 0)
      assert.equal(existsSync(absent), false)
      assert.equal(output, '')
    }
    assert.equal(await runAutomate(['--db', db, '--retract', 'watch'], { stdout: sink, stderr: sink }), 0)
    assert.notEqual(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cancelling declaration stdin stops a pending read without appending its prefix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-cancel-input-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  const input = new Readable({ read() {} })
  let timeout: ReturnType<typeof setTimeout> | undefined
  let running: Promise<number> | undefined
  try {
    store.ingest('existing IS preserved')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const controller = new AbortController()
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    running = runAutomate(['--db', db, '--declare'], { stdin: input, stdout: sink, stderr: sink, signal: controller.signal })
    input.push('partial IS forbidden\n')
    await new Promise<void>(resolve => setImmediate(resolve))
    controller.abort(new Error('stop declaration read'))
    assert.equal(await Promise.race([running, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('cancelled stdin did not stop')), 500)
    })]), 0)
    assert.equal(output, '')
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(input.listenerCount('data'), 0)
    assert.equal(input.listenerCount('end'), 0)
    assert.equal(input.listenerCount('error'), 0)
    assert.equal(input.destroyed, false)
    running = runAutomate(['--db', db, '--declare'], { stdin: input, stdout: sink, stderr: sink })
    input.push('recovered IS preserved\n')
    input.push(null)
    assert.equal(await running, 0)
    assert.equal(store.claimsAbout('partial').length, 0)
    assert.equal(store.claimsAbout('recovered').length, 1)
  } finally {
    clearTimeout(timeout)
    input.destroy()
    await running
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('declaration stream truncation, premature close, and errors preserve existing history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-stream-failure-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    store.ingest('existing IS preserved')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const mode of ['utf8', 'close', 'error'] as const) {
      const input = new Readable({ read() {} })
      let output = ''
      let errors = ''
      const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
      const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
      const pending = runAutomate(['--db', db, '--declare'], { stdin: input, stdout, stderr })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        input.push('partial IS forbidden\n; ')
        await new Promise<void>(resolve => setImmediate(resolve))
        if (mode === 'utf8') {
          input.push(Buffer.from([0xf0, 0x9f]))
          input.push(null)
        } else input.destroy(mode === 'error' ? new Error('source transport failed') : undefined)
        assert.equal(await Promise.race([pending, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('failed stream did not settle')), 500)
        })]), 1)
        assert.equal(output, '')
        assert.match(errors, mode === 'utf8' ? /stdin: invalid UTF-8 automation input/ : mode === 'close' ? /stdin closed before declaration input ended/ : /source transport failed/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        for (const event of ['data', 'end', 'error', 'close']) assert.equal(input.listenerCount(event), 0, event)
      } finally {
        clearTimeout(timeout)
        input.destroy()
      }
    }
    const sink = new Writable({ write(_chunk, _encoding, done) { done() } })
    assert.equal(await runAutomate(['--db', db, '--declare'], {
      stdin: Readable.from(['recovered IS preserved']), stdout: sink, stderr: sink
    }), 0)
    assert.equal(store.claimsAbout('partial').length, 0)
    assert.equal(store.claimsAbout('recovered').length, 1)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed agent stdout fails the firing without appending or replaying its prefix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-agent-utf8-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    declareAutomations(store, 'automation/review HAS automation: `?x IS hot => "Review ?x"`')
    store.ingest('first IS hot')
    let output = ''
    let errors = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
    const command = (bytes: Uint8Array) => `node -e "process.stdout.write(Buffer.from([${[...bytes].join(',')}]))"`
    const invoke = async (bytes: Uint8Array) => {
      output = errors = ''
      const code = await runAutomate(['--db', db, '--once', '--json', '--agent', command(bytes)], { stdout, stderr })
      assert.equal(errors, '')
      return { code, report: JSON.parse(output) as SettleReport }
    }
    const bad = Buffer.concat([Buffer.from('partial IS forbidden\n; '), Buffer.from([0xff])])
    const failed = await invoke(bad)
    assert.equal(failed.code, 1)
    const step = failed.report.automations[0]!.firings[0]!.steps[0]!
    assert.equal(step.outcome, 'failed')
    assert.match(step.detail ?? '', /stdout contains invalid UTF-8/)
    assert.equal(store.claimsAbout('partial').length, 0)
    const afterFailure = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const valid = Buffer.from('recovered HAS note: "�café 😀"')
    const retry = await invoke(valid)
    assert.equal(retry.code, 0)
    assert.equal(retry.report.automations.reduce((sum, item) => sum + item.fired, 0), 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), afterFailure)
    store.ingest('second IS hot')
    assert.equal((await invoke(valid)).code, 0)
    assert.equal(store.claimsAbout('recovered').length, 1)
    assert.equal(store.claimsAbout('partial').length, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid hook configuration rejects before automation firing and corrected retry works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-hooks-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    store.ingest('service IS hot')
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    const path = join(dir, 'hooks.json')
    let output = ''
    let errors = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
    const args = ['--db', db, '--once', '--json', '--hooks', path]
    for (const config of [
      Buffer.concat([Buffer.from('{"log":"exit 0 # '), Buffer.from([0xff]), Buffer.from('"}')]),
      JSON.stringify({ log: 'exit 0 # \ud800' }),
      JSON.stringify({ ['\udc00']: 'exit 0', log: 'exit 0' }),
      JSON.stringify({ ' ': 'exit 0', log: 'exit 0' })
    ]) {
      writeFileSync(path, config)
      output = errors = ''
      assert.equal(await runAutomate(args, { stdout, stderr }), 1)
      assert.equal(output, '')
      assert.ok(errors.includes(path))
      assert.equal(history(), before)
    }
    writeFileSync(path, JSON.stringify({ log: 'exit 0' }))
    output = errors = ''
    assert.equal(await runAutomate(args, { stdout, stderr }), 0, errors)
    assert.equal(JSON.parse(output).automations[0].fired, 1)
    assert.notEqual(history(), before)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('automation declaration input preserves split UTF-8 and rejects malformed bytes atomically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-utf8-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  try {
    store.ingest('existing IS preserved')
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    let output = ''
    const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    const bad = Buffer.concat([Buffer.from('partial IS forbidden\n; '), Buffer.from([0xff])])
    const file = join(dir, 'bad.cave')
    writeFileSync(file, bad)
    for (const files of [[file], []]) {
      output = ''
      assert.equal(await runAutomate(['--db', db, '--declare', ...files], {
        stdin: Readable.from([bad]), stdout: sink, stderr: sink
      }), 1)
      assert.match(output, /invalid UTF-8 automation input/)
      assert.ok(output.includes(files[0] ?? 'stdin'))
      assert.equal(history(), before)
    }
    const source = 'café😀 HAS note: "�"'
    const bytes = Buffer.from(source)
    output = ''
    assert.equal(await runAutomate(['--db', db, '--declare'], {
      stdin: Readable.from([...bytes].map(byte => Buffer.from([byte]))), stdout: sink, stderr: sink
    }), 0, output)
    assert.equal(store.claimsAbout('café😀').length, 1)
    assert.ok(store.exportText().includes('�'))
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('automate rejects polling intervals that the runtime would clamp', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-interval-'))
  try {
    const db = join(dir, 'absent.db')
    let output = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    for (const value of ['0.0001', '0.0015', '1.0001', '2147483.648', '1e300', 'NaN', 'Infinity']) {
      output = ''
      assert.equal(await runAutomate(['--db', db, '--once', `--interval=${value}`], { stdout, stderr: stdout }), 1)
      assert.match(output, /interval.*0\.001.*2147483\.647/)
      assert.equal(existsSync(db), false)
    }
    for (const value of ['0.001', '0.25', '1.001', '2147483.647']) {
      assert.equal(await runAutomate(['--db', db, '--once', `--interval=${value}`], { stdout, stderr: stdout }), 0)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('automate rejects invalid pass limits before opening its database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-limit-'))
  try {
    const db = join(dir, 'absent.db')
    let output = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
      output = ''
      assert.equal(await runAutomate(['--db', db, '--once', `--max-passes=${value}`], { stdout, stderr: stdout }), 1)
      assert.match(output, /positive safe integer/)
      assert.equal(existsSync(db), false)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

const firedOf = (report: SettleReport, subject: string): number =>
  report.automations.find(automation => automation.subject === subject)?.fired ?? 0

for (const json of [false, true]) test(`automate --once reports missing action bindings and preserves later effects (${json ? 'JSON' : 'text'})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-action-binding-'))
  const db = join(dir, 'k.db')
  try {
    const seed = open(db)
    try {
      seed.ingest('action/flag HAS action: `?svc, ?constructor => ?svc HAS alert-level: ?constructor`\n' +
        'action/review HAS action: `?svc => ?svc IS reviewed`')
      declareAutomations(seed, 'automation/watch HAS automation: `?svc IS overloaded => action/flag, action/review`')
      seed.ingest('api IS overloaded')
    } finally { seed.close() }
    const invoke = async () => {
      let out = '', err = ''
      const stdout = new Writable({ write(chunk, _encoding, done) { out += String(chunk); done() } })
      const stderr = new Writable({ write(chunk, _encoding, done) { err += String(chunk); done() } })
      const code = await runAutomate(['--db', db, '--once', ...(json ? ['--json'] : [])], { stdout, stderr })
      return { code, out, err }
    }
    const failed = await invoke()
    assert.equal(failed.code, 1)
    assert.equal(failed.err, '')
    assert.match(failed.out, /did not bind \?constructor/)
    assert.doesNotMatch(failed.out, /startsWith|TypeError/)
    if (json) {
      const report = JSON.parse(failed.out) as SettleReport
      assert.deepEqual(report.automations[0]!.firings[0]!.steps.map(step => step.outcome), ['failed', 'ok'])
    }
    const snapshot = () => {
      const store = open(db, { access: 'read-only' })
      try {
        const text = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.match(text, /api IS reviewed/)
        assert.doesNotMatch(text, /api HAS alert-level/)
        return text
      } finally { store.close() }
    }
    const history = snapshot()
    const repeated = await invoke()
    assert.equal(repeated.code, 0, repeated.err)
    assert.equal(repeated.err, '')
    assert.doesNotMatch(repeated.out, /did not bind/)
    assert.equal(snapshot(), history)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

for (const json of [false, true]) test(`automate --once fails for malformed stored rules (${json ? 'JSON' : 'text'})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-broken-rule-'))
  try {
    const path = join(dir, 'k.db')
    const store = open(path)
    store.ingest('rule/broken HAS rule: `not a rule`')
    store.close()
    let output = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    const args = ['--db', path, '--once', ...(json ? ['--json'] : [])]
    assert.equal(await runAutomate(args, { stdout, stderr: stdout }), 1)
    if (json) assert.equal(JSON.parse(output).problems[0].subject, 'rule/broken')
    else assert.equal(output.match(/rule\/broken:/g)?.length, 1)
    output = ''
    assert.equal(await runAutomate([...args, '--no-derive'], { stdout, stderr: stdout }), 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('watch-cycle cancellation survives caller option changes in report callbacks', async () => {
  const store = open()
  try {
    const controller = new AbortController()
    const reason = new Error('cancel captured watch cycle')
    const options = { signal: controller.signal as AbortSignal | undefined }
    let reports = 0
    await assert.rejects(watchCycle(store, options, () => {
      reports++
      options.signal = undefined
      controller.abort(reason)
    }), error => error === reason)
    assert.equal(reports, 1)
  } finally { store.close() }
})

test('a busy watch cycle yields to cancellation before claiming another cycle', async () => {
  const store = open()
  const controller = new AbortController()
  const reason = new Error('stop busy watch')
  const timer = setImmediate(() => controller.abort(reason))
  let reports = 0
  try {
    await assert.rejects(watchCycle(store, { signal: controller.signal }, () => {
      reports += 1
      // Finite fallback keeps the regression from hanging the old implementation.
      if (reports < 10) store.ingest(`event/${reports} IS fresh`)
    }), error => error === reason || (error instanceof Error && error.name === 'AbortError'))
    assert.ok(reports < 10)
  } finally {
    clearImmediate(timer)
    store.close()
  }
})

test('a busy daemon stops cleanly during its startup cycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-cancel-'))
  const path = join(dir, 'k.db')
  const peer = open(path)
  const controller = new AbortController()
  const timer = setImmediate(() => controller.abort())
  let reports = 0
  let output = ''
  let errors = ''
  try {
    declareAutomations(peer, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    peer.ingest('api IS hot')
    const stdout = new Writable({ write(chunk, _encoding, done) {
      const text = String(chunk)
      output += text
      if (text.includes('automation/watch: fired')) {
        reports += 1
        if (reports < 10) peer.ingest(`event/${reports} IS hot`)
      }
      done()
    } })
    const stderr = new Writable({ write(chunk, _encoding, done) { errors += String(chunk); done() } })
    assert.equal(await runAutomate(['--db', path, '--no-derive'], {
      stdout, stderr, signal: controller.signal,
    }), 0)
    assert.ok(reports > 0 && reports < 10)
    assert.equal(errors, '')
    assert.doesNotMatch(output, /watching \(poll/)
    // The event appended while reporting was not claimed before cancellation.
    assert.equal(firedOf(await settle(peer), 'automation/watch'), 1)
  } finally {
    clearImmediate(timer)
    peer.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const json of [false, true]) test(`automate --once reports pass exhaustion and resumption (${json ? 'JSON' : 'text'})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-exhausted-'))
  try {
    const db = join(dir, 'k.db')
    const store = open(db)
    declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
    store.ingest('api IS hot')
    store.close()
    let output = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    const args = ['--db', db, '--once', '--max-passes', '1', ...(json ? ['--json'] : [])]
    assert.equal(await runAutomate(args, { stdout, stderr: stdout }), 1)
    if (json) assert.equal(JSON.parse(output).complete, false)
    else assert.match(output, /^incomplete: /m)
    output = ''
    assert.equal(await runAutomate(args, { stdout, stderr: stdout }), 0)
    if (json) assert.equal(JSON.parse(output).complete, true)
    else assert.match(output, /^settled: /m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a write landing during a cycle is settled by that cycle, never marked seen unprocessed (BUGS.md watch-watermark-race, spec §29.5)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  store.ingest('api IS hot')

  // The concurrent write lands inside the cycle — after a settle's final
  // read, before the poll boundary is taken — exactly the daemon's race
  // window (rendering happens there too).
  const reports: SettleReport[] = []
  let injected = false
  const seen = await watchCycle(store, {}, report => {
    reports.push(report)
    if (!injected) {
      injected = true
      store.ingest('web IS hot')
    }
  })

  const fired = reports.reduce((sum, report) => sum + firedOf(report, 'automation/watch'), 0)
  assert.equal(fired, 2, 'both events fired within the cycle')

  // The poll wakes only when MAX(tx) moves past `seen`, so a boundary
  // equal to MAX(tx) must leave nothing pending — otherwise the write is
  // missed until an unrelated later write arrives.
  assert.equal(seen, maxTxOf(store))
  const pending = await settle(store)
  assert.equal(firedOf(pending, 'automation/watch'), 0, 'nothing was marked seen without being processed')
  store.close()
})

test('a cycle failure propagates, and a retried cycle converges (spec §29.5)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  store.ingest('api IS hot')

  // The daemon must see the failure (it keeps `seen` put and retries on
  // the next tick) rather than have the loop swallow it.
  await assert.rejects(
    watchCycle(store, {}, () => { throw new Error('render failed') }),
    /render failed/)

  const reports: SettleReport[] = []
  const seen = await watchCycle(store, {}, report => reports.push(report))
  assert.equal(seen, maxTxOf(store), 'the retry reaches a stable boundary')
  assert.ok(reports.every(report => firedOf(report, 'automation/watch') === 0),
    'the pre-failure settle already fired and marked its watermark — retries never re-notify (spec §29.3)')
  store.close()
})

test('a quiet cycle reports once and returns a stable boundary (spec §29.5)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')

  const reports: SettleReport[] = []
  const seen = await watchCycle(store, {}, report => reports.push(report))
  assert.equal(reports.length, 1, 'nothing new — one settle confirms quiescence')
  assert.equal(firedOf(reports[0]!, 'automation/watch'), 0)
  assert.equal(seen, maxTxOf(store))
  store.close()
})

test('automate --declare wins over --list and still opens the store for writing (spec §13.7)', async () => {
  class Capture extends Writable {
    value = ''

    override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
      this.value += String(chunk)
      done()
    }
  }
  const capture = (): Capture => new Capture()
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-main-'))
  try {
    const db = join(dir, 'k.db')
    const file = join(dir, 'automations.cave')
    writeFileSync(file, 'automation/watch HAS automation: `?x IS hot => hook/log`\n')
    const stdout = capture()
    const stderr = capture()
    const code = await runAutomate(['--db', db, '--declare', file, '--list'], { stdout, stderr })
    assert.equal(code, 0, stderr.value)
    assert.match(stdout.value, /declared 1 automation\(s\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('automate rejects unsupported timeout precision before creating its database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-timeout-'))
  try {
    const db = join(dir, 'absent.db')
    let output = ''
    const stdout = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
    for (const value of ['0.0001', '0.0015', '1.0001', '2147483.648', 'Infinity', '0']) {
      output = ''
      assert.equal(await runAutomate(['--db', db, '--once', `--timeout=${value}`], { stdout, stderr: stdout }), 1)
      assert.match(output, /timeout.*whole milliseconds/)
      assert.equal(existsSync(db), false)
    }
    for (const value of ['0.001', '1.001', '2147483.647']) {
      assert.equal(await runAutomate(['--db', db, '--once', `--timeout=${value}`], { stdout, stderr: stdout }), 0)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test('watch schedules the exact millisecond interval and clears it on cancellation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-timer-'))
  const controller = new AbortController()
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  let scheduled: ReturnType<typeof setInterval> | undefined
  let delay: number | undefined
  let cleared = false
  t.mock.method(globalThis, 'setInterval', (callback: () => void, milliseconds: number) => {
    delay = milliseconds
    scheduled = originalSetInterval(callback, milliseconds)
    controller.abort()
    return scheduled
  })
  t.mock.method(globalThis, 'clearInterval', (handle: ReturnType<typeof setInterval>) => {
    if (handle === scheduled) cleared = true
    originalClearInterval(handle)
  })
  const stdout = new Writable({ write(_chunk, _encoding, done) { done() } })
  try {
    assert.equal(await runAutomate(['--db', join(dir, 'watch.db'), '--interval=1.001'], {
      stdout, stderr: stdout, signal: controller.signal
    }), 0)
    assert.equal(delay, 1001)
    assert.ok(scheduled)
    assert.equal(cleared, true)
  } finally {
    if (scheduled !== undefined) originalClearInterval(scheduled)
    rmSync(dir, { recursive: true, force: true })
  }
})


for (const phase of ['output', 'watch-read']) test(`cancellation retains simultaneous automation ${phase} failures`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-cancel-failure-'))
  const controller = new AbortController()
  const failure = new Error(`simultaneous ${phase} failure`)
  let diagnostics = ''
  const stdout = new Writable({ write(_chunk, _encoding, done) { done() } })
  const stderr = new Writable({ write(chunk, _encoding, done) { diagnostics += String(chunk); done() } })
  try {
    if (phase === 'output') t.mock.method(stdout, 'write', () => {
      controller.abort(new Error('stop automation'))
      throw failure
    })
    else {
      const prepare = DatabaseSync.prototype.prepare
      t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
        if (sql === 'SELECT MAX(tx) AS t FROM cave_claim') {
          controller.abort(new Error('stop automation'))
          throw failure
        }
        return prepare.call(this, sql)
      })
    }
    assert.equal(await runAutomate(['--db', join(dir, 'test.db'), ...(phase === 'output' ? ['--once'] : [])], {
      stdout, stderr, signal: controller.signal
    }), 1)
    assert.ok(diagnostics.includes(failure.message), diagnostics)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test('final automation diagnostic failure retains the original failure after store cleanup', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-final-diagnostic-'))
  const outputError = new Error('original report failed')
  const diagnosticError = new Error('diagnostic sink failed')
  const stdout = new Writable({ write(_chunk, _encoding, done) { done() } })
  const stderr = new Writable({ write(_chunk, _encoding, done) { done() } })
  let closed = 0
  const close = DatabaseSync.prototype.close
  t.mock.method(DatabaseSync.prototype, 'close', function(this: DatabaseSync) { close.call(this); closed++ })
  t.mock.method(stdout, 'write', () => { throw outputError })
  t.mock.method(stderr, 'write', () => { throw diagnosticError })
  try {
    await assert.rejects(runAutomate(['--db', join(dir, 'test.db'), '--once'], { stdout, stderr }), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [outputError, diagnosticError])
      assert.equal(error.cause, outputError)
      return true
    })
    assert.equal(closed, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


for (const event of ['error', 'end', 'abort'] as const) test(`automation stdin ${event} retains cleanup failures and releases listeners`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-input-cleanup-'))
  const db = join(dir, 'k.db')
  const input = new Readable({ read() {} })
  const controller = new AbortController()
  let output = ''
  const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
  const pause = input.pause.bind(input)
  const off = input.off.bind(input)
  const pauseMock = t.mock.method(input, 'pause', () => { pause(); throw new Error('pause cleanup failed') })
  const offMock = t.mock.method(input, 'off', (...args: Parameters<typeof off>) => {
    const result = off(...args)
    if (args[0] === 'data') throw new Error('data cleanup failed')
    return result
  })
  const command = runAutomate(['--db', db, '--declare'], {
    stdin: input, stdout: sink, stderr: sink, signal: controller.signal
  })
  try {
    assert.ok(input.listenerCount('data') > 0)
    input.emit('data', Buffer.from('partial IS forbidden\n'))
    assert.doesNotThrow(() => {
      if (event === 'abort') controller.abort(new Error('input cancelled'))
      else if (event === 'error') input.emit('error', new Error('input read failed'))
      else input.emit('end')
    })
    assert.equal(await command, 1)
    assert.match(output, /pause cleanup failed/)
    assert.match(output, /data cleanup failed/)
    if (event === 'error') assert.match(output, /input read failed/)
    if (event === 'abort') assert.match(output, /input cancelled/)
    for (const name of ['data', 'end', 'error', 'close']) assert.equal(input.listenerCount(name), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    const stored = open(db)
    try { assert.equal(stored.currentBeliefs().length, 0) } finally { stored.close() }
    output = ''
    assert.equal(await runAutomate(['--db', db, '--declare'], {
      stdin: Readable.from(['recovered IS recorded']), stdout: sink, stderr: sink
    }), 0, output)
  } finally {
    pauseMock.mock.restore()
    offMock.mock.restore()
    input.emit('end')
    await command
    input.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})


for (const phase of ['registration', 'resume'] as const) test(`automation stdin ${phase} failure cleans up partially initialized input`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-input-setup-'))
  const input = new Readable({ read() {} })
  const controller = new AbortController()
  let output = ''
  const sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done() } })
  const on = input.on.bind(input)
  const pause = input.pause.bind(input)
  const setup = phase === 'registration' ?
    t.mock.method(input, 'on', (...args: Parameters<typeof on>) => {
      const result = on(...args)
      if (args[0] === 'close') throw new Error('input setup failed')
      return result
    }) :
    t.mock.method(input, 'resume', () => { throw new Error('input setup failed') })
  const cleanup = t.mock.method(input, 'pause', () => { pause(); throw new Error('input cleanup failed') })
  try {
    const db = join(dir, 'k.db')
    assert.equal(await runAutomate(['--db', db, '--declare'], {
      stdin: input, stdout: sink, stderr: sink, signal: controller.signal
    }), 1)
    assert.match(output, /input setup failed/)
    assert.match(output, /input cleanup failed/)
    for (const name of ['data', 'end', 'error', 'close']) assert.equal(input.listenerCount(name), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    setup.mock.restore()
    cleanup.mock.restore()
    output = ''
    assert.equal(await runAutomate(['--db', db, '--declare'], {
      stdin: Readable.from(['retry IS recorded']), stdout: sink, stderr: sink
    }), 0, output)
    const store = open(db)
    try { assert.equal(store.claimsAbout('retry').length, 1) } finally { store.close() }
  } finally {
    setup.mock.restore()
    cleanup.mock.restore()
    input.removeAllListeners()
    input.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
})
