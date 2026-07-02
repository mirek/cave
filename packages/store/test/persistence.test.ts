import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry } from '@cave/canonical'
import { open } from '@cave/store'

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
