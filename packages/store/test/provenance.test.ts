import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, type Store } from '@cavelang/store'

const contextsOf = (store: Store, at = 0): readonly string[] =>
  store.toClaim(store.currentBeliefs()[at]!).contexts

test('source stamps @src: before the claim key is computed (spec §9.5)', () => {
  const store = open()
  store.ingest('auth USES jwt @ 90%', { source: 'cli' })
  const [row] = store.currentBeliefs()
  assert.deepEqual(contextsOf(store), ['src:cli'])
  assert.match(row!.claim_key, /src:cli/, 'the stamp is part of claim identity')
  assert.equal(row!.raw_line, 'auth USES jwt @ 90%', 'raw_line stays as written')
  store.close()
})

test('a written @src: context wins over the stamp (spec §9.5)', () => {
  const store = open()
  store.ingest('auth USES jwt @src:design-doc', { source: 'cli' })
  assert.deepEqual(contextsOf(store), ['src:design-doc'])
  store.close()
})

test('lifecycle stamping adds the stamp alongside an authored source (spec §9.5)', () => {
  const store = open()
  store.ingest('auth USES jwt @src:design-doc', { source: 'rule/abc123', lifecycle: true })
  assert.deepEqual(contextsOf(store), ['src:design-doc', 'src:rule/abc123'])
  store.close()
})

test('lifecycle stamping never duplicates an already-present stamp (spec §9.5)', () => {
  const store = open()
  store.ingest('auth USES redis @src:rule/abc123', { source: 'rule/abc123', lifecycle: true })
  assert.deepEqual(contextsOf(store), ['src:rule/abc123'])
  store.close()
})

test('actor, physical source, lifecycle run, and domain are distinct dimensions', () => {
  const store = open()
  const result = store.ingest(
    'auth USES jwt @src:docs/auth%20design.md#L7-L9 @scope:identity',
    { source: 'cli', provenance: { domains: ['tenant/acme'] } }
  )
  const row = store.currentBeliefs().find(candidate => candidate.id === result.ids[0])!
  assert.deepEqual(store.provenanceOf(row), {
    actors: ['cli'],
    sources: ['docs/auth design.md'],
    runs: [],
    domains: ['identity', 'tenant/acme']
  })
  assert.equal(store.byProvenance('actor', 'cli')[0]?.id, row.id)
  assert.equal(store.byProvenance('source', 'docs/auth design.md')[0]?.id, row.id)
  assert.equal(store.byProvenance('domain', 'identity')[0]?.id, row.id)
  assert.deepEqual([...store.toClaim(row).contexts].sort(), [
    'scope:identity',
    'src:docs/auth%20design.md#L7-L9'
  ], 'compatibility contexts and claim identity stay unchanged')
  store.close()
})

test('lifecycle ownership is explicit and cannot be displaced by an authored source', () => {
  const store = open()
  store.ingest('api USES postgres @src:inventory', {
    source: 'action/deploy',
    lifecycle: true
  })
  const [row] = store.byProvenance('run', 'action/deploy')
  assert.ok(row)
  assert.deepEqual(store.provenanceOf(row!), {
    actors: ['action/deploy'],
    sources: ['inventory'],
    runs: ['action/deploy'],
    domains: []
  })
  assert.deepEqual([...store.toClaim(row!).contexts].sort(), ['src:action/deploy', 'src:inventory'])
  store.close()
})

test('opening a legacy store backfills safely inferable provenance dimensions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-provenance-'))
  const path = join(dir, 'legacy.db')
  try {
    const initial = open(path)
    initial.ingest('api USES postgres @src:inventory @scope:billing', {
      source: 'rule/abc123',
      lifecycle: true
    })
    const id = initial.currentBeliefs()[0]!.id
    initial.close()
    const legacy = new DatabaseSync(path)
    legacy.exec('DROP TABLE cave_provenance')
    legacy.exec('PRAGMA user_version = 0')
    legacy.close()

    const upgraded = open(path)
    assert.deepEqual(upgraded.provenanceOf(id), {
      actors: ['rule/abc123'],
      sources: ['inventory'],
      runs: ['rule/abc123'],
      domains: ['billing']
    })
    assert.equal(upgraded.exportText(), 'api USES postgres @scope:billing @src:inventory @src:rule/abc123\n')
    upgraded.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('non-source contexts do not suppress the stamp (spec §9.5)', () => {
  const store = open()
  store.ingest('memory-leak EXISTS @production', { source: 'cli' })
  assert.deepEqual(contextsOf(store), ['production', 'src:cli'])
  store.close()
})

test('appends without a source stay unstamped — the import path (spec §9.5)', () => {
  const store = open()
  store.ingest('auth USES jwt')
  assert.deepEqual(contextsOf(store), [])
  store.close()
})

test('same actor evolves one series; different actors coexist (spec §9.4, §9.5)', () => {
  const store = open()
  store.ingest('server IS healthy @ 80%', { source: 'cli' })
  store.ingest('server IS healthy @ 40%', { source: 'cli' })
  assert.equal(store.currentBeliefs().length, 1, 'same stamp, same key')
  assert.equal(store.currentBeliefs()[0]!.conf, 0.4)
  store.ingest('server IS healthy @ 90%', { source: 'agent/claude' })
  const current = store.currentBeliefs()
  assert.equal(current.length, 2, 'different actors keep separate belief series')
  assert.deepEqual(current.map(row => row.conf).sort(), [0.4, 0.9])
  store.close()
})

test('cross-actor retraction restates with the original source context (spec §9.5)', () => {
  const store = open()
  store.ingest('server IS healthy', { source: 'agent/claude' })
  store.ingest('server IS healthy @src:agent/claude @ 0%', { source: 'cli' })
  const [row] = store.currentBeliefs()
  assert.equal(row!.conf, 0, 'the explicit context lands in the agent series')
  assert.equal(store.history(row!.claim_key).length, 2)
  store.close()
})

test('qualifier conditions and in-band declarations are stamped too (spec §9.5)', () => {
  const store = open()
  const result = store.ingest('server CAUSE crash @ 80%\n  WHEN memory-leak', { source: 'cli' })
  const [condition] = store.edgesOf(result.ids[0]!)
  assert.equal(condition!.role, 'WHEN')
  assert.deepEqual(store.toClaim(condition!.child).contexts, ['src:cli'])
  store.ingest('WRAPS REVERSE WRAPPED-BY', { source: 'cli' })
  store.ingest('gift WRAPPED-BY paper', { source: 'cli' })
  const declaration = store.currentBeliefs().find(row => row.verb === 'REVERSE')
  assert.deepEqual(store.toClaim(declaration!).contexts, ['src:cli'], 'schema changes are attributable')
  assert.equal(store.forward('paper')[0]!.target, 'gift', 'declaration still registers')
  store.close()
})

test('stamped stores round-trip: export text replays to the same claim keys (spec §2.2, §9.5)', () => {
  const first = open()
  first.ingest('auth USES jwt @ 90%\nmemory-leak EXISTS @production', { source: 'cli' })
  const second = open()
  second.ingest(first.exportText())
  const keysOf = (store: Store): string[] =>
    store.currentBeliefs().map(row => row.claim_key).sort()
  assert.deepEqual(keysOf(second), keysOf(first))
  first.close()
  second.close()
})
