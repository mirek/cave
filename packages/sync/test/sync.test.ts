import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Uuidv7 } from '@cavelang/core'
import { open } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { isStoreFile, labelOf, sanitizeLabel, syncDb, syncFile, syncText } from '@cavelang/sync'

const scratch = (): { dir: string, done: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-sync-'))
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const rowCount = (store: Store): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

const rowIds = (store: Store): Set<string> =>
  new Set((store.db.prepare('SELECT id FROM cave_claim').all() as { id: string }[]).map(row => row.id))

test('labelOf and sanitizeLabel produce one entity token', () => {
  assert.equal(labelOf('laptop.db'), 'laptop')
  assert.equal(labelOf('/backups/main store.db'), 'main-store')
  assert.equal(labelOf('notes.backup.cave'), 'notes.backup')
  assert.equal(labelOf('.db'), 'store')
  assert.equal(sanitizeLabel('my label; #1 @home'), 'my-label-1-home')
  assert.equal(sanitizeLabel(''), 'store')
})

test('db merge unions disjoint stores — rows verbatim, side tables, record (spec §28.1, §28.3)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    a.ingest('auth USES jwt @ 90%', { source: 'cli' })
    const b = open(join(dir, 'b.db'))
    b.ingest('billing USES postgres @src:maria #security ; from the runbook\n  WHEN production EXISTS')
    const bIds = rowIds(b)
    b.close()

    const report = syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a' })
    assert.equal(report.merged, 2, 'claim + WHEN condition')
    assert.equal(report.edges, 1)
    assert.equal(report.skipped, 0)
    assert.equal(report.dryRun, false)
    assert.equal(report.record, 'store/b SYNCED-INTO store/a ; +2 claim(s), +1 edge(s)')

    // Merged rows keep their origin identity byte for byte.
    for (const id of bIds) {
      assert.ok(rowIds(a).has(id), `merged row ${id} keeps its id`)
    }
    // Side tables came along: context, tag, comment, FTS.
    const merged = a.currentBeliefs().find(row => row.verb === 'USES' && row.object === 'postgres')!
    assert.deepEqual(a.toClaim(merged).contexts, ['src:maria'])
    assert.deepEqual(a.toClaim(merged).tags, [{ key: 'security' }])
    assert.equal(merged.comment, 'from the runbook')
    assert.equal(a.search('postgres').length, 1)
    const edges = a.edgesOf(merged.id)
    assert.equal(edges.length, 1)
    assert.equal(edges[0]!.role, 'WHEN')
    assert.equal(edges[0]!.child.subject, 'production')

    // The §28.3 record: stamped @src:sync, declaration appended in-band.
    const record = a.byContext('src:sync').filter(row => row.verb === 'SYNCED-INTO')
    assert.equal(record.length, 1)
    assert.equal(record[0]!.subject, 'store/b')
    assert.equal(record[0]!.object, 'store/a')
    const declaration = a.currentBeliefs().find(row => row.subject === 'SYNCED-INTO' && row.verb === 'IS')
    assert.equal(declaration?.object, 'verb')
    a.close()
  } finally {
    done()
  }
})

test('re-sync is idempotent: nothing merges, no record appends (spec §28.1, §28.3)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    const b = open(join(dir, 'b.db'))
    b.ingest('x NEEDS y\ny NEEDS z')
    b.close()
    syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a' })
    const after = rowCount(a)

    const again = syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a' })
    assert.equal(again.merged, 0)
    assert.equal(again.skipped, 2)
    assert.equal(again.edges, 0)
    assert.equal(again.record, undefined)
    assert.equal(rowCount(a), after, 'an idle sync appends nothing — record included')
    a.close()
  } finally {
    done()
  }
})

test('incremental sync merges only new rows and edges into earlier rows (spec §28.1)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    const b = open(join(dir, 'b.db'))
    const first = b.ingest('outage CAUSED-BY bad-deploy')
    syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a' })

    // b grows: one new claim, plus an edge from the new row into the old one.
    const second = b.ingest('bad-deploy CONTAINS schema-change')
    b.appendEdges([{ parentId: second.ids[0]!, role: 'BECAUSE', childId: first.ids[0]! }])
    b.close()

    const report = syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a' })
    assert.equal(report.merged, 1)
    assert.equal(report.edges, 1)
    const edges = a.edgesOf(second.ids[0]!)
    assert.equal(edges[0]!.child.id, first.ids[0]!, 'edge lands on the row merged earlier')
    // The record series is a log: same claim key, one row per effective merge.
    const records = a.history(a.byContext('src:sync').find(row => row.verb === 'SYNCED-INTO')!.claim_key)
    assert.equal(records.length, 2)
    a.close()
  } finally {
    done()
  }
})

