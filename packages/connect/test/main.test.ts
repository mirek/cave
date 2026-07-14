import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runConnect } from '@cavelang/connect'

type Captured = { code: number, out: string, err: string }

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
    const matches = JSON.parse(json.out) as { bindings: Record<string, string> }[]
    assert.deepEqual(matches.map(match => match.bindings['who']), ['alice'])
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
