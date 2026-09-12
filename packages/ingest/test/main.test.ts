import { test } from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { open } from '@cavelang/store'
import { substituteShell } from '@cavelang/loop'
import { runIngest } from '../src/main.ts'

class Capture extends Writable {
  value = ''

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.value += String(chunk)
    done()
  }
}

const invoke = async (argv: string[]): Promise<{ code: number, out: string, err: string }> => {
  const stdout = new Capture()
  const stderr = new Capture()
  const code = await runIngest(argv, { stdout, stderr })
  return { code, out: stdout.value, err: stderr.value }
}

test('JSON execution output rejects planning modes before opening or fetching', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-output-mode-'))
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('must not fetch') })
  try {
    const db = join(dir, 'unopened.db')
    for (const mode of ['--plan', '--dry-run']) {
      const result = await invoke(['https://example.test/source', '--db', db, mode, '--json'])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, /--json cannot be combined with --plan or --dry-run/)
      assert.match(result.err, /use --plan for machine-readable planning/)
      assert.equal(fetches, 0)
      assert.equal(existsSync(db), false)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('URL failure status escapes line breaks while JSON preserves the source URL', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-url-failure-label-'))
  const url = 'https://example.test/line\nbreak'
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network\ndetail') })
  try {
    const args = [url, '--db', join(dir, 'knowledge.db'), '--dry-run']
    const plain = await invoke(args)
    assert.ok(!plain.out.includes(url), plain.out)
    assert.ok(!plain.out.includes('network\ndetail'), plain.out)
    assert.ok(plain.out.includes(JSON.stringify(url)), plain.out)
    const json = await invoke([url, '--db', join(dir, 'knowledge.db'), '--plan'])
    const plan = JSON.parse(json.out)
    assert.equal(plan.source, url)
    assert.ok(!plan.message.includes('\n'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('text ingestion status escapes control-bearing paths while JSON retains identity',
  { skip: process.platform === 'win32' && 'Windows filenames cannot contain LF' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-path-label-'))
  try {
    const source = join(dir, 'line\nbreak.md'), db = join(dir, 'knowledge.db'), agent = join(dir, 'agent.cjs')
    writeFileSync(source, 'source material')
    writeFileSync(agent, "process.stdout.write('; no extractable content')")
    const command = substituteShell('{node} {agent}', { node: process.execPath, agent })
    const label = JSON.stringify(source)
    const planned = await invoke([source, '--db', db, '--dry-run'])
    assert.equal(planned.code, 0)
    assert.ok(planned.out.includes(`  batch 1: ${label}\n`))
    const accepted = await invoke([source, '--db', db, '--stdout', '--agent', command])
    assert.equal(accepted.code, 0, accepted.err)
    assert.ok(accepted.out.includes(`source accepted: ${label}`))
    assert.ok(!accepted.out.includes(source))
    const skipped = await invoke([source, '--db', db, '--dry-run'])
    assert.equal(skipped.code, 0)
    assert.ok(skipped.out.includes(`  skip ${label}\n`))
    const json = await invoke([source, '--db', db, '--stdout', '--agent', command, '--force', '--json'])
    assert.equal(json.code, 0)
    assert.equal(JSON.parse(json.out).sources[0].path, source)
    for (const remove of [false, true]) {
      writeFileSync(source, 'original source')
      writeFileSync(agent, `const fs = require('node:fs'); ${remove
        ? 'fs.rmSync(process.argv[2])' : "fs.writeFileSync(process.argv[2], 'changed source')"}; process.stdout.write('extracted IS fact')`)
      const changingAgent = substituteShell('{node} {agent} {source}', { node: process.execPath, agent, source })
      const rejected = await invoke([source, '--db', db, '--stdout', '--agent', changingAgent, '--force'])
      assert.equal(rejected.code, 1)
      assert.ok(rejected.out.includes(`${label}: ${remove ? 'cannot read selected source' : 'source changed'}`))
      assert.ok(!rejected.out.includes(source), 'failure detail must not reintroduce a raw path line break')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('MCP CLI text and JSON retain final agent notes without trusting prose claim counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-note-'))
  try {
    const source = join(dir, 'source.md'), agent = join(dir, 'agent.cjs')
    writeFileSync(source, 'source material')
    writeFileSync(agent, "process.stdout.write('processing\\rdone: 999\\r')")
    const command = substituteShell(`${process.platform === 'win32' ? '& ' : ''}{node} {agent}`, {
      node: process.execPath, agent
    })
    for (const json of [false, true]) {
      const result = await invoke([source, '--db', join(dir, `${json}.db`), '--agent', command,
        ...json ? ['--json'] : []])
      assert.equal(result.code, 0)
      assert.equal(result.err, '')
      assert.doesNotMatch(result.out, /processing|\r/)
      if (json) {
        const report = JSON.parse(result.out)
        assert.equal(report.added, 0)
        assert.equal(report.batches[0].added, 0)
        assert.equal(report.batches[0].note, 'done: 999')
      } else {
        assert.match(result.out, /\+0 claim\(s\)/)
        assert.match(result.out, /agent: done: 999/)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('empty and failed prompt plans do not allocate an unused MCP configuration', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-plan-allocation-'))
  const create = fs.mkdtempSync
  const allocated: string[] = []
  const mock = t.mock.method(fs, 'mkdtempSync', ((prefix, ...args) => {
    const path = Reflect.apply(create, fs, [prefix, ...args])
    if (String(prefix).endsWith('cave-ingest-')) allocated.push(String(path))
    return path
  }) as typeof fs.mkdtempSync)
  syncBuiltinESMExports()
  try {
    const db = join(dir, 'missing.db')
    const empty = await invoke([join(dir, '*.md'), '--db', db, '--plan'])
    assert.equal(empty.code, 0)
    assert.equal(empty.out, '')
    assert.deepEqual(allocated, [])
    const source = join(dir, 'source.md')
    writeFileSync(source, 'source')
    await assert.rejects(invoke([source, '--db', db, '--plan', '--instructions', join(dir, 'missing.instructions')]), /ENOENT/)
    assert.deepEqual(allocated, [])
    writeFileSync(join(dir, 'second.md'), 'another source')
    const planned = await invoke([join(dir, '*.md'), '--db', db, '--plan', '--batch', '1'])
    assert.equal(planned.code, 0)
    const batches = planned.out.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(batches.length, 2)
    assert.equal(allocated.length, 1)
    assert.equal(batches[0].mcpConfig, batches[1].mcpConfig)
    assert.equal(existsSync(batches[0].mcpConfig), true, 'external plans retain the shared configuration')
    assert.equal(existsSync(db), false)
  } finally {
    mock.mock.restore()
    syncBuiltinESMExports()
    for (const path of allocated) rmSync(path, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI rejects unrepresentable agent timeouts before opening a database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-timeout-validation-'))
  try {
    const db = join(dir, 'missing.db')
    for (const timeout of ['0', '-1', 'NaN', 'Infinity', '0.0001', '2147483.648']) {
      const result = await invoke([join(dir, '*.md'), '--plan', '--db', db, `--timeout=${timeout}`])
      assert.equal(result.code, 1, timeout)
      assert.match(result.err, /--timeout/)
      assert.equal(existsSync(db), false)
    }
    for (const timeout of ['0.001', '1.001', '1.5', '2147483.647']) {
      const result = await invoke([join(dir, '*.md'), '--dry-run', '--db', db, `--timeout=${timeout}`])
      assert.equal(result.code, 0, result.err)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CLI rejects unsafe batch sizes before opening the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-batch-'))
  try {
    const db = join(dir, 'must-not-exist.db')
    for (const size of ['0', '1.5', 'Infinity', '9007199254740993']) {
      const result = await invoke(['missing-source.md', '--plan', '--db', db, '--batch', size])
      assert.equal(result.code, 1)
      assert.match(result.err, /--batch must be a positive safe integer/)
      assert.equal(existsSync(db), false)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CLI strict and lenient modes expose atomic exit codes and complete JSON manifests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-main-'))
  try {
    const source = join(dir, 'source.md')
    const agent = join(dir, 'agent.mjs')
    writeFileSync(source, 'source material\n')
    writeFileSync(agent, "process.stdout.write('good USES claim\\nthis is not cave\\n')\n")
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(agent)}`

    const strictDb = join(dir, 'strict.db')
    const strict = await invoke([source, '--db', strictDb, '--stdout', '--agent', command, '--json'])
    assert.equal(strict.code, 1)
    assert.equal(strict.err, '')
    const strictReport = JSON.parse(strict.out)
    assert.equal(strictReport.policy, 'strict')
    assert.equal(strictReport.applied, false)
    assert.equal(strictReport.added, 0)
    assert.deepEqual(strictReport.sources.map((entry: { status: string }) => entry.status), ['rejected'])
    const strictStore = open(strictDb)
    assert.equal(strictStore.currentBeliefs().length, 0)
    strictStore.close()

    const lenientDb = join(dir, 'lenient.db')
    const lenient = await invoke([
      source, '--db', lenientDb, '--stdout', '--agent', command, '--lenient', '--json'
    ])
    assert.equal(lenient.code, 1, 'partial success still returns a failing exit code')
    const lenientReport = JSON.parse(lenient.out)
    assert.equal(lenientReport.policy, 'lenient')
    assert.equal(lenientReport.applied, true)
    assert.equal(lenientReport.added, 1)
    assert.deepEqual(lenientReport.sources.map((entry: { status: string }) => entry.status), ['rejected'])
    const lenientStore = open(lenientDb)
    assert.equal(lenientStore.currentBeliefs().filter(row => row.verb === 'USES').length, 1)
    assert.equal(lenientStore.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, 0,
      'rejected sources remain retryable')
    lenientStore.close()

    const help = await invoke(['--help'])
    assert.equal(help.code, 0)
    assert.match(help.out, /--lenient\s+commit accepted batches and continue after failures/)
    assert.match(help.out, /--json\s+print the complete machine-readable result manifest/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--plan and --dry-run never create or migrate the store (spec §13.7)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-main-'))
  try {
    const source = join(dir, 'source.md')
    writeFileSync(source, 'source material\n')
    const missing = join(dir, 'missing.db')
    const planned = await invoke([source, '--db', missing, '--plan'])
    assert.equal(planned.code, 0, planned.err)
    assert.equal(JSON.parse(planned.out.trim().split('\n')[0]!).files.length, 1, 'one planned batch with the source')
    assert.equal(existsSync(missing), false, 'a plan runs against an empty in-memory store instead of creating one')
    const dry = await invoke([source, '--db', missing, '--dry-run'])
    assert.equal(dry.code, 0, dry.err)
    assert.equal(existsSync(missing), false)

    const legacy = join(dir, 'legacy.db')
    const store = open(legacy)
    store.db.exec('PRAGMA user_version = 0')
    store.close()
    const bytes = readFileSync(legacy)
    const refused = await invoke([source, '--db', legacy, '--dry-run'])
    assert.equal(refused.code, 1)
    assert.match(refused.err, /legacy\.db: schema version 0 needs migration/)
    assert.deepEqual(readFileSync(legacy), bytes, 'the dry run left the older store untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const planning of [true, false]) for (const outputFails of [true, false]) for (const unprintable of [false, true]) test(`ingestion retains failures through store close: planning=${planning}, output=${outputFails}, unprintable=${unprintable}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-final-close-'))
  const db = join(dir, 'store.db'), input = join(dir, 'input.md')
  const seed = open(db)
  try { seed.ingest('local IS retained') } finally { seed.close() }
  writeFileSync(input, 'A local ingestion fixture.')
  const operation = new Error('ingestion output failed'), closing = new Error('ingestion store close failed')
  if (unprintable) {
    Object.defineProperty(operation, 'message', { value: Object.create(null) })
    Object.defineProperty(closing, 'message', { get() { throw new Error('message unavailable') } })
  }
  const stdout = new Capture(), stderr = new Capture()
  let closes = 0
  try {
    const target = fs.realpathSync(db)
    const close = DatabaseSync.prototype.close
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const location = this.location()
      close.call(this)
      if (location !== null && fs.realpathSync(location) === target) {
        closes++
        throw closing
      }
    })
    if (outputFails) t.mock.method(stdout, 'write', () => { throw operation })
    await assert.rejects(runIngest([input, '--db', db, ...(planning ? ['--dry-run'] :
      ['--lenient', '--stdout', '--agent', "printf 'accepted IS retained\\n'"])], { stdout, stderr }), error => {
      if (!outputFails) assert.equal(error, closing)
      else {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [operation, closing])
        assert.equal(error.cause, operation)
        if (unprintable) assert.equal(error.message, '[unprintable thrown value]; store close also failed: [unprintable thrown value]')
        else {
          assert.ok(error.message.includes(operation.message))
          assert.ok(error.message.includes(closing.message))
        }
      }
      return true
    })
    assert.equal(closes, 1)
    assert.equal(stderr.value, '')
    if (!outputFails) assert.notEqual(stdout.value, '')
    t.mock.restoreAll()
    const reopened = open(db)
    try {
      const claims = reopened.exportText({ current: true })
      assert.match(claims, /local IS retained/)
      assert.equal(claims.includes('accepted IS retained'), !planning)
      reopened.ingest('caller IS usable')
    } finally { reopened.close() }
  } finally { t.mock.restoreAll(); rmSync(dir, { recursive: true, force: true }) }
})

for (const planning of [true, false]) test(`ingestion captures its initial command signal: planning=${planning}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-signal-capture-'))
  const input = join(dir, 'input.md'), db = join(dir, 'target.db')
  writeFileSync(input, 'Local source material')
  const original = new AbortController()
  const replacement = AbortSignal.abort(new Error('replacement signal must not be used'))
  const stdout = new Capture(), stderr = new Capture()
  let reads = 0
  try {
    const code = await runIngest([input, '--db', db, ...(planning ? ['--dry-run'] :
      ['--lenient', '--stdout', '--agent', "printf 'accepted IS retained\\n'"])], {
      stdout, stderr, get signal() { return ++reads === 1 ? original.signal : replacement }
    })
    assert.equal(code, 0)
    assert.equal(reads, 1)
    assert.notEqual(stdout.value, '')
    assert.equal(stderr.value, '')
    if (planning) assert.equal(existsSync(db), false)
    else {
      const store = open(db)
      try { assert.match(store.exportText({ current: true }), /accepted IS retained/) } finally { store.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('ingestion keeps the initial cancellation signal during URL selection', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-source-signal-'))
  const db = join(dir, 'absent.db')
  const original = new AbortController(), replacement = new AbortController()
  const reason = new Error('initial signal cancelled during fetch')
  const stdout = new Capture(), stderr = new Capture()
  let reads = 0, fetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    original.abort(reason)
    return new Response('source material', { headers: { 'content-type': 'text/plain' } })
  })
  try {
    await assert.rejects(runIngest(['https://fixture.test/source', '--db', db, '--dry-run'], {
      stdout, stderr, get signal() { return ++reads === 1 ? original.signal : replacement.signal }
    }), error => error === reason)
    assert.equal(reads, 1)
    assert.equal(fetches, 1)
    assert.equal(stdout.value, '')
    assert.equal(stderr.value, '')
    assert.equal(existsSync(db), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test('text ingestion makes discarded successful batches explicit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-discarded-'))
  try {
    writeFileSync(join(dir, 'a.md'), 'first source')
    writeFileSync(join(dir, 'b.md'), 'second source')
    const agent = join(dir, 'agent.cjs')
    const counter = join(dir, 'called')
    writeFileSync(agent, `const fs = require('node:fs'); const path = ${JSON.stringify(counter)};
      const failed = fs.existsSync(path); fs.writeFileSync(path, 'called');
      process.stdout.write(failed ? 'not valid cave' : 'api IS service');`)
    const command = substituteShell(`${process.platform === 'win32' ? '& ' : ''}{node} {agent}`, { node: process.execPath, agent })
    for (const policy of ['strict', 'lenient']) {
      rmSync(counter, { force: true })
      const db = join(dir, `${policy}.db`)
      const result = await invoke([join(dir, '*.md'), '--db', db, '--stdout', '--batch', '1',
        '--agent', command, ...policy === 'lenient' ? ['--lenient'] : []])
      assert.equal(result.code, 1)
      assert.equal(result.err, '')
      assert.match(result.out, /batch 1\/2 .*\+1 claim/)
      assert.match(result.out, /source accepted:/)
      const discarded = 'strict run discarded: no staged claims or source digests were applied'
      assert.equal(result.out.includes(discarded), policy === 'strict')
      const store = open(db)
      try {
        assert.equal(store.currentBeliefs().some(row => row.subject === 'api'), policy === 'lenient')
        if (policy === 'strict') assert.equal(store.currentBeliefs().length, 0)
      } finally { store.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