test('bidirectional sync converges both stores to one row set (spec §28.1)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    a.ingest('alpha IS red')
    const b = open(join(dir, 'b.db'))
    b.ingest('beta IS blue')

    syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a' })
    a.close()
    const reverse = syncDb(b, join(dir, 'a.db'), { from: 'a', into: 'b' })
    assert.ok(reverse.merged >= 2, 'alpha claim + a-side bookkeeping')

    const aIds = rowIds(open(join(dir, 'a.db')))
    const bIds = rowIds(b)
    for (const id of aIds) {
      assert.ok(bIds.has(id), 'b holds everything a holds')
    }
    // b additionally holds only its own merge record.
    const extra = [...bIds].filter(id => !aIds.has(id))
    const own = b.byContext('src:sync').filter(row => row.subject === 'store/a')
    assert.deepEqual(extra.sort(), own.map(row => row.id).sort())
    b.close()
  } finally {
    done()
  }
})

test('the same fact recorded on both machines: one series, two rows, latest wins (spec §28.1, §9.4)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    a.ingest('sky HAS color: blue @ 60%')
    const b = open(join(dir, 'b.db'))
    b.ingest('sky HAS color: blue @ 80%')
    b.close()

    syncDb(a, join(dir, 'b.db'))
    const current = a.currentBeliefs().find(row => row.attribute === 'color')!
    assert.equal(a.history(current.claim_key).length, 2, 'asserted twice, which is what happened')
    assert.equal(current.conf, 0.8, 'later origin timestamp is current')
    a.close()
  } finally {
    done()
  }
})

test('sync preserves retracted history and sensitive raw text (spec §9.6, §28.1)', () => {
  const { dir, done } = scratch()
  try {
    const source = open(join(dir, 'source.db'))
    source.ingest('credential HAS token: "sk-live-secret" @src:ops')
    source.ingest('credential HAS token: redacted @src:ops @ 0%')
    source.close()

    const target = open(join(dir, 'target.db'))
    const report = syncDb(target, join(dir, 'source.db'), { record: false })
    assert.equal(report.merged, 2)
    assert.match(target.exportText(), /sk-live-secret/)
    assert.equal(target.search('sk-live-secret').length, 1)
    target.close()
  } finally {
    done()
  }
})

test('merged in-band declarations take effect without reopening (spec §28.1)', () => {
  const { dir, done } = scratch()
  try {
    const b = open(join(dir, 'b.db'))
    b.ingest('MENTORS REVERSE MENTORED-BY\nalice MENTORS bob')
    b.close()
    const a = open(join(dir, 'a.db'))
    syncDb(a, join(dir, 'b.db'))
    const reads = a.reverse('bob')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]!.rel, 'MENTORED-BY', 'merged REVERSE declaration reloaded')
    assert.equal(reads[0]!.source, 'alice')
    a.close()
  } finally {
    done()
  }
})

test('dry run reports the full merge and persists nothing (spec §28.5)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    const b = open(join(dir, 'b.db'))
    b.ingest('x NEEDS y')
    b.close()
    const before = rowCount(a)
    const report = syncDb(a, join(dir, 'b.db'), { from: 'b', into: 'a', dryRun: true })
    assert.equal(report.merged, 1)
    assert.equal(report.dryRun, true)
    assert.equal(report.record, 'store/b SYNCED-INTO store/a ; +1 claim(s), +0 edge(s)')
    assert.equal(rowCount(a), before, 'rolled back')
    assert.equal(a.byContext('src:sync').length, 0)
    a.close()
  } finally {
    done()
  }
})

test('record: false skips the merge record; self-sync is a no-op', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    const b = open(join(dir, 'b.db'))
    b.ingest('x NEEDS y')
    b.close()
    const report = syncDb(a, join(dir, 'b.db'), { record: false })
    assert.equal(report.merged, 1)
    assert.equal(report.record, undefined)
    assert.equal(a.byContext('src:sync').length, 0)

    const self = syncDb(a, join(dir, 'a.db'))
    assert.equal(self.merged, 0)
    assert.equal(self.record, undefined)
    a.close()
  } finally {
    done()
  }
})

