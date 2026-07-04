import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry } from '@cavelang/canonical'
import { open } from '@cavelang/store'

test('registry rebuilds from stored declaration claims on reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-'))
  const path = join(dir, 'test.db')
  try {
    const first = open(path, { registry: Registry.empty })
    first.ingest('WRAPS REVERSE WRAPPED-BY\nMIGRATES IS verb')
    first.close()
    const second = open(path, { registry: Registry.empty })
    assert.equal(Registry.inverseOf(second.registry(), 'WRAPS'), 'WRAPPED-BY')
    assert.ok(Registry.isDeclared(second.registry(), 'MIGRATES'))
    second.ingest('gift WRAPPED-BY paper')
    const [row] = second.currentBeliefs().filter(r => r.verb === 'WRAPS')
    assert.equal(row!.subject, 'paper')
    second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exportText emits canonical text; re-ingest preserves current beliefs', () => {
  const store = open()
  store.ingest([
    'auth/middleware HAS bug: token-expiry #security',
    'server CAUSE crash @ 80%',
    '  WHEN load > ~1000 req/s',
    'packages/api PART-OF monorepo @ 50%',
    'monorepo CONTAINS packages/api @ 90%',
    'OpenAI HAS revenue 20B USD/yr'
  ].join('\n'))
  const text = store.exportText()
  assert.match(text, /monorepo CONTAINS packages\/api/, 'canonical primary direction')
  assert.match(text, /revenue: 20B USD\/yr/, 'canonical colon form')
  assert.match(text, /\n  WHEN load EXCEEDS ~1000 req\/s/, 'qualifier re-indents')
  const copy = open()
  const result = copy.ingest(text)
  assert.equal(result.problems.length, 0)
  const before = store.currentBeliefs().map(row => `${row.claim_key} ${row.conf}`).sort()
  const after = copy.currentBeliefs().map(row => `${row.claim_key} ${row.conf}`).sort()
  assert.deepEqual(after, before)
  store.close()
  copy.close()
})

test('exportText current-only skips superseded rows', () => {
  const store = open()
  store.ingest('x HAS state: a @ 40%')
  store.ingest('x HAS state: b @ 90%')
  const all = store.exportText()
  const current = store.exportText({ current: true })
  assert.match(all, /state: a/)
  assert.match(current, /state: b/)
  assert.doesNotMatch(current, /state: a/)
  store.close()
})

test('append-only: ingest is transactional per call', () => {
  const store = open()
  store.ingest('a USES b')
  const countBefore = (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n
  assert.throws(() => store.ingest('broken uses b', { strict: true }))
  const countAfter = (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n
  assert.equal(countAfter, countBefore, 'failed strict ingest leaves nothing behind')
  store.close()
})

test('per-row tx ids are strictly increasing in document order', () => {
  const store = open()
  const { ids } = store.ingest('a USES b\nc USES d\ne USES f')
  const txs = ids.map(id =>
    (store.db.prepare('SELECT tx FROM cave_claim WHERE id = ?').get(id) as { tx: string }).tx)
  assert.deepEqual([...txs].sort(), txs)
  assert.equal(new Set(txs).size, 3)
  store.close()
})

test('registry rebuild matches in-session semantics: qualifier-condition declarations stay inert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-'))
  const path = join(dir, 'parity.db')
  try {
    const first = open(path, { registry: Registry.empty })
    first.ingest('x USES y\n  BECAUSE FLIES REVERSE FLOWN-BY\nfoo IS verb')
    assert.equal(Registry.inverseOf(first.registry(), 'FLIES'), undefined)
    assert.equal(Registry.isDeclared(first.registry(), 'foo'), false)
    first.ingest('pigeon FLOWN-BY mike @ 40%')
    first.close()
    const second = open(path, { registry: Registry.empty })
    assert.equal(Registry.inverseOf(second.registry(), 'FLIES'), undefined, 'reopen equals close')
    assert.equal(Registry.isDeclared(second.registry(), 'foo'), false)
    second.ingest('pigeon FLOWN-BY mike @ 90%')
    const series = second.currentBeliefs().filter(row => row.raw_line.startsWith('pigeon'))
    assert.equal(series.length, 1, 'one fact, one belief series across reopen')
    assert.equal(series[0]!.conf, 0.9)
    second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('current export preserves WHEN edges shared across parents (dangling-edge remap)', () => {
  const store = open()
  store.ingest('api CAUSE timeout @ 70%\n  WHEN high-load\ndb CAUSE timeout @ 60%\n  WHEN high-load')
  const text = store.exportText({ current: true })
  assert.equal(text, [
    'api CAUSE timeout @ 70%',
    '  WHEN high-load',
    'db CAUSE timeout @ 60%',
    '  WHEN high-load',
    ''
  ].join('\n'))
  store.close()
})

test('current export never promotes orphaned conditions to top-level facts', () => {
  const store = open()
  store.ingest('server CAUSE crash @ 80%\n  WHEN memory-leak')
  store.ingest('server CAUSE crash @ 95%')
  const text = store.exportText({ current: true })
  assert.equal(text, 'server CAUSE crash @ 95%\n  WHEN memory-leak\n')
  store.close()
})
