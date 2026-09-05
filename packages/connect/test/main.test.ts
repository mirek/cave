import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Writable } from 'node:stream'
import { runConnect } from '@cavelang/connect'
import { open } from '@cavelang/store'

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

/** Runs the CLI entry with stdout/stderr captured, returning the exit code. */
const captured = async (argv: readonly string[]): Promise<Captured> => {
  const writes = { out: '', err: '' }
  const original = { out: process.stdout.write, err: process.stderr.write }
  process.stdout.write = (chunk: string | Uint8Array) => {
    writes.out += String(chunk)
    return true
  }
  process.stderr.write = (chunk: string | Uint8Array) => {
    writes.err += String(chunk)
    return true
  }
  try {
    return { code: await runConnect(argv), out: writes.out, err: writes.err }
  } finally {
    process.stdout.write = original.out
    process.stderr.write = original.err
  }
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

    controller.abort()
    assert.equal(await running, 0)
    assert.deepEqual(closed, [true, true])
    assert.equal(scheduled.size, 0)
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
    assert.match(only.out, /^source\/remap: .*\nsource\/people: 1 record\(s\): 1 mapped/)
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
    assert.match(again.out, /source\/registry: 1 record\(s\): 0 mapped, 1 skipped.*\nsource\/child: .*\+1 claim\(s\), 1 retracted/, 'the parent record is unchanged, yet the child it owns through that record runs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
