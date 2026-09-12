import { test } from 'node:test'
import { EventEmitter, getEventListeners } from 'node:events'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import * as assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Writable } from 'node:stream'
import { runConnect } from '@cavelang/connect'
import { open } from '@cavelang/store'
import { Record as QueryRecord } from '@cavelang/query'

type Captured = { code: number, out: string, err: string }

class Capture extends Writable {
  value = ''

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.value += String(chunk)
    done()
  }
}

const until = async (condition: () => boolean, stage: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error(`connect integration did not reach ${stage}`)
}

/** Capture command output without intercepting the test runner's process streams. */
const captured = async (argv: readonly string[]): Promise<Captured> => {
  const stdout = new Capture(), stderr = new Capture()
  const code = await runConnect(argv, { stdout, stderr })
  return { code, out: stdout.value, err: stderr.value }
}

const fixtures = (records: readonly Record<string, unknown>[]): { dir: string, argv: string[] } => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const source = join(dir, 'people.json')
  const map = join(dir, 'people.map.cave')
  writeFileSync(source, JSON.stringify(records))
  writeFileSync(map, '?id IS person\n?id WORKS-AT ?company\n')
  // The db file does not exist, so --query uses an in-memory store.
  return { dir, argv: [source, '--map', map, '--key', 'id', '--db', join(dir, 'k.db')] }
}

const alice = { id: 'alice', company: 'acme' }
// Both quote flavors in one value cannot be formatted — the record fails.
const dave = { id: 'dave', company: 'both " and `' }