test('source validation: missing file, non-store database, text file', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    assert.throws(() => syncDb(a, join(dir, 'missing.db')), /no such file/)

    const other = new DatabaseSync(join(dir, 'other.db'))
    other.exec('CREATE TABLE unrelated (x)')
    other.close()
    assert.throws(() => syncDb(a, join(dir, 'other.db')), /not a CAVE store/)

    writeFileSync(join(dir, 'notes.cave'), 'x NEEDS y\n')
    assert.throws(() => syncDb(a, join(dir, 'notes.cave')), /not a CAVE store/)
    assert.equal(rowCount(a), 0, 'failed syncs leave the store untouched')
    a.close()
  } finally {
    done()
  }
})

test('annotated text round-trips a store: identity, edges, values, negation, retraction (spec §28.4)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    a.ingest([
      'auth/middleware USES jwt @ 90% @production #security ; review',
      'packages/api PART-OF monorepo',                    // inverse-written: stored canonical
      'OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr',
      'server IS NOT compromised @ 90%',
      'legacy IS supported @ 0%',                         // retraction
      'deploy CAUSE outage @ 70%',
      '  BECAUSE logs',
      '  WHEN production EXISTS'
    ].join('\n'), { source: 'cli' })
    const text = a.exportText({ tx: true })
    assert.match(text, /^;@ [0-9a-f-]{36}\n/, 'every claim line is annotated')

    const b = open(join(dir, 'b.db'))
    const report = syncText(b, text, { from: 'a', into: 'b' })
    assert.equal(report.merged, 8)
    assert.equal(report.edges, 2)
    assert.deepEqual(report.problems, [])

    const pick = 'SELECT id, tx, subject, verb, negated, object, attribute, value_text, value_num, value_unit, delta_text, conf, claim_key FROM cave_claim WHERE verb <> \'SYNCED-INTO\' AND subject <> \'SYNCED-INTO\' ORDER BY tx'
    assert.deepEqual(b.db.prepare(pick).all(), a.db.prepare(pick).all(), 'rows replay under their identity')
    const edgeSql = 'SELECT parent_id, role, child_id FROM cave_edge ORDER BY parent_id, role, child_id'
    assert.deepEqual(b.db.prepare(edgeSql).all(), a.db.prepare(edgeSql).all())

    const again = syncText(b, text, { from: 'a', into: 'b' })
    assert.equal(again.merged, 0)
    assert.equal(again.skipped, 8)
    assert.equal(again.edges, 0)
    assert.equal(again.record, undefined)
    b.close()
    a.close()
  } finally {
    done()
  }
})

test('annotated text is strict: unannotated claims, malformed ids, conflicting duplicates, orphans all reject whole (spec §28.4)', () => {
  const tx = () => Uuidv7.next()
  const store = open()
  const cases: [string, RegExp][] = [
    ['x NEEDS y\n', /without a transaction annotation.*cave import/],
    [`;@ not-a-uuid\nx NEEDS y\n`, /malformed transaction annotation/],
    [`;@ ${tx()}\n\nx NEEDS y\n`, /does not precede a claim line/],
    [(id => `;@ ${id}\nx NEEDS y\n;@ ${id}\ny NEEDS z\n`)(tx()), /repeats line 2's id with different content/]
  ]
  for (const [text, message] of cases) {
    const report = syncText(store, text)
    assert.equal(report.merged, 0, text)
    assert.ok(report.problems.some(problem => message.test(problem.message)), `${text} → ${message}`)
  }
  assert.equal(rowCount(store), 0, 'rejected text merges nothing')
  store.close()
})

test('a re-stated row — one id, several parents — unions back into one row with every edge (spec §28.4)', () => {
  const { dir, done } = scratch()
  try {
    // Two derivations citing one premise row and one shared VIA row — the
    // §24.3 shape whose export used to repeat ids and reject its own text.
    const a = open(join(dir, 'a.db'))
    const premise = a.ingest('deploy PRECEDES outage', { source: 'cli' }).ids[0]!
    const rule = a.ingest('rule/r HAS rule: `x`', { source: 'cave-derive' }).ids[0]!
    const one = a.ingest('deploy CAUSE outage @src:rule/r').ids[0]!
    const two = a.ingest('deploy CAUSE rollback @src:rule/r').ids[0]!
    a.appendEdges([
      { parentId: one, role: 'BECAUSE', childId: premise },
      { parentId: one, role: 'VIA', childId: rule },
      { parentId: two, role: 'BECAUSE', childId: premise },
      { parentId: two, role: 'VIA', childId: rule }
    ])
    const text = a.exportText({ tx: true })
    assert.equal(
      (text.match(new RegExp(premise, 'g')) ?? []).length, 2,
      'the shared premise is re-stated under its second parent'
    )

    const b = open(join(dir, 'b.db'))
    const report = syncText(b, text, { from: 'a', into: 'b' })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 4, 'four rows, however many statements')
    assert.equal(report.skipped, 2, 're-statements skip as already present')
    assert.equal(report.edges, 4)
    const edgeSql = 'SELECT parent_id, role, child_id FROM cave_edge ORDER BY parent_id, role, child_id'
    assert.deepEqual(b.db.prepare(edgeSql).all(), a.db.prepare(edgeSql).all(), 'every edge survives the trip')

    const again = syncText(b, text, { from: 'a', into: 'b' })
    assert.equal(again.merged, 0)
    assert.equal(again.edges, 0)
    b.close()
    a.close()
  } finally {
    done()
  }
})

