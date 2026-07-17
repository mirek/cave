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

    writeFileSync(source, '[]')
    listeners[0]!('change', basename(source))
    listeners[0]!('rename', basename(source))
    listeners[1]!('change', basename(map))
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