test('connector text output retains large record failure lists', async () => {
  const { dir, argv } = fixtures([dave])
  const size = 130_000
  try {
    writeFileSync(join(dir, 'people.map.cave'), Array.from({ length: size }, () => '?id WORKS-AT ?company').join('\n'))
    const result = await captured(argv)
    assert.equal(result.code, 1)
    const text = result.out + result.err
    assert.ok(text.includes('record 1 (dave): FAILED'))
    const problems = text.split('\n').filter(line => line.startsWith('    ?company:'))
    assert.equal(problems.length, size)
    assert.ok(problems.every(line => line === problems[0]))
    assert.doesNotMatch(text, /Maximum call stack/)
    const store = open(join(dir, 'k.db'))
    try { assert.equal(store.currentBeliefs().filter(row => row.subject === 'dave').length, 0) }
    finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('connector command captures a pre-aborted context signal once', async () => {
  const { dir, argv } = fixtures([alice])
  const controller = new AbortController()
  controller.abort(new Error('already cancelled'))
  const stdout = new Capture(), stderr = new Capture()
  let reads = 0
  try {
    assert.equal(await runConnect(argv, {
      stdout, stderr, get signal() { return ++reads === 1 ? controller.signal : undefined }
    }), 0)
    assert.equal(existsSync(join(dir, 'k.db')), false)
    assert.equal(reads, 1)
    assert.equal(stdout.value, '')
    assert.equal(stderr.value, '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('pre-cancelled connector startup leaves absent and existing databases untouched', async () => {
  const { dir, argv } = fixtures([alice])
  const db = join(dir, 'k.db')
  const stdout = new Capture()
  const stderr = new Capture()
  const controller = new AbortController()
  controller.abort(new Error('cancel before source startup'))
  const context = { stdout, stderr, signal: controller.signal }
  try {
    assert.equal(await runConnect(argv, context), 0)
    assert.equal(existsSync(db), false)
    assert.equal(stdout.value, '')
    assert.equal(stderr.value, '')
    assert.equal(await runConnect(argv, { stdout, stderr }), 0)
    const store = open(db)
    try {
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      writeFileSync(join(dir, 'people.json'), '[]')
      stdout.value = stderr.value = ''
      for (const args of [[...argv, '--prune'], ['--db', db, '--list'], [...argv, '--dry-run']]) {
        assert.equal(await runConnect(args, context), 0)
        assert.equal(stdout.value, '')
        assert.equal(stderr.value, '')
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('invalid UTF-8 mapping files preserve existing records under pruning', async () => {
  const { dir, argv } = fixtures([alice])
  const map = join(dir, 'people.map.cave')
  const snapshot = (): string => {
    const store = open(join(dir, 'k.db'))
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) } finally { store.close() }
  }
  try {
    assert.equal((await captured(argv)).code, 0)
    const before = snapshot()
    writeFileSync(map, Buffer.concat([Buffer.from('?id IS person ; invalid '), Buffer.from([0xff])]))
    const invalid = await captured([...argv, '--prune'])
    assert.equal(invalid.code, 1)
    assert.equal(invalid.out, '')
    assert.match(invalid.err, /invalid UTF-8/)
    assert.equal(snapshot(), before)
    writeFileSync(map, '?id IS person\n?id WORKS-AT ?company\n')
    assert.equal((await captured([...argv, '--prune'])).code, 0)
    assert.equal(snapshot(), before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('native HTTP UTF-8 failures preserve imports under pruning and recover on corrected refresh', { timeout: 15000 }, async () => {
  const { dir, argv } = fixtures([])
  let body = Buffer.from(JSON.stringify([alice]))
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(body)
  })
  const snapshot = (): string => {
    const store = open(join(dir, 'k.db'))
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
    finally { store.close() }
  }
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    argv[0] = `http://127.0.0.1:${address.port}/people.json`
    assert.equal((await captured(argv)).code, 0)
    const before = snapshot()
    for (const invalid of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
      body = Buffer.concat([Buffer.from('[{"id":"bob","company":"'), Buffer.from(invalid), Buffer.from('"}]')])
      const result = await captured([...argv, '--prune'])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, /invalid UTF-8/)
      assert.equal(snapshot(), before)
    }
    body = Buffer.from(JSON.stringify([{ id: 'bob', company: 'widgets' }]))
    const corrected = await captured([...argv, '--prune'])
    assert.equal(corrected.code, 0, corrected.err)
    const store = open(join(dir, 'k.db'))
    try {
      const current = store.currentBeliefs().filter(row => row.subject === 'alice' || row.subject === 'bob')
      assert.deepEqual(current.filter(row => row.conf > 0).map(row => [row.subject, row.verb, row.object]).sort(),
        [['bob', 'IS', 'person'], ['bob', 'WORKS-AT', 'widgets']])
      assert.equal(current.filter(row => row.subject === 'alice' && row.conf === 0).length, 2)
    } finally { store.close() }
    const recovered = snapshot()
    assert.equal((await captured([...argv, '--prune'])).code, 0)
    assert.equal(snapshot(), recovered)
    assert.equal(requests, 7)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extensionless HTTP TSV refreshes reject malformed rows before pruning and recover', { timeout: 15000 }, async () => {
  const { dir, argv } = fixtures([])
  let body = 'id\tcompany\nalice\tacme\n'
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'Text/Tab-Separated-Values; charset=utf-8' })
    response.end(body)
  })
  const snapshot = (): string => {
    const store = open(join(dir, 'k.db'))
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
    finally { store.close() }
  }
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    argv[0] = `http://127.0.0.1:${address.port}/people`
    assert.equal((await captured(argv)).code, 0)
    const before = snapshot()
    for (const invalid of [
      'id\tcompany\nbob\twidgets\ncarol\t"unterminated',
      'id\tcompany\nbob\twidgets\ncarol\tother\textra\n',
      'id\tid\nbob\twidgets\n'
    ]) {
      body = invalid
      const result = await captured([...argv, '--prune'])
      assert.equal(result.code, 1)
      assert.equal(result.out, '')
      assert.match(result.err, /CSV line [1-4]:/)
      assert.equal(snapshot(), before)
    }
    body = 'id\tcompany\nbob\twidgets\n'
    const corrected = await captured([...argv, '--prune'])
    assert.equal(corrected.code, 0, corrected.err)
    const store = open(join(dir, 'k.db'))
    try {
      const current = store.currentBeliefs().filter(row => row.subject === 'alice' || row.subject === 'bob')
      assert.deepEqual(current.filter(row => row.conf > 0).map(row => [row.subject, row.verb, row.object]).sort(),
        [['bob', 'IS', 'person'], ['bob', 'WORKS-AT', 'widgets']])
      assert.equal(current.filter(row => row.subject === 'alice' && row.conf === 0).length, 2)
    } finally { store.close() }
    const recovered = snapshot()
    assert.equal((await captured([...argv, '--prune'])).code, 0)
    assert.equal(snapshot(), recovered)
    assert.equal(requests, 6)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('interrupted native HTTP bodies preserve imports and identify the source before retry', { timeout: 15000 }, async () => {
  const { dir, argv } = fixtures([])
  let interrupted = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close',
      ...(interrupted ? { 'content-length': '10000' } : {}) })
    response.end(JSON.stringify([alice]))
  })
  const snapshot = (): string => {
    const store = open(join(dir, 'k.db'))
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
    finally { store.close() }
  }
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    argv[0] = `http://127.0.0.1:${address.port}/people.json`
    assert.equal((await captured(argv)).code, 0)
    const before = snapshot()
    interrupted = true
    const failed = await captured([...argv, '--prune'])
    assert.equal(failed.code, 1)
    assert.equal(failed.out, '')
    assert.ok(failed.err.includes(`${argv[0]}:`), failed.err)
    assert.equal(snapshot(), before)
    interrupted = false
    assert.equal((await captured([...argv, '--prune'])).code, 0)
    assert.equal(snapshot(), before)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed CSV fails before mapping or pruning existing records', async () => {
  const { dir, argv } = fixtures([])
  const source = join(dir, 'people.csv')
  argv[0] = source
  const snapshot = (): string => {
    const store = open(join(dir, 'k.db'))
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
    finally { store.close() }
  }
  try {
    writeFileSync(source, 'id,company\nalice,acme\nbob,widgets\n')
    assert.equal((await captured(argv)).code, 0)
    const before = snapshot()
    for (const row of ['alice,"unfinished', 'ali"ce,acme', 'alice,"acme"suffix']) {
      writeFileSync(source, `id,company\n${row}`)
      const result = await captured([...argv, '--prune'])
      assert.notEqual(result.code, 0)
      assert.match(result.err, /CSV line 2: (unterminated quoted field|unexpected quote in unquoted field|unexpected character after closing quote)/)
      assert.equal(snapshot(), before)
    }
    writeFileSync(source, 'id,company,company\nalice,acme,changed')
    const duplicate = await captured([...argv, '--prune'])
    assert.notEqual(duplicate.code, 0)
    assert.match(duplicate.err, /CSV line 1: duplicate column name "company"/)
    assert.equal(snapshot(), before)
    writeFileSync(source, 'id,company\nalice,acme,discarded')
    const excess = await captured([...argv, '--prune'])
    assert.notEqual(excess.code, 0)
    assert.match(excess.err, /CSV line 2: 3 cells exceed 2 header columns/)
    assert.equal(snapshot(), before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('federated JSON captures source metadata before rollback for direct and declared queries', async () => {
  for (const declared of [false, true]) for (const failed of [false, true]) {
    const { dir, argv } = fixtures(failed ? [alice, dave] : [alice])
    const db = join(dir, 'k.db')
    try {
      const seed = open(db)
      let before: string
      try {
        seed.ingest('acme IS company')
        if (declared) seed.ingest('source/people HAS path: people.json\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
        before = seed.exportText({ tx: true, maxSensitivity: 'restricted' })
      } finally { seed.close() }
      const result = await captured([...(declared ? ['--db', db] : argv), '--name', 'people', '--query', '?who WORKS-AT acme', '--json'])
      assert.equal(result.code, failed ? 1 : 0, result.err)
      const records = (JSON.parse(result.out) as unknown[]).map(record => QueryRecord.decode(record))
      assert.deepEqual(records.map(record => record.bindings.who), ['alice'])
      const claim = records[0]!.claim!
      const run = declared ? 'people/alice' : 'connect/people/alice'
      assert.ok(claim.claim.contexts.includes(`src:${run}`))
      assert.ok(claim.provenance.runs.includes(run))
      if (failed) assert.match(result.err, /dave.*FAILED/s)
      else assert.equal(result.err, '')
      const restored = open(db, { access: 'read-only' })
      try {
        assert.equal(restored.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.ok(!restored.currentBeliefs().some(row => row.subject === 'alice'))
      } finally { restored.close() }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

for (const declared of [false, true]) for (const corruption of ['identity', 'provenance']) test(`federated JSON projection failure rolls back and recovers (declared=${declared}, ${corruption})`, async () => {
  const { dir, argv } = fixtures([alice])
  const db = join(dir, 'k.db')
  try {
    const seed = open(db)
    try {
      seed.ingest('bob IS person')
      if (declared) seed.ingest('source/people HAS path: people.json\nsource/people HAS map: people.map.cave\nsource/people HAS key: id')
    } finally { seed.close() }
    const raw = new DatabaseSync(db)
    try {
      if (corruption === 'identity') raw.prepare("UPDATE cave_claim SET tx = '00000000-0000-7000-8000-000000000000' WHERE subject = 'bob'").run()
      else raw.prepare("INSERT INTO cave_provenance (claim_id, dimension, value) SELECT id, 'source', '' FROM cave_claim WHERE subject = 'bob'").run()
    } finally { raw.close() }
    const history = () => {
      const connection = new DatabaseSync(db, { readOnly: true })
      try {
        return Object.fromEntries(['cave_claim', 'cave_context', 'cave_provenance', 'cave_tag', 'cave_edge'].map(table =>
          [table, connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
      }
      finally { connection.close() }
    }
    const before = history()
    const args = [...(declared ? ['--db', db] : argv), '--name', 'people', '--query', '?who IS person', '--json']
    const failed = await captured(args)
    assert.equal(failed.code, 1)
    assert.equal(failed.out, '')
    assert.match(failed.err, corruption === 'identity' ? /transaction identity/ : /malformed.*provenance/)
    assert.deepEqual(history(), before)

    const repair = new DatabaseSync(db)
    try {
      if (corruption === 'identity') repair.prepare("UPDATE cave_claim SET tx = id WHERE subject = 'bob'").run()
      else repair.prepare("DELETE FROM cave_provenance WHERE value = ''").run()
    }
    finally { repair.close() }
    const repaired = history()
    const recovered = await captured(args)
    assert.equal(recovered.code, 0, recovered.err)
    assert.equal(recovered.err, '')
    const records = (JSON.parse(recovered.out) as unknown[]).map(record => QueryRecord.decode(record))
    assert.deepEqual(records.map(record => record.bindings.who).sort(), ['alice', 'bob'])
    assert.deepEqual(history(), repaired)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a federated query with mapping failures exits non-zero on every output path (BUGS.md connect-exit-zero, spec §23.3)', async () => {
  const { dir, argv } = fixtures([alice, dave])
  try {
    const matched = await captured([...argv, '--query', '?who WORKS-AT acme'])
    assert.equal(matched.code, 1, 'match path reports the failed record')
    assert.match(matched.out, /\?who = alice/, 'partial results still print')
    assert.match(matched.err, /dave.*FAILED/s)

    const unmatched = await captured([...argv, '--query', '?who WORKS-AT nowhere'])
    assert.equal(unmatched.code, 1, 'no-match path reports the failed record')
    assert.match(unmatched.out, /no matches/)

    const json = await captured([...argv, '--query', '?who WORKS-AT acme', '--json'])
    assert.equal(json.code, 1, 'json path reports the failed record')
    const matches = JSON.parse(json.out) as {
      format: string, version: number, bindings: Record<string, string>, claim: { format: string }
    }[]
    assert.deepEqual(matches.map(match => match.bindings['who']), ['alice'])
    assert.equal(matches[0]?.format, 'cave.query-match')
    assert.equal(matches[0]?.version, 1)
    assert.equal(matches[0]?.claim.format, 'cave.claim')
    assert.doesNotMatch(json.out, /claim_key|raw_line|value_text/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI reports deferred pruning for a missing key without retracting existing data', async () => {
  const bob = { id: 'bob', company: 'initech' }
  const { dir, argv } = fixtures([alice, bob])
  try {
    assert.equal((await captured(argv)).code, 0)
    writeFileSync(join(dir, 'people.json'), JSON.stringify([{ company: 'acme' }, bob]))
    const damaged = await captured([...argv, '--prune'])
    assert.equal(damaged.code, 1)
    assert.match(damaged.out, /pruning skipped/)
    const store = open(join(dir, 'k.db'))
    try {
      assert.deepEqual(store.currentBeliefs().filter(row => row.conf > 0 && row.verb === 'IS' && row.object === 'person').map(row => row.subject).sort(), ['alice', 'bob'])
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a clean federated query still exits zero (spec §23.3)', async () => {
  const { dir, argv } = fixtures([alice])
  try {
    const matched = await captured([...argv, '--query', '?who WORKS-AT acme'])
    assert.equal(matched.code, 0)
    assert.match(matched.out, /\?who = alice/)
    assert.equal(matched.err, '')

    const unmatched = await captured([...argv, '--query', '?who WORKS-AT nowhere'])
    assert.equal(unmatched.code, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI attaches loaded record spans to persisted claims (spec §9.8)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const source = join(dir, 'people list.csv')
  const map = join(dir, 'people.map.cave')
  const db = join(dir, 'k.db')
  writeFileSync(source, 'id,company\nalice,acme\n')
  writeFileSync(map, '?id WORKS-AT ?company\n')
  try {
    const result = await captured([source, '--map', map, '--key', 'id', '--db', db])
    assert.equal(result.code, 0, result.err)
    const store = open(db)
    const row = store.byContext('src:connect/people-list/alice')[0]!
    assert.ok(store.toClaim(row).contexts.includes(`src:${source.replaceAll(' ', '%20')}#L2`))
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('direct and declared URL cancellation interrupts a pending native response body', { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-body-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('[')
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    for (const kind of ['direct', 'declared']) {
    const db = join(dir, `${kind}.db`), map = join(dir, 'map.cave')
    writeFileSync(map, '?id WORKS-AT ?company\n')
    if (kind === 'declared') {
      const declared = open(db)
      try { declared.ingest(`source/a HAS path: http://127.0.0.1:${address.port}/people.json\nsource/a HAS map: map.cave`) } finally { declared.close() }
    }
    const controller = new AbortController()
    const stderr = new Capture()
    const code = await runConnect([...(kind === 'direct' ? [`http://127.0.0.1:${address.port}/people.json`, '--map', map] : []), '--db', db], {
      stdout: new Capture(), stderr, signal: controller.signal,
      fetchImpl: async (url, init) => {
        const response = await fetch(url, init)
        controller.abort(new Error('cancel pending body'))
        return response
      }
    })
    assert.equal(code, 1)
    assert.match(stderr.value, /cancel pending body/)
    const store = open(db)
    try { assert.equal(store.currentBeliefs().length, kind === 'direct' ? 0 : 2) } finally { store.close() }
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('watch registration failures close earlier watchers before returning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-startup-'))
  try {
    const source = join(dir, 'people.json'), map = join(dir, 'map.cave')
    writeFileSync(source, '[{"id":"alice"}]')
    writeFileSync(map, '?id IS person\n')
    for (const declared of [false, true]) {
      const db = join(dir, `${declared}.db`)
      const initial = open(db)
      if (declared) initial.ingest('source/a HAS path: people.json\nsource/a HAS map: map.cave')
      const before = initial.exportText({ tx: true, maxSensitivity: 'restricted' })
      initial.close()
      let calls = 0, closed = 0
      const stderr = new Capture()
      const code = await runConnect([...(declared ? [] : [source, '--map', map]), '--db', db, '--watch'], {
        stdout: new Capture(), stderr,
        watch: () => {
          if (++calls === 2) throw new Error('cannot register second watcher')
          return { close: () => { closed++ } }
        }
      })
      assert.equal(code, 1)
      assert.match(stderr.value, /cannot register second watcher/)
      assert.equal(closed, 1, declared ? 'declared' : 'direct')
      const after = open(db)
      try { assert.equal(after.exportText({ tx: true, maxSensitivity: 'restricted' }), before) }
      finally { after.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('declared URL cancellation stops publication and discovery across command modes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-abort-'))
  try {
    writeFileSync(join(dir, 'map.cave'), '?id IS person\n')
    for (const [mode, format] of ['run', 'dry', 'query', 'watch'].flatMap(mode => ['json', 'cave'].map(format => [mode, format] as const))) {
      const db = join(dir, `${mode}-${format}.db`)
      const store = open(db)
      store.ingest(`source/a HAS path: https://records.test/a.${format}\n${format === 'json' ? 'source/a HAS map: map.cave\n' : ''}source/z HAS path: https://records.test/z.json\nsource/z HAS map: map.cave`)
      store.close()
      assert.equal(await runConnect(['--db', db], {
        stdout: new Capture(), stderr: new Capture(),
        fetchImpl: async url => url.endsWith('.cave') ? new Response('previous IS person') :
          new Response('[{"id":"previous"}]', { headers: { 'content-type': 'application/json' } })
      }), 0)
      const baseline = open(db)
      const before = baseline.exportText({ tx: true, maxSensitivity: 'restricted' })
      baseline.close()
      const controller = new AbortController(), reason = new Error('stop declared load')
      const stdout = new Capture(), stderr = new Capture()
      const closed: boolean[] = [], fetched: string[] = []
      const listeners: ((event: string, filename: string | Buffer | null) => void)[] = []
      const scheduled = new Set<unknown>()
      const code = await runConnect(['--db', db, '--force', '--prune', ...(mode === 'dry' ? ['--dry-run'] : mode === 'query' ? ['--query', '?who IS person'] : mode === 'watch' ? ['--watch'] : [])], {
        stdout, stderr, signal: controller.signal,
        watch: (_path, listener) => { listeners.push(listener); const at = closed.push(false) - 1; return { close: () => { closed[at] = true } } },
        schedule: callback => { scheduled.add(callback); return callback },
        cancelScheduled: handle => { scheduled.delete(handle) },
        fetchImpl: async (url, init) => {
          fetched.push(url)
          listeners[0]?.('change', null)
          controller.abort(reason)
          listeners[0]?.('change', null)
          assert.equal(init.signal?.aborted, true)
          assert.equal(init.signal?.reason, reason)
          if (format === 'cave') return new Response('alice IS person\nsource/nested HAS path: https://records.test/nested.json')
          return new Response('[{"id":"alice"}]', { headers: { 'content-type': 'application/json' } })
        }
      })
      assert.equal(code, mode === 'watch' ? 0 : 1, mode)
      assert.deepEqual(fetched, [`https://records.test/a.${format}`])
      assert.ok(closed.every(Boolean))
      assert.equal(scheduled.size, 0, 'watch cancellation clears pending debounce work')
      assert.match(stderr.value, /stop declared load/)
      assert.doesNotMatch(stdout.value, /alice|source\/nested/)
      const after = open(db)
      try { assert.equal(after.exportText({ tx: true, maxSensitivity: 'restricted' }), before, mode) }
      finally { after.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('cancelled direct URL loads do not commit returned records and can retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-abort-'))
  const db = join(dir, 'k.db'), map = join(dir, 'map.cave')
  writeFileSync(map, '?id WORKS-AT ?company\n')
  const controller = new AbortController()
  const reason = new Error('cancel source fetch')
  const stdout = new Capture(), stderr = new Capture()
  let fetchSignal: AbortSignal | null | undefined
  try {
    const argv = ['https://records.test/people.json', '--map', map, '--key', 'id', '--db', db]
    const response = () => new Response('[{"id":"alice","company":"acme"}]', { headers: { 'content-type': 'application/json' } })
    const code = await runConnect(argv, {
      stdout, stderr, signal: controller.signal,
      fetchImpl: async (_url, init) => {
        fetchSignal = init.signal
        controller.abort(reason)
        return response()
      }
    })
    assert.equal(code, 1)
    assert.equal(fetchSignal?.aborted, true)
    assert.equal(fetchSignal?.reason, reason)
    assert.match(stderr.value, /cancel source fetch/)
    const store = open(db)
    try { assert.equal(store.currentBeliefs().length, 0) } finally { store.close() }
    assert.equal(await runConnect(argv, { stdout: new Capture(), stderr: new Capture(), fetchImpl: async () => response() }), 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('URL ingestion crosses the CLI, source loader, mapper and store with an injected transport', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const map = join(dir, 'people.map.cave')
  const db = join(dir, 'k.db')
  const url = 'https://records.test/people.json'
  writeFileSync(map, '?id WORKS-AT ?company\n')
  const stdout = new Capture()
  const stderr = new Capture()
  let requests = 0
  try {
    const code = await runConnect([url, '--map', map, '--key', 'id', '--db', db], {
      stdout,
      stderr,
      fetchImpl: async (requested, init) => {
        requests += 1
        assert.equal(requested, url)
        assert.equal((init.headers as Record<string, string>)['user-agent'], 'cave-connect')
        assert.ok(init.signal instanceof AbortSignal)
        return new Response(JSON.stringify([{ id: 'alice', company: 'acme' }]), {
          headers: { 'content-type': 'application/json' }
        })
      }
    })
    assert.equal(code, 0, stderr.value)
    assert.equal(requests, 1)
    assert.match(stdout.value, /1 record\(s\): 1 mapped/)
    const store = open(db)
    assert.equal(store.currentBeliefs().filter(row => row.subject === 'alice' && row.verb === 'WORKS-AT').length, 1)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('watch startup, debounce, retry, pruning and explicit-source lifecycle are deterministic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const source = join(dir, 'people.json')
  const map = join(dir, 'people.map.cave')
  const db = join(dir, 'k.db')
  writeFileSync(source, JSON.stringify([{ id: 'alice', company: 'old' }]))
  writeFileSync(map, '?id WORKS-AT ?company @src:upstream\n')

  type Listener = (event: string, filename: string | Buffer | null) => void
  const listeners: Listener[] = []
  const closed: boolean[] = []
  const scheduled = new Map<object, () => Promise<void>>()
  const delays: number[] = []
  let cancelled = 0
  const stdout = new Capture()
  const stderr = new Capture()
  const controller = new AbortController()
  let running: Promise<number> | undefined

  const flush = async (): Promise<void> => {
    assert.equal(scheduled.size, 1, 'rapid events collapse to one pending pass')
    const [handle, callback] = scheduled.entries().next().value!
    scheduled.delete(handle)
    await callback()
  }

  try {
    running = runConnect([
      source, '--map', map, '--key', 'id', '--db', db, '--watch', '--prune'
    ], {
      stdout,
      stderr,
      signal: controller.signal,
      watch: (_path, listener) => {
        const at = listeners.push(listener) - 1
        closed.push(false)
        if (listeners.length === 2) {
          // This save lands after the source watcher exists but before the
          // initial pass. Installing watchers first means it cannot vanish.
          writeFileSync(source, JSON.stringify([{ id: 'alice', company: 'new' }]))
          listeners[0]!('rename', basename(source))
        }
        return { close: () => { closed[at] = true } }
      },
      schedule: (callback, delayMs) => {
        delays.push(delayMs)
        const handle = {}
        scheduled.set(handle, callback)
        return handle
      },
      cancelScheduled: handle => {
        if (scheduled.delete(handle as object)) cancelled += 1
      }
    })

    await until(() => stdout.value.includes('watching'), 'watch setup')
    let store = open(db)
    let row = store.currentBeliefs().find(entry => entry.subject === 'alice' && entry.verb === 'WORKS-AT')!
    assert.equal(row.object, 'new', 'the startup save is present in the initial pass')
    assert.ok(store.toClaim(row).contexts.includes('src:upstream'))
    assert.ok(store.toClaim(row).contexts.includes('src:connect/people/alice'))
    store.close()
    await flush() // queued startup event rechecks and skips the same digest

    writeFileSync(source, '{broken json')
    listeners[0]!('change', basename(source))
    await flush()
    assert.match(stderr.value, new RegExp(`cave connect watch pass: .*${basename(source)}`),
      'a failed watch pass names its lifecycle stage and source')

    writeFileSync(source, JSON.stringify([{ id: 'alice', company: 'rescanned' }]))
    listeners[0]!('change', null)
    await flush()
    store = open(db)
    row = store.currentBeliefs().find(entry => entry.subject === 'alice' && entry.verb === 'WORKS-AT')!
    assert.equal(row.object, 'rescanned', 'a filename-less event rescans its watched target')
    store.close()

    writeFileSync(source, '[]')
    listeners[0]!('change', basename(source))
    listeners[0]!('rename', basename(source))
    listeners[1]!('change', Buffer.from(basename(map)))
    assert.equal(scheduled.size, 1)
    assert.ok(cancelled >= 2, 'later source/map events cancel earlier debounce callbacks')
    await flush()

    store = open(db)
    row = store.currentBeliefs().find(entry => entry.subject === 'alice' && entry.verb === 'WORKS-AT')!
    assert.equal(row.conf, 0, 'pruning retracts the lifecycle-owned claim even with an authored source')
    assert.ok(store.toClaim(row).contexts.includes('src:upstream'))
    assert.ok(store.toClaim(row).contexts.includes('src:connect/people/alice'))
    store.close()

    listeners[0]!('change', basename(source))
    assert.equal(scheduled.size, 1, 'shutdown has pending work to cancel')
    controller.abort()
    assert.equal(await running, 0)
    assert.deepEqual(closed, [true, true])
    assert.equal(scheduled.size, 0)
    listeners[0]!('change', null)
    listeners[1]!('change', basename(map))
    assert.equal(scheduled.size, 0, 'late callbacks cannot schedule work after shutdown')
    assert.ok(delays.every(delay => delay === 200))
  } finally {
    controller.abort()
    await running
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave connect without a source runs, lists, previews, and overlays the declared sources (spec §23.4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name,company\n1,ann,acme\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n?name WORKS-AT ?company\n')
    writeFileSync(join(dir, 'verbs.cave'), 'WORKS-AT IS verb\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    const db = join(dir, 'k.db')
    const store = open(db)
    store.ingest('source/verbs HAS path: verbs.cave')
    store.close()

    const listed = await captured(['--db', db, '--list'])
    assert.equal(listed.code, 0, listed.err)
    assert.equal(listed.out, 'verbs: verbs.cave\n', 'before any pass only the root declaration exists')

    const rejected = await captured(['--db', db, '--map', 'people.map.cave'])
    assert.equal(rejected.code, 1)
    assert.match(rejected.err, /--map describe a source argument/)

    const overlay = await captured(['--db', db, '--query', '?who WORKS-AT ?co'])
    assert.equal(overlay.code, 0, overlay.err)
    assert.equal(overlay.out, '?who = ann  ?co = acme\n', 'the overlay follows the nested declaration too')
    const untouched = open(db)
    assert.equal(untouched.currentBeliefs().length, 1, 'nothing persisted from the overlay')
    untouched.close()

    const pass = await captured(['--db', db])
    assert.equal(pass.code, 0, pass.err)
    assert.match(pass.out, /^source\/verbs: 0 record\(s\).*\+4 claim\(s\)\nsource\/people: 1 record\(s\): 1 mapped.*\+2 claim\(s\)\n$/)
    const listedAfter = await captured(['--db', db, '--list'])
    assert.equal(listedAfter.out, 'people: people.csv --map people.map.cave --key id\nverbs: verbs.cave\n')

    const only = await captured(['--db', db, '--name', 'people'])
    assert.equal(only.code, 0, only.err)
    assert.match(only.out, /^source\/people: 1 record\(s\): 0 mapped, 1 skipped/)
    const unknown = await captured(['--db', db, '--name', 'nope'])
    assert.equal(unknown.code, 1)
    assert.match(unknown.err, /no declared source\/nope — declared: people, verbs/)

    const dry = await captured(['--db', db, '--dry-run', '--name', 'people'])
    assert.equal(dry.code, 0, dry.err)
    assert.match(dry.out, /^; === source\/people \(people\.csv\)\n\n; --- record 1\n\nann IS person\nann WORKS-AT acme\n$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared .cave URL is fetched, and overlays and dry runs discover nested declarations without writing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name,company\n1,ann,acme\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n?name WORKS-AT ?company\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/verbs HAS path: https://example.test/verbs.cave')
    seed.close()
    const fetched: string[] = []
    const fetchImpl = async (requested: string): Promise<Response> => {
      fetched.push(requested)
      return new Response('WORKS-AT IS verb\nsource/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n',
        { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    const run = async (argv: readonly string[]): Promise<Captured> => {
      const stdout = new Capture()
      const stderr = new Capture()
      const code = await runConnect(argv, { stdout, stderr, fetchImpl })
      return { code, out: stdout.value, err: stderr.value }
    }
    const dry = await run(['--db', db, '--dry-run'])
    assert.equal(dry.code, 0, dry.err)
    assert.match(dry.out, /; === source\/verbs \(https:\/\/example\.test\/verbs\.cave\)[\s\S]*; === source\/people \(people\.csv\)[\s\S]*ann WORKS-AT acme/, 'the dry run previews the nested source too')
    const overlay = await run(['--db', db, '--query', '?who WORKS-AT ?co'])
    assert.equal(overlay.code, 0, overlay.err)
    assert.equal(overlay.out, '?who = ann  ?co = acme\n')
    const untouched = open(db)
    assert.equal(untouched.currentBeliefs().length, 1, 'neither the dry run nor the overlay persisted anything')
    untouched.close()
    const pass = await run(['--db', db])
    assert.equal(pass.code, 0, pass.err)
    assert.match(pass.out, /^source\/verbs: 0 record\(s\).*\+4 claim\(s\)\nsource\/people: 1 record\(s\): 1 mapped/)
    assert.equal(fetched.length, 3, 'the .cave URL was fetched once per invocation')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const churn of [false, true]) test(`declared query rediscovers concurrent changes and preserves writer history (churn=${churn})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-overlay-writer-'))
  const db = join(dir, 'k.db')
  const history = () => {
    const store = open(db, { access: 'read-only' })
    try {
      return Object.fromEntries(['cave_claim', 'cave_context', 'cave_provenance', 'cave_tag', 'cave_edge'].map(table =>
        [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    } finally { store.close() }
  }
  try {
    const seed = open(db)
    try { seed.ingest('source/people HAS path: https://example.test/v0.cave') }
    finally { seed.close() }
    const requested: string[] = []
    let expected = history()
    const fetchImpl = async (url: string): Promise<Response> => {
      requested.push(url)
      if (churn || requested.length === 1) {
        const writer = open(db)
        try { writer.ingest(`source/people HAS path: https://example.test/v${requested.length}.cave`) }
        finally { writer.close() }
        expected = history()
      }
      const version = /v(\d+)\.cave$/.exec(url)![1]!
      return new Response(`person${version} IS person\n`, { status: 200 })
    }
    const stdout = new Capture(), stderr = new Capture()
    const args = ['--db', db, '--query', '?who IS person', '--json']
    const code = await runConnect(args, { stdout, stderr, fetchImpl })
    assert.equal(code, churn ? 1 : 0, stderr.value)
    assert.deepEqual(requested, (churn ? [0, 1, 2] : [0, 1]).map(n => `https://example.test/v${n}.cave`))
    assert.deepEqual(history(), expected, 'only concurrent writer history survives discovery and replay')
    if (churn) {
      assert.equal(stdout.value, '')
      assert.match(stderr.value, /declared sources changed.*3 times over/)
    } else {
      assert.equal(stderr.value, '')
      assert.deepEqual(JSON.parse(stdout.value).map((record: QueryRecord.t) => record.bindings.who), ['person1'])
    }
    const recovered = new Capture(), recoveryErrors = new Capture()
    assert.equal(await runConnect(args, {
      stdout: recovered, stderr: recoveryErrors,
      fetchImpl: async url => {
        assert.equal(url, `https://example.test/v${churn ? 3 : 1}.cave`)
        return new Response('recovered IS person\n', { status: 200 })
      }
    }), 0, recoveryErrors.value)
    assert.deepEqual(JSON.parse(recovered.value).map((record: QueryRecord.t) => record.bindings.who), ['recovered'])
    assert.deepEqual(history(), expected, 'a quiet retry also leaves writer history intact')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('declared watch retries failed subscription refreshes without rejecting scheduled work', async () => {
  for (const duringStartup of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-watch-refresh-'))
    const controller = new AbortController()
    let running: Promise<number> | undefined
    const handles: { closed: boolean, listener: (event: string, filename: string | Buffer | null) => void }[] = []
    const scheduled = new Set<() => Promise<void>>()
    try {
      const parent = join(dir, 'parent.cave')
      const declaration = 'source/child HAS path: child.cave'
      writeFileSync(parent, duringStartup ? declaration : 'root IS active')
      writeFileSync(join(dir, 'child.cave'), 'alice IS person')
      const db = join(dir, 'k.db'), seed = open(db)
      seed.ingest('source/parent HAS path: parent.cave')
      seed.close()
      const stdout = new Capture(), stderr = new Capture()
      let rejectChild = true
      running = runConnect(['--db', db, '--watch'], {
        stdout, stderr, signal: controller.signal,
        watch: (_path, listener) => {
          if (handles.length === 1 && rejectChild) throw new Error('child directory unavailable')
          const handle = { closed: false, listener }
          handles.push(handle)
          return { close: () => { handle.closed = true } }
        },
        schedule: callback => { scheduled.add(callback); return callback },
        cancelScheduled: handle => { scheduled.delete(handle as () => Promise<void>) }
      })
      await until(() => stdout.value.includes('watching'), 'watch remains available after initial discovery')
      const saveParent = async () => {
        handles[0]!.listener('change', 'parent.cave')
        assert.equal(scheduled.size, 1, 'a surviving subscription can schedule another pass')
        const callback = [...scheduled][0]!
        scheduled.delete(callback)
        await callback()
      }
      if (!duringStartup) {
        writeFileSync(parent, declaration)
        await saveParent()
      }
      assert.match(stderr.value, /cave connect watch.*child directory unavailable/)
      assert.equal(handles.length, 1)
      assert.equal(handles[0]!.closed, false)
      rejectChild = false
      await saveParent()
      assert.equal(handles.length, 2, 'the next save retries the missing child subscription')
      writeFileSync(join(dir, 'child.cave'), 'bob IS person')
      handles[1]!.listener('change', 'child.cave')
      const callback = [...scheduled][0]!
      scheduled.delete(callback)
      await callback()
      const result = open(db)
      try {
        const current = result.exportText({ current: true })
        assert.match(current, /bob IS person/)
        assert.match(current, /alice IS person[^\n]*@ 0% ; retracted: no longer in source/)
      } finally { result.close() }
    } finally {
      controller.abort()
      if (running) await running
      assert.ok(handles.every(handle => handle.closed))
      assert.equal(scheduled.size, 0)
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('declared watch replaces obsolete source subscriptions and ignores their late events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-move-'))
  const controller = new AbortController()
  let running: Promise<number> | undefined
  const handles: { closed: boolean, listener: (event: string, filename: string | Buffer | null) => void }[] = []
  const scheduled = new Set<() => Promise<void>>()
  try {
    for (const name of ['old', 'next']) writeFileSync(join(dir, `${name}.json`), '[{"id":"alice"}]')
    writeFileSync(join(dir, 'map.cave'), '?id IS person\n')
    const parent = join(dir, 'parent.cave')
    const declare = (name: string) => writeFileSync(parent, `source/people HAS path: ${name}.json\nsource/people HAS map: map.cave`)
    declare('old')
    const db = join(dir, 'k.db'), seed = open(db)
    seed.ingest('source/parent HAS path: parent.cave')
    seed.close()
    const stdout = new Capture()
    running = runConnect(['--db', db, '--watch'], {
      stdout, stderr: new Capture(), signal: controller.signal,
      watch: (_path, listener) => {
        const handle = { closed: false, listener }
        handles.push(handle)
        return { close: () => { handle.closed = true } }
      },
      schedule: callback => { scheduled.add(callback); return callback },
      cancelScheduled: handle => { scheduled.delete(handle as () => Promise<void>) }
    })
    await until(() => stdout.value.includes('watching'), 'initial subscriptions')
    assert.equal(handles.length, 3)
    declare('next')
    handles[0]!.listener('change', 'parent.cave')
    const callback = [...scheduled][0]!
    scheduled.delete(callback)
    await callback()
    assert.equal(handles.length, 4)
    assert.equal(handles[1]!.closed, true, 'old.json subscription is retired')
    assert.equal(handles.filter(handle => !handle.closed).length, 3)
    handles[1]!.listener('change', null)
    assert.equal(scheduled.size, 0, 'late events from the retired subscription cannot enqueue work')
    writeFileSync(parent, 'root IS active')
    handles[0]!.listener('change', 'parent.cave')
    const removal = [...scheduled][0]!
    scheduled.delete(removal)
    await removal()
    assert.equal(handles.filter(handle => !handle.closed).length, 1, 'only the parent remains after removing its child declaration')
    assert.equal(handles[2]!.closed, true, 'the obsolete mapping subscription also closes')

  } finally {
    controller.abort()
    if (running) await running
    assert.ok(handles.every(handle => handle.closed))
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const failures of [1, 2]) test(`declared watch restores retired paths after ${failures} close failures`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-retire-failure-'))
  const controller = new AbortController()
  let running: Promise<number> | undefined
  const handles: { closes: number, listener: (event: string, filename: string | Buffer | null) => void }[] = []
  const scheduled = new Set<() => Promise<void>>()
  try {
    writeFileSync(join(dir, 'people.json'), '[{"id":"alice"}]')
    writeFileSync(join(dir, 'map.cave'), '?id IS person')
    const parent = join(dir, 'parent.cave')
    const declaration = 'source/people HAS path: people.json\nsource/people HAS map: map.cave'
    writeFileSync(parent, declaration)
    const db = join(dir, 'k.db'), seed = open(db)
    try { seed.ingest('source/parent HAS path: parent.cave') } finally { seed.close() }
    const stdout = new Capture(), stderr = new Capture()
    running = runConnect(['--db', db, '--watch'], {
      stdout, stderr, signal: controller.signal,
      watch: (_path, listener) => {
        const index = handles.length
        const handle = { closes: 0, listener }
        handles.push(handle)
        return { close: () => {
          handle.closes++
          if (index > 0 && index <= failures) throw new Error(`retired watcher ${index} close failed`)
        } }
      },
      schedule: callback => { scheduled.add(callback); return callback },
      cancelScheduled: handle => { scheduled.delete(handle as () => Promise<void>) }
    })
    const save = async (index: number, filename: string) => {
      handles[index]!.listener('change', filename)
      assert.equal(scheduled.size, 1)
      const callback = [...scheduled][0]!
      scheduled.delete(callback)
      await callback()
    }
    await until(() => stdout.value.includes('watching'), 'initial subscriptions')
    assert.equal(handles.length, 3)
    writeFileSync(parent, 'root IS active')
    await save(0, 'parent.cave')
    assert.deepEqual(handles.map(handle => handle.closes), [0, 1, 1], 'every obsolete subscription receives a close attempt')
    for (let index = 1; index <= failures; index++) assert.ok(stderr.value.includes(`retired watcher ${index} close failed`))
    handles[1]!.listener('change', null)
    handles[2]!.listener('change', null)
    assert.equal(scheduled.size, 0, 'all retired callbacks are inactive, including failed closes')
    writeFileSync(parent, declaration)
    await save(0, 'parent.cave')
    assert.equal(handles.length, 5, 'reintroduced paths receive fresh subscriptions')
    writeFileSync(join(dir, 'people.json'), '[{"id":"bob"}]')
    await save(3, 'people.json')
    const result = open(db)
    try { assert.match(result.exportText({ current: true }), /bob IS person/) } finally { result.close() }
    controller.abort()
    assert.equal(await running, 0, 'reported retirement failures do not stop the watch session')
    assert.deepEqual(handles.map(handle => handle.closes), [1, 1, 1, 1, 1])
  } finally {
    controller.abort()
    if (running) await running
    rmSync(dir, { recursive: true, force: true })
  }
})

test('watching declared sources picks up the files a followed .cave source declares', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  const controller = new AbortController()
  let running: Promise<number> | undefined
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'verbs.cave'), 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/verbs HAS path: verbs.cave')
    seed.close()
    const watchedFor: string[] = []
    const stdout = new Capture()
    const stderr = new Capture()
    running = runConnect(['--db', db, '--watch'], {
      stdout,
      stderr,
      signal: controller.signal,
      watch: (path, _listener) => {
        watchedFor.push(path)
        return { close: () => {} }
      },
      schedule: () => ({}),
      cancelScheduled: () => {}
    })
    await until(() => stdout.value.includes('watching'), 'watch setup')
    assert.equal(watchedFor.length, 3, 'verbs.cave first, then the nested source file and its mapping after the initial pass')
  } finally {
    controller.abort()
    if (running !== undefined) await running
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--name follows what the selected source declares in turn, and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'verbs.cave'), 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    writeFileSync(join(dir, 'other.cave'), 'other IS thing\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/verbs HAS path: verbs.cave\nsource/other HAS path: other.cave')
    seed.close()
    const stdout = new Capture()
    const stderr = new Capture()
    const code = await runConnect(['--db', db, '--name', 'verbs'], { stdout, stderr })
    assert.equal(code, 0, stderr.value)
    assert.match(stdout.value, /^source\/verbs: .*\nsource\/people: 1 record\(s\): 1 mapped/)
    assert.doesNotMatch(stdout.value, /source\/other/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--name follows a source whose mapping the selected source changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'as-person.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'as-staff.map.cave'), '?name IS staff\n')
    writeFileSync(join(dir, 'remap.cave'), 'source/people HAS map: as-staff.map.cave\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/people HAS path: people.csv\nsource/people HAS map: as-person.map.cave\nsource/people HAS key: id\nsource/remap HAS path: remap.cave')
    seed.close()
    const stdout = new Capture()
    const stderr = new Capture()
    const code = await runConnect(['--db', db, '--name', 'remap'], { stdout, stderr })
    assert.equal(code, 0, stderr.value)
    assert.match(stdout.value, /^source\/remap: .*\nsource\/people: 1 record\(s\): 1 mapped/)
    const store = open(db)
    try {
      const ann = store.currentBeliefs().filter(row => row.conf > 0 && row.subject === 'ann').map(row => row.object)
      assert.deepEqual(ann, ['staff'], 'the re-mapped source ran under the merged declaration')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--name follows a source whose mapping the selected source retracts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'as-person.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'as-staff.map.cave'), '?name IS staff\n')
    writeFileSync(join(dir, 'remap.cave'), 'source/people HAS map: as-staff.map.cave\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/people HAS path: people.csv\nsource/people HAS map: as-person.map.cave\nsource/people HAS key: id\nsource/remap HAS path: remap.cave')
    seed.close()
    const pass = async (argv: readonly string[]): Promise<{ code: number, out: string, err: string }> => {
      const stdout = new Capture()
      const stderr = new Capture()
      const code = await runConnect(argv, { stdout, stderr })
      return { code, out: stdout.value, err: stderr.value }
    }
    assert.equal((await pass(['--db', db])).code, 0)
    const current = (): string[] => {
      const store = open(db)
      try {
        return store.currentBeliefs().filter(row => row.conf > 0 && row.subject === 'ann').map(row => row.object!).sort()
      } finally {
        store.close()
      }
    }
    assert.deepEqual(current(), ['staff'], 'the followed source re-mapped people')
    // remap now retracts its own map claim: people's effective mapping is the root's again.
    writeFileSync(join(dir, 'remap.cave'), 'source/people HAS map: as-staff.map.cave @ 0%\n')
    const only = await pass(['--db', db, '--name', 'remap'])
    assert.equal(only.code, 0, only.err)
    assert.match(only.out, /source\/remap: [\s\S]*source\/people: 1 record\(s\): 1 mapped.*1 retracted/, 'people runs again after remap retracted its map claim')
    assert.deepEqual(current(), ['person'], 'people ran again under the root mapping once remap retracted its own')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--name keeps an unchanged source\'s descendants: an edit to the child data is followed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'parent.cave'), 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/parent HAS path: parent.cave')
    seed.close()
    const pass = async (argv: readonly string[]): Promise<{ code: number, out: string }> => {
      const stdout = new Capture()
      const stderr = new Capture()
      const code = await runConnect(argv, { stdout, stderr })
      return { code, out: stdout.value }
    }
    assert.equal((await pass(['--db', db, '--name', 'parent'])).code, 0)
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n2,bob\n')
    const again = await pass(['--db', db, '--name', 'parent'])
    assert.equal(again.code, 0)
    assert.match(again.out, /source\/people: 2 record\(s\): 1 mapped, 1 skipped/, 'parent is unchanged, yet the child it owns runs and picks up the edit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--name keeps the sources a CSV source declares through its records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'child.cave'), 'child IS here\n')
    // A variable is a whole token, so the record carries the full entity.
    writeFileSync(join(dir, 'registry.csv'), 'entity,path\nsource/child,child.cave\n')
    writeFileSync(join(dir, 'registry.map.cave'), '?entity HAS path: ?path\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/registry HAS path: registry.csv\nsource/registry HAS map: registry.map.cave\nsource/registry HAS key: entity')
    seed.close()
    const pass = async (argv: readonly string[]): Promise<{ code: number, out: string }> => {
      const stdout = new Capture()
      const stderr = new Capture()
      const code = await runConnect(argv, { stdout, stderr })
      return { code, out: stdout.value }
    }
    const first = await pass(['--db', db, '--name', 'registry'])
    assert.equal(first.code, 0)
    assert.match(first.out, /source\/child: /, 'the record-declared child runs on the first pass')
    writeFileSync(join(dir, 'child.cave'), 'child IS changed\n')
    const again = await pass(['--db', db, '--name', 'registry'])
    assert.equal(again.code, 0)
    assert.match(again.out, /source\/registry: 1 record\(s\): 0 mapped, 1 skipped/, 'the parent record is unchanged')
    assert.match(again.out, /source\/child: .*\+1 claim\(s\), 1 retracted/, 'yet the child it owns through that record runs and picks up the edit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a named watch watches the files of the sources the selection owns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  const controller = new AbortController()
  let running: Promise<number> | undefined
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'parent.cave'), 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    writeFileSync(join(dir, 'other.cave'), 'other IS thing\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/parent HAS path: parent.cave\nsource/other HAS path: other.cave')
    seed.close()
    const watchedFor: string[] = []
    const stdout = new Capture()
    running = runConnect(['--db', db, '--watch', '--name', 'parent'], {
      stdout,
      stderr: new Capture(),
      signal: controller.signal,
      watch: (path, _listener) => {
        watchedFor.push(path)
        return { close: () => {} }
      },
      schedule: () => ({}),
      cancelScheduled: () => {}
    })
    await until(() => stdout.value.includes('watching'), 'watch setup')
    assert.equal(watchedFor.length, 3, "parent.cave, then the owned child's file and mapping — never other.cave")
  } finally {
    controller.abort()
    if (running !== undefined) await running
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--name still runs a parent\'s recorded descendants when the parent itself fails to load', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people.map.cave'), '?name IS person\n')
    writeFileSync(join(dir, 'parent.cave'), 'source/people HAS path: people.csv\nsource/people HAS map: people.map.cave\nsource/people HAS key: id\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/parent HAS path: parent.cave')
    seed.close()
    const pass = async (argv: readonly string[]): Promise<{ code: number, out: string, err: string }> => {
      const stdout = new Capture()
      const stderr = new Capture()
      const code = await runConnect(argv, { stdout, stderr })
      return { code, out: stdout.value, err: stderr.value }
    }
    assert.equal((await pass(['--db', db, '--name', 'parent'])).code, 0)
    rmSync(join(dir, 'parent.cave'))
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n2,bob\n')
    const broken = await pass(['--db', db, '--name', 'parent'])
    assert.equal(broken.code, 1, 'the missing parent is a failure')
    assert.match(broken.err, /source\/parent \(parent\.cave\)/)
    assert.match(broken.out, /source\/people: 2 record\(s\): 1 mapped/, 'its recorded descendant still runs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared dry run only reads the store and works on a write-protected one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  const db = join(dir, 'k.db')
  try {
    writeFileSync(join(dir, 'facts.cave'), 'fact IS true\n')
    const seed = open(db)
    seed.ingest('source/facts HAS path: facts.cave')
    seed.close()
    chmodSync(db, 0o444)
    const stdout = new Capture()
    const stderr = new Capture()
    const code = await runConnect(['--db', db, '--dry-run'], { stdout, stderr })
    assert.equal(code, 0, stderr.value)
    assert.match(stdout.value, /; === source\/facts \(facts\.cave\)[\s\S]*fact IS true/)
  } finally {
    chmodSync(db, 0o644)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI takes an inline --map and --sql over a CSV source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n2,bob\n')
    const stdout = new Capture()
    const stderr = new Capture()
    const code = await runConnect([join(dir, 'people.csv'), '--map', '?name IS person, ?name HAS id: ?id', '--sql', 'SELECT id, name FROM records WHERE CAST(id AS INTEGER) > 1', '--key', 'id', '--dry-run'], { stdout, stderr })
    assert.equal(code, 0, stderr.value)
    assert.equal(stdout.value, '; --- record 1\n\nbob IS person\nbob HAS id: 2\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared watch watches a mapping file whose name looks inline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-declared-'))
  const controller = new AbortController()
  let running: Promise<number> | undefined
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n')
    writeFileSync(join(dir, 'people,v2.cave'), '?name IS person\n')
    const db = join(dir, 'k.db')
    const seed = open(db)
    seed.ingest('source/people HAS path: people.csv\nsource/people HAS map: people,v2.cave\nsource/people HAS key: id')
    seed.close()
    const watchedFor: string[] = []
    const stdout = new Capture()
    running = runConnect(['--db', db, '--watch'], {
      stdout,
      stderr: new Capture(),
      signal: controller.signal,
      watch: (path, _listener) => { watchedFor.push(path); return { close: () => {} } },
      schedule: () => ({}),
      cancelScheduled: () => {}
    })
    await until(() => stdout.value.includes('watching'), 'watch setup')
    assert.equal(watchedFor.length, 2, 'the source and the comma-named mapping file are both watched')
  } finally {
    controller.abort()
    if (running !== undefined) await running
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const declared of [false, true]) test(`${declared ? 'declared' : 'direct'} watch shutdown attempts every cleanup after failures`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-cleanup-'))
  const controller = new AbortController()
  try {
    const source = join(dir, 'people.json'), map = join(dir, 'map.cave'), db = join(dir, 'store.db')
    writeFileSync(source, '[{"id":"alice"}]')
    writeFileSync(map, '?id IS person\n')
    if (declared) {
      const store = open(db)
      try { store.ingest('source/a HAS path: people.json\nsource/a HAS map: map.cave') } finally { store.close() }
    }
    const stdout = new Capture(), stderr = new Capture()
    const listeners: ((event: string, filename: string | null) => void)[] = []
    const closed: number[] = []
    let scheduled: undefined | (() => void | Promise<void>), schedules = 0, cancellations = 0
    const result = runConnect([...(declared ? [] : [source, '--map', map]), '--db', db, '--watch'], {
      stdout, stderr, signal: controller.signal,
      watch: (_path, listener) => {
        const index = listeners.push(listener) - 1
        return { close: () => { closed.push(index); if (index === 0) throw new Error('first watcher close failed') } }
      },
      schedule: callback => { schedules++; scheduled = callback; return 1 },
      cancelScheduled: () => { cancellations++; throw new Error('timer cancellation failed') },
    })
    await until(() => stdout.value.includes('watching'), 'watch setup')
    listeners[0]!('change', null)
    controller.abort()
    assert.equal(await result, 1)
    assert.equal(cancellations, 1)
    assert.deepEqual(closed, [0, 1])
    assert.match(stderr.value, /timer cancellation failed/)
    assert.match(stderr.value, /first watcher close failed/)
    const before = stderr.value
    listeners.forEach(listener => listener('change', null))
    await scheduled?.()
    assert.equal(schedules, 1)
    assert.equal(stderr.value, before)
  } finally { controller.abort(); rmSync(dir, { recursive: true, force: true }) }
})

for (const declared of [false, true]) test(`${declared ? 'declared' : 'direct'} watch preserves registration and cleanup failures`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-register-close-'))
  try {
    const source = join(dir, 'people.json'), map = join(dir, 'map.cave'), db = join(dir, 'store.db')
    writeFileSync(source, '[{"id":"alice"}]')
    writeFileSync(map, '?id IS person\n')
    if (declared) {
      const store = open(db)
      try { store.ingest('source/a HAS path: people.json\nsource/a HAS map: map.cave') } finally { store.close() }
    }
    let registrations = 0, closes = 0
    const stderr = new Capture()
    const code = await runConnect([...(declared ? [] : [source, '--map', map]), '--db', db, '--watch'], {
      stdout: new Capture(), stderr,
      watch: () => {
        if (++registrations === 2) throw new Error('second registration failed')
        return { close: () => { closes++; throw new Error('first cleanup failed') } }
      },
    })
    assert.equal(code, 1)
    assert.equal(closes, 1)
    assert.match(stderr.value, /second registration failed/)
    assert.match(stderr.value, /first cleanup failed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('declared watch waits for an active pass despite watcher-close failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-active-close-'))
  const controller = new AbortController()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let running: Promise<number> | undefined, active: void | Promise<void> = undefined
  try {
    const db = join(dir, 'store.db'), map = join(dir, 'map.cave')
    writeFileSync(map, '?id IS person\n')
    const store = open(db)
    try { store.ingest('source/a HAS path: https://example.test/people.json\nsource/a HAS map: map.cave') } finally { store.close() }
    const stdout = new Capture(), stderr = new Capture()
    let listener!: (event: string, filename: string | null) => void
    let scheduled!: () => void | Promise<void>
    let fetches = 0, closes = 0, settled = false
    running = runConnect(['--db', db, '--watch'], {
      stdout, stderr, signal: controller.signal,
      watch: (_path, callback) => {
        listener = callback
        return { close: () => { closes++; throw new Error('watcher close failed') } }
      },
      schedule: callback => { scheduled = callback; return 1 },
      cancelScheduled: () => {},
      fetchImpl: async () => {
        if (++fetches > 1) await pending
        return new Response('[{"id":"alice"}]', { headers: { 'content-type': 'application/json' } })
      },
    })
    void running.then(() => { settled = true })
    await until(() => stdout.value.includes('watching'), 'watch setup')
    listener('change', null)
    active = scheduled()
    await until(() => fetches === 2, 'active fetch')
    controller.abort()
    await until(() => closes === 1, 'watcher cleanup')
    assert.equal(settled, false)
    release()
    await active
    assert.equal(await running, 1)
    assert.match(stderr.value, /watcher close failed/)
  } finally {
    controller.abort()
    release()
    await active
    await running
    rmSync(dir, { recursive: true, force: true })
  }
})


for (const mode of ['direct', 'direct-query', 'declared-list', 'declared-dry', 'declared-query', 'direct-watch', 'declared-watch'] as const) for (const unprintable of [false, true]) test(`${mode} retains command failure when the owned store also fails to close (unprintable=${unprintable})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-store-close-'))
  try {
    const source = join(dir, 'people.json'), map = join(dir, 'map.cave'), db = join(dir, 'store.db')
    writeFileSync(source, '[{"id":"alice"}]')
    writeFileSync(map, '?id IS person\n')
    const initial = open(db)
    const history = (store: ReturnType<typeof open>) => Object.fromEntries(
      ['cave_claim', 'cave_context', 'cave_provenance', 'cave_tag', 'cave_edge'].map(table =>
        [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    let before: ReturnType<typeof history>
    try {
      initial.ingest('source/a HAS path: people.json\nsource/a HAS map: map.cave')
      before = history(initial)
    } finally { initial.close() }
    const operation = unprintable ? Object.create(null) : new Error('command output failed')
    const closing = new Error('owned store close failed')
    if (unprintable) Object.defineProperty(closing, 'message', { value: Object.create(null) })
    const close = DatabaseSync.prototype.close
    let closes = 0, registrations = 0
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      const location = this.location()
      const owned = location !== null && realpathSync(location) === realpathSync(db)
      close.call(this)
      if (owned) { closes++; throw closing }
    })
    const stdout = new Capture(), stderr = new Capture()
    const watching = mode.endsWith('watch')
    if (!watching) t.mock.method(stdout, 'write', () => { throw operation })
    const args = [...(mode.startsWith('direct') ? [source, '--map', map] : []), '--db', db,
      ...(mode.endsWith('query') ? ['--query', '?x IS person'] : []),
      ...(mode === 'declared-list' ? ['--list'] : []), ...(mode === 'declared-dry' ? ['--dry-run'] : []),
      ...(watching ? ['--watch'] : [])]
    const code = await runConnect(args, { stdout, stderr, watch: () => {
      if (++registrations === 2) throw new Error('watch registration failed')
      return { close: () => {} }
    } })
    assert.equal(code, 1)
    assert.equal(closes, 1)
    assert.match(stderr.value, watching ? /watch registration failed/ : unprintable ? /\[unprintable thrown value\]/ : /command output failed/)
    assert.match(stderr.value, unprintable ? /\[unprintable thrown value\]/ : /owned store close failed/)
    t.mock.restoreAll()
    const reopened = open(db, { access: 'read-only' })
    try {
      const mapped = reopened.currentBeliefs().some(row => row.subject === 'alice' && row.verb === 'IS' && row.object === 'person')
      assert.equal(mapped, mode === 'direct')
      if (mode.endsWith('query')) assert.deepEqual(history(reopened), before,
        'output and close failures must leave no temporary claims, bookkeeping or metadata')
    } finally { reopened.close() }
  } finally { t.mock.restoreAll(); rmSync(dir, { recursive: true, force: true }) }
})

test('connector command reports cancellation and independent transport failure without changing history', async () => {
  const { dir, argv } = fixtures([alice])
  try {
    assert.equal((await captured(argv)).code, 0)
    const db = join(dir, 'k.db')
    const history = () => {
      const store = open(db)
      try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
      finally { store.close() }
    }
    const before = history()
    const controller = new AbortController()
    const stdout = new Capture(), stderr = new Capture()
    const code = await runConnect(['https://example.test/people.json', ...argv.slice(1)], {
      stdout, stderr, signal: controller.signal,
      fetchImpl: async () => {
        controller.abort(new Error('cancel source request'))
        throw new Error('transport cleanup detail')
      }
    })
    assert.equal(code, 1)
    assert.match(stderr.value, /cancel source request/)
    assert.match(stderr.value, /transport cleanup detail/)
    assert.equal(stdout.value, '')
    assert.equal(history(), before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

for (const format of ['json', 'jsonl'] as const) {
  test(`invalid ${format} records cannot update or prune prior claims and corrected refreshes recover`, async () => {
    const { dir, argv } = fixtures([])
    if (format === 'json') argv.push('--records', 'data.items')
    else argv[0] = join(dir, 'people.jsonl')
    const write = (items: readonly unknown[]) => writeFileSync(argv[0]!, format === 'json' ?
      JSON.stringify({ data: { items } }) : items.map(item => JSON.stringify(item)).join('\r\n\r\n') + '\r\n')
    const snapshot = () => {
      const store = open(join(dir, 'k.db'))
      try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
      finally { store.close() }
    }
    try {
      write([alice, { id: 'bob', company: 'widgets' }])
      assert.equal((await captured(argv)).code, 0)
      const before = snapshot()
      for (const invalid of [null, 7, []]) {
        write([{ ...alice, company: 'newco' }, invalid])
        const result = await captured([...argv, '--prune'])
        assert.equal(result.code, 1)
        assert.match(result.err, format === 'json' ? /record 2 is not an object/ : /line 3 is not a JSON object/)
        assert.equal(snapshot(), before)
      }
      if (format === 'jsonl') {
        writeFileSync(argv[0]!, `${JSON.stringify({ ...alice, company: 'newco' })}\r\n\r\n{"id":`)
        const result = await captured([...argv, '--prune'])
        assert.equal(result.code, 1)
        assert.match(result.err, /line 3: invalid JSON/)
        assert.equal(snapshot(), before)
      }
      write([{ ...alice, company: 'newco' }])
      assert.equal((await captured([...argv, '--prune'])).code, 0)
      const store = open(join(dir, 'k.db'))
      try {
        const active = store.currentBeliefs().filter(row => row.conf > 0)
        assert.equal(active.some(row => row.subject === 'bob'), false)
        assert.ok(active.some(row => row.subject === 'alice' && row.verb === 'WORKS-AT' && row.object === 'newco'))
      } finally { store.close() }
      const recovered = snapshot()
      assert.equal((await captured([...argv, '--prune'])).code, 0)
      assert.equal(snapshot(), recovered)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

test('declared command reports partial commits while failed previews preserve history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-declared-partial-'))
  const db = join(dir, 'k.db')
  const read = <T>(body: (store: ReturnType<typeof open>) => T): T => {
    const store = open(db)
    try { return body(store) } finally { store.close() }
  }
  const history = () => read(store => store.exportText({ tx: true, maxSensitivity: 'restricted' }))
  try {
    for (const name of ['a', 'b', 'c']) writeFileSync(join(dir, `${name}.cave`), `${name}-fact IS old\n`)
    read(store => store.ingest('source/a HAS path: a.cave\nsource/b HAS path: b.cave\nsource/c HAS path: c.cave'))
    const args = ['--db', db]
    const initial = await captured(args)
    assert.equal(initial.code, 0, initial.err)
    const before = history()
    writeFileSync(join(dir, 'a.cave'), 'a-fact IS new\n')
    writeFileSync(join(dir, 'b.cave'), 'broken\n')
    writeFileSync(join(dir, 'c.cave'), 'c-fact IS new\n')
    for (const content of ['broken\n', 'CONTAINS REVERSE ELSEWHERE\n']) {
      writeFileSync(join(dir, 'b.cave'), content)
      for (const mode of [['--dry-run'], ['--query', '?x IS new', '--json']]) {
        const preview = await captured([...args, ...mode])
        assert.equal(preview.code, 1)
        assert.equal(preview.out, '')
        assert.match(preview.err, /source\/b \(b\.cave\)/)
        assert.equal(history(), before)
      }
    }
    writeFileSync(join(dir, 'b.cave'), 'broken\n')
    const partial = await captured(args)
    assert.equal(partial.code, 1)
    assert.match(partial.out, /source\/a:.*\+1 claim/)
    assert.match(partial.out, /source\/c:.*\+1 claim/)
    assert.doesNotMatch(partial.out, /source\/b:/)
    assert.match(partial.err, /source\/b \(b\.cave\)/)
    const facts = () => read(store => store.currentBeliefs()
      .filter(row => row.conf > 0 && ['a-fact', 'b-fact', 'c-fact'].includes(row.subject))
      .map(row => `${row.subject}:${row.object}`).sort())
    assert.deepEqual(facts(), ['a-fact:new', 'b-fact:old', 'c-fact:new'])
    const successfulHistory = read(store => store.db.prepare("SELECT * FROM cave_claim WHERE subject IN ('a-fact', 'c-fact') ORDER BY tx").all())
    writeFileSync(join(dir, 'b.cave'), 'b-fact IS new\n')
    const repaired = await captured(args)
    assert.equal(repaired.code, 0, repaired.err)
    assert.match(repaired.out, /source\/a:.*\+0 claim/)
    assert.match(repaired.out, /source\/b:.*\+1 claim/)
    assert.match(repaired.out, /source\/c:.*\+0 claim/)
    assert.deepEqual(facts(), ['a-fact:new', 'b-fact:new', 'c-fact:new'])
    assert.deepEqual(read(store => store.db.prepare("SELECT * FROM cave_claim WHERE subject IN ('a-fact', 'c-fact') ORDER BY tx").all()), successfulHistory)
    const committed = history()
    assert.equal((await captured(args)).code, 0)
    assert.equal(history(), committed)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

for (const declared of [false, true]) for (const failure of ['report', 'schedule', 'cancel'] as const) {
  test(`${declared ? 'declared' : 'direct'} watch owns fatal ${failure} errors without external abort`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-watch-fatal-'))
    const controller = new AbortController()
    let running: Promise<number> | undefined
    try {
      const source = join(dir, 'people.json'), map = join(dir, 'map.cave'), db = join(dir, 'store.db')
      writeFileSync(source, '[{"id":"alice"}]')
      writeFileSync(map, '?id IS person\n')
      if (declared) {
        const store = open(db)
        try { store.ingest('source/a HAS path: people.json\nsource/a HAS map: map.cave') } finally { store.close() }
      }
      const stdout = new Capture(), stderr = new Capture()
      const fatal = new Error(`fatal ${failure} failure`)
      const write = stderr.write.bind(stderr)
      t.mock.method(stderr, 'write', (...args: Parameters<typeof stderr.write>) => {
        if (failure === 'report' && /^(cave connect watch pass:|source\/)/.test(String(args[0]))) throw fatal
        return write(...args)
      })
      const listeners: ((event: string, filename: string | Buffer | null) => void)[] = []
      let scheduled!: () => Promise<void>
      let closes = 0, done = false
      const args = [...declared ? [] : [source, '--map', map], '--db', db]
      running = runConnect([...args, '--watch'], {
        stdout, stderr, signal: controller.signal,
        watch: (_path, listener) => { listeners.push(listener); return { close: () => { closes++ } } },
        schedule: callback => { if (failure === 'schedule') throw fatal; scheduled = callback; return 1 },
        cancelScheduled: () => { if (failure === 'cancel') throw fatal }
      })
      void running.then(() => { done = true }, () => { done = true })
      await until(() => stdout.value.includes('watching'), 'watch setup')
      const snapshot = () => {
        const store = open(db)
        try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) } finally { store.close() }
      }
      const before = snapshot()
      if (failure === 'report') writeFileSync(source, '{broken json')
      assert.doesNotThrow(() => listeners[0]!('change', null))
      if (failure === 'cancel') assert.doesNotThrow(() => listeners[0]!('change', null))
      if (failure === 'report') await assert.doesNotReject(scheduled())
      await until(() => done, 'fatal watch completion')
      assert.equal(await running, 1)
      assert.equal(controller.signal.aborted, false)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
      assert.equal(closes, listeners.length)
      assert.match(stderr.value, new RegExp(`fatal ${failure} failure`))
      assert.equal(snapshot(), before)
      writeFileSync(source, '[{"id":"bob"}]')
      assert.equal(await runConnect(args, { stdout: new Capture(), stderr: new Capture() }), 0)
      assert.match(snapshot(), /bob IS person/)
    } finally {
      controller.abort()
      if (running !== undefined) await running.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

for (const initialFailure of [false, true]) {
  test(`declared watch serializes startup saves after pending fetch, initial failure=${initialFailure}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-watch-startup-serial-'))
    const controller = new AbortController()
    let running: Promise<number> | undefined
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    try {
      const db = join(dir, 'store.db')
      writeFileSync(join(dir, 'map.cave'), '?id IS person\n')
      const seed = open(db)
      try { seed.ingest('source/a HAS path: https://records.test/a.json\nsource/a HAS map: map.cave') }
      finally { seed.close() }
      const stdout = new Capture(), stderr = new Capture()
      const listeners: ((event: string, filename: string | Buffer | null) => void)[] = []
      let calls = 0, pending = 0, peak = 0, closed = 0
      let scheduled: (() => Promise<void>) | undefined
      running = runConnect(['--db', db, '--watch'], {
        stdout, stderr, signal: controller.signal,
        watch: (_path, listener) => { listeners.push(listener); return { close: () => { closed++ } } },
        schedule: callback => { scheduled = callback; return 1 }, cancelScheduled: () => {},
        fetchImpl: async () => {
          const call = ++calls
          peak = Math.max(peak, ++pending)
          try {
            if (call === 1) {
              await gate
              if (initialFailure) throw new Error('initial fetch failed')
            }
            return new Response(JSON.stringify([{ id: call === 1 ? 'alice' : 'bob' }]), {
              headers: { 'content-type': 'application/json' }
            })
          } finally { pending-- }
        }
      })
      await until(() => calls === 1, 'pending startup fetch')
      listeners[0]!('change', null)
      listeners[0]!('change', null)
      if (scheduled !== undefined) await scheduled()
      assert.equal(calls, 1, 'a save cannot start another fetch while startup is pending')
      assert.equal(peak, 1)
      assert.equal(stdout.value.includes('watching'), false)
      release()
      await until(() => stdout.value.includes('watching'), 'queued startup refresh')
      assert.equal(calls, 2, 'startup saves coalesce into one subsequent pass')
      assert.equal(peak, 1)
      if (initialFailure) assert.match(stderr.value, /initial fetch failed/)
      else assert.equal(stderr.value, '')
      controller.abort()
      assert.equal(await running, 0)
      assert.equal(closed, listeners.length)
      const result = open(db)
      try { assert.match(result.exportText(), /bob IS person/) } finally { result.close() }
    } finally {
      release()
      controller.abort()
      if (running !== undefined) await running.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('declared watch abort discards queued startup refreshes and late fetch publication', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-watch-startup-abort-'))
  const controller = new AbortController()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let running: Promise<number> | undefined
  try {
    const db = join(dir, 'store.db')
    writeFileSync(join(dir, 'map.cave'), '?id IS person\n')
    const seed = open(db)
    try { seed.ingest('source/a HAS path: https://records.test/a.json\nsource/a HAS map: map.cave') }
    finally { seed.close() }
    const snapshot = () => {
      const store = open(db)
      try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) } finally { store.close() }
    }
    const before = snapshot()
    const stdout = new Capture(), stderr = new Capture()
    let listener!: (event: string, filename: string | Buffer | null) => void
    let calls = 0, closed = 0, settled = false
    running = runConnect(['--db', db, '--watch'], {
      stdout, stderr, signal: controller.signal,
      watch: (_path, callback) => { listener = callback; return { close: () => { closed++ } } },
      schedule: () => { throw new Error('startup must queue instead of scheduling') },
      fetchImpl: async () => {
        calls++
        await gate // Deliberately ignores cancellation until the caller releases it.
        return new Response('[{"id":"late"}]', { headers: { 'content-type': 'application/json' } })
      }
    })
    void running.then(() => { settled = true }, () => { settled = true })
    await until(() => calls === 1, 'pending startup request')
    listener('change', null)
    listener('change', null)
    controller.abort(new Error('cancel startup'))
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(settled, false, 'the command still owns the pending transport')
    release()
    assert.equal(await running, 0)
    assert.equal(calls, 1, 'abort discards the queued refresh')
    assert.equal(closed, 1)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    assert.equal(stdout.value.includes('watching'), false)
    assert.equal(snapshot(), before, 'a late response cannot publish after cancellation')
    assert.equal(await runConnect(['--db', db], {
      stdout: new Capture(), stderr: new Capture(),
      fetchImpl: async () => new Response('[{"id":"retry"}]', { headers: { 'content-type': 'application/json' } })
    }), 0)
    assert.match(snapshot(), /retry IS person/)
  } finally {
    controller.abort()
    release()
    if (running !== undefined) await running.catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})


for (const declared of [false, true]) {
  test(`${declared ? 'declared' : 'direct'} watch owns filesystem error events and permits a fresh run`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-watch-event-error-'))
    const controller = new AbortController()
    let running: Promise<number> | undefined
    try {
      const source = join(dir, 'people.json'), map = join(dir, 'map.cave'), db = join(dir, 'store.db')
      writeFileSync(source, '[{"id":"alice"}]')
      writeFileSync(map, '?id IS person\n')
      if (declared) {
        const store = open(db)
        try { store.ingest('source/a HAS path: people.json\nsource/a HAS map: map.cave') } finally { store.close() }
      }
      const subscriptions: (EventEmitter & { close(): void })[] = []
      let closes = 0, done = false
      const stdout = new Capture(), stderr = new Capture()
      const args = [...declared ? [] : [source, '--map', map], '--db', db]
      running = runConnect([...args, '--watch'], {
        stdout, stderr, signal: controller.signal,
        watch: () => {
          const subscription = Object.assign(new EventEmitter(), { close: () => { closes++ } })
          subscriptions.push(subscription)
          return subscription
        }
      })
      void running.then(() => { done = true }, () => { done = true })
      await until(() => stdout.value.includes('watching'), 'watch setup')
      const snapshot = () => {
        const store = open(db)
        try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) } finally { store.close() }
      }
      const before = snapshot()
      assert.doesNotThrow(() => subscriptions[0]!.emit('error', new Error('filesystem watch failed')))
      await until(() => done, 'filesystem error shutdown')
      assert.equal(await running, 1)
      assert.match(stderr.value, /filesystem watch failed/)
      assert.equal(controller.signal.aborted, false)
      assert.equal(closes, subscriptions.length)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
      assert.equal(snapshot(), before)
      assert.doesNotThrow(() => subscriptions[0]!.emit('error', new Error('late closed error')))
      writeFileSync(source, '[{"id":"bob"}]')
      assert.equal(await runConnect(args, { stdout: new Capture(), stderr: new Capture() }), 0)
      assert.match(snapshot(), /bob IS person/)
    } finally {
      controller.abort()
      if (running !== undefined) await running.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

for (const closeFails of [false, true]) {
  test(`filesystem watch failure drains an active refresh before closing the store, close failure=${closeFails}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-watch-active-error-'))
    const controller = new AbortController()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let running: Promise<number> | undefined, active: Promise<void> | undefined
    try {
      const db = join(dir, 'store.db')
      writeFileSync(join(dir, 'map.cave'), '?id IS person\n')
      const seed = open(db)
      try { seed.ingest('source/a HAS path: https://records.test/a.json\nsource/a HAS map: map.cave') }
      finally { seed.close() }
      const stdout = new Capture(), stderr = new Capture()
      let listener!: (event: string, filename: string | Buffer | null) => void
      let scheduled!: () => Promise<void>
      let calls = 0, closed = 0, settled = false
      const subscription = Object.assign(new EventEmitter(), { close: () => {
        closed++
        if (closeFails) throw new Error('watch close failed')
      } })
      running = runConnect(['--db', db, '--watch'], {
        stdout, stderr, signal: controller.signal,
        watch: (_path, callback) => { listener = callback; return subscription },
        schedule: callback => { scheduled = callback; return 1 },
        cancelScheduled: () => {},
        fetchImpl: async () => {
          if (++calls === 2) await gate
          return new Response(JSON.stringify([{ id: calls === 1 ? 'initial' : 'refreshed' }]),
            { headers: { 'content-type': 'application/json' } })
        }
      })
      void running.then(() => { settled = true }, () => { settled = true })
      await until(() => stdout.value.includes('watching'), 'watch setup')
      listener('change', null)
      active = scheduled()
      await until(() => calls === 2, 'pending refresh')
      listener('change', null) // Queue another pass before the subscription fails.
      assert.doesNotThrow(() => subscription.emit('error', new Error('watch failed during refresh')))
      await until(() => closed === 1, 'subscription close before transport settlement')
      assert.equal(settled, false)
      assert.equal(controller.signal.aborted, false)
      listener('change', null)
      release()
      await assert.doesNotReject(active)
      assert.equal(await running, 1)
      assert.equal(calls, 2, 'queued and late callbacks cannot start another pass')
      assert.equal(closed, 1)
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
      assert.match(stderr.value, /watch failed during refresh/)
      if (closeFails) assert.match(stderr.value, /watch close failed/)
      const store = open(db)
      let before: string
      try {
        before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.match(before, /refreshed IS person/, 'the non-cancelled active refresh finishes before store close')
      } finally { store.close() }
      assert.equal(await runConnect(['--db', db], {
        stdout: new Capture(), stderr: new Capture(),
        fetchImpl: async () => new Response('[{"id":"refreshed"}]', { headers: { 'content-type': 'application/json' } })
      }), 0)
      const retry = open(db)
      try { assert.equal(retry.exportText({ tx: true, maxSensitivity: 'restricted' }), before) } finally { retry.close() }
    } finally {
      controller.abort()
      release()
      await active?.catch(() => {})
      if (running !== undefined) await running.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