test('syncFile sniffs the source: store files merge through SQL, text through the pipeline (spec §28.5)', () => {
  const { dir, done } = scratch()
  try {
    const b = open(join(dir, 'b.db'))
    b.ingest('x NEEDS y')
    const annotated = b.exportText({ tx: true })
    b.close()
    assert.equal(isStoreFile(join(dir, 'b.db')), true)

    const a = open(join(dir, 'a.db'))
    const viaDb = syncFile(a, join(dir, 'b.db'), { into: 'a' })
    assert.equal(viaDb.merged, 1)
    assert.equal(viaDb.record, 'store/b SYNCED-INTO store/a ; +1 claim(s), +0 edge(s)', 'label defaults to the basename stem')

    writeFileSync(join(dir, 'b.cave'), annotated)
    assert.equal(isStoreFile(join(dir, 'b.cave')), false)
    const viaText = syncFile(a, join(dir, 'b.cave'), { into: 'a' })
    assert.equal(viaText.merged, 0, 'same identity arrives from either shape')
    assert.equal(viaText.skipped, 1)
    a.close()
  } finally {
    done()
  }
})

test('interchange replay never stamps: merged rows keep exported claim keys (spec §9.5, §28.1)', () => {
  const { dir, done } = scratch()
  try {
    const a = open(join(dir, 'a.db'))
    a.ingest('auth USES jwt', { source: 'cli' })
    const text = a.exportText({ tx: true })
    const b = open(join(dir, 'b.db'))
    syncText(b, text)
    const merged = b.currentBeliefs().find(row => row.verb === 'USES')!
    assert.deepEqual(b.toClaim(merged).contexts, ['src:cli'], 'the origin stamp, not a fresh one')
    assert.equal(merged.claim_key, a.currentBeliefs().find(row => row.verb === 'USES')!.claim_key)
    b.close()
    a.close()
  } finally {
    done()
  }
})

test('the branching convention: checkout, work, review diff, union merge, landing (spec §28.6)', () => {
  const { dir, done } = scratch()
  try {
    // The committed text is the full annotated export — the text is the store.
    const main = open(join(dir, 'main.db'))
    main.ingest('auth USES jwt @ 90%\napi IS service', { source: 'cli' })
    const committed = main.exportText({ tx: true })

    // Checkout: a working store rebuilt from the text; plumbing appends no bookkeeping.
    const work = open(join(dir, 'work.db'))
    const checkout = syncText(work, committed, { record: false })
    assert.equal(checkout.merged, 2)
    assert.equal(checkout.record, undefined)
    assert.equal(rowCount(work), 2, 'a checkout is not a merge event')

    // Work appends outsort the seed (§28.2), so the review diff is the appended
    // claims: the committed text is a prefix of the branch's re-export.
    work.ingest('api HAS owner: platform-team', { source: 'cli' })
    const reviewed = work.exportText({ tx: true })
    assert.ok(reviewed.startsWith(committed), 'review reads as pure additions')

    // Main advanced meanwhile — a git-level collision at the file's end. The
    // merge-driver move: union both texts in a fresh store and re-export.
    main.ingest('auth USES jwt @ 40%', { source: 'cli' })
    const theirs = main.exportText({ tx: true })
    const union = open(join(dir, 'union.db'))
    syncText(union, reviewed, { record: false })
    syncText(union, theirs, { record: false })
    const merged = union.exportText({ tx: true })
    const lines = new Set(merged.split('\n'))
    for (const line of [...reviewed.split('\n'), ...theirs.split('\n')]) {
      assert.ok(lines.has(line), `union keeps every reviewed line: ${line}`)
    }
    union.close()

    // Landing is a sync and a real merge event: present rows skip, the branch's
    // appends arrive, the record is the distribution history. Re-landing is idle.
    const landing = syncText(main, merged, { from: 'reorg-auth', into: 'main' })
    assert.equal(landing.merged, 1, "exactly the branch's work arrives")
    assert.equal(landing.skipped, 3)
    assert.match(landing.record!, /^store\/reorg-auth SYNCED-INTO store\/main /)
    const again = syncText(main, merged, { from: 'reorg-auth', into: 'main' })
    assert.equal(again.merged, 0)
    assert.equal(again.record, undefined)
    work.close()

    // The lighter opening move (§28.4): a --current --tx seed leaves superseded
    // rows behind and still merges back without duplication.
    const seed = main.exportText({ tx: true, current: true })
    assert.ok(!seed.includes('@ 90%'), 'the seed carries current beliefs only')
    const light = open(join(dir, 'light.db'))
    syncText(light, seed, { record: false })
    light.ingest('billing IS service', { source: 'cli' })
    const back = syncText(main, light.exportText({ tx: true }), { from: 'light', into: 'main' })
    assert.equal(back.merged, 1, 'only the light branch appends arrive')
    light.close()
    main.close()
  } finally {
    done()
  }
})

// Clock-skew tests fabricate future transaction ids; they run last because
// observing them raises the process generator's floor (spec §28.2) — the
// intended behavior, but every later mint in this file would sit above it.

const futureId = (offsetMs: number, seq = 0): string =>
  Uuidv7.at(Date.now() + offsetMs, seq, new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]))

/** Copies the store's single claim row under a fabricated id/tx, bypassing the generator. */
const smuggleFutureRow = (path: string, id: string): void => {
  const db = new DatabaseSync(path)
  db.prepare(`INSERT INTO cave_claim (id, tx, subject, verb, negated, object, attribute,
      value_text, value_num, value_unit, value_approx, delta_text, delta_num, delta_unit,
      sigma_level, conf, importance, comment, raw_line, claim_key)
    SELECT ?, ?, subject, verb, negated, object, attribute,
      value_text, value_num, value_unit, value_approx, delta_text, delta_num, delta_unit,
      sigma_level, 0.4, importance, comment, raw_line, claim_key
    FROM cave_claim LIMIT 1`).run(id, id)
  db.close()
}

test('receive rule: local appends after a merge outsort merged future rows (spec §28.2)', () => {
  const { dir, done } = scratch()
  try {
    const b = open(join(dir, 'b.db'))
    b.ingest('server HAS load: 90')
    b.close()
    const skewed = futureId(60 * 60 * 1000) // an hour ahead
    smuggleFutureRow(join(dir, 'b.db'), skewed)

    const a = open(join(dir, 'a.db'))
    syncDb(a, join(dir, 'b.db'))
    assert.equal(a.currentBeliefs().find(row => row.attribute === 'load')!.tx, skewed)

    const local = a.ingest('server HAS load: 10')
    const current = a.currentBeliefs().find(row => row.attribute === 'load')!
    assert.equal(current.id, local.ids[0], 'new local knowledge is newest here')
    assert.ok(current.tx > skewed)
    a.close()
  } finally {
    done()
  }
})

test('receive rule holds across reopen: open() observes MAX(tx) (spec §28.2)', () => {
  const { dir, done } = scratch()
  try {
    const path = join(dir, 'c.db')
    const c = open(path)
    c.ingest('cache HAS ttl: 60 s')
    c.close()
    const skewed = futureId(2 * 60 * 60 * 1000, 1)
    smuggleFutureRow(path, skewed)

    const reopened = open(path)
    const appended = reopened.ingest('cache HAS ttl: 30 s')
    const current = reopened.currentBeliefs().find(row => row.attribute === 'ttl')!
    assert.equal(current.id, appended.ids[0])
    assert.ok(current.tx > skewed)
    reopened.close()
  } finally {
    done()
  }
})

test('text dry runs leave future transaction ids unobserved', () => {
  const store = open()
  const uncommitted = futureId(4 * 60 * 60 * 1000, 0x800)
  const report = syncText(store, `;@ ${uncommitted}\nremote EXISTS\n`, {
    dryRun: true,
    record: false
  })
  assert.equal(report.merged, 1)
  assert.equal(rowCount(store), 0, 'the remote row rolled back')

  const local = store.ingest('local EXISTS').ids[0]!
  assert.ok(local < uncommitted, `${local} stays below uncommitted ${uncommitted}`)
  store.close()
})
