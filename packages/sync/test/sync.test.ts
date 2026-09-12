import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Registry, txOfLine } from '@cavelang/canonical'
import { Claim, Confidence, Uuidv7 } from '@cavelang/core'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import type { Store } from '@cavelang/store'
import { isStoreFile, labelOf, sanitizeLabel, syncDb, syncFile, syncText } from '@cavelang/sync'

test('large malformed text sync retains all diagnostics and rejects the whole source', () => {
  const store = open()
  const size = 130_000
  try {
    store.ingest('existing IS preserved')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const valid = `;@ ${Uuidv7.next()}\nimported EXISTS\n`
    const text = valid + Array.from({ length: size }, () => 'broken').join('\n')
    for (const dryRun of [false, true]) {
      const result = syncText(store, text, { dryRun })
      assert.equal(result.merged, 0)
      assert.equal(result.skipped, 0)
      assert.equal(result.edges, 0)
      assert.equal(result.record, undefined)
      assert.equal(result.problems.length, size)
      for (let i = 0; i < size; i++) assert.equal(result.problems[i]!.line, i + 3)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const corrected = syncText(store, valid, { record: false })
    assert.deepEqual(corrected.problems, [])
    assert.equal(corrected.merged, 1)
    assert.equal(syncText(store, valid, { record: false }).merged, 0)
  } finally { store.close() }
})

const scratch = (): { dir: string, done: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-sync-'))
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const rowCount = (store: Store): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

const rowIds = (store: Store): Set<string> =>
  new Set((store.db.prepare('SELECT id FROM cave_claim').all() as { id: string }[]).map(row => row.id))

test('annotated self-edge exports replay with one identity and remain idempotent', () => {
  for (const remapped of [false, true]) for (const role of ['WHEN', 'VIA', 'BECAUSE', 'QUALIFIES'] as const) {
    const source = open(), target = open()
    try {
      const first = source.ingest('claim EXISTS @ 70%').ids[0]!
      const current = remapped ? source.ingest('claim EXISTS @ 90%').ids[0]! : first
      source.appendEdges([{ parentId: current, childId: first, role }])
      const text = source.exportText({ current: true, tx: true, maxSensitivity: 'restricted' })
      for (const merged of [1, 0]) {
        const result = syncText(target, text, { record: false })
        assert.deepEqual(result.problems, [], `${role}, remapped=${remapped}`)
        assert.equal(result.merged, merged)
        assert.equal(rowCount(target), 1)
        assert.deepEqual(rowIds(target), new Set([current]))
        const edges = target.edgesOf(current)
        assert.equal(edges.length, 1)
        assert.equal(edges[0]!.role, role)
        assert.equal(edges[0]!.child.id, current)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), text)
      }
    } finally { target.close(); source.close() }
  }
})

test('annotated text sync preserves subnormal confidence across retraction and reassertion', () => {
  const source = open(), target = open()
  try {
    const confidences = [Number.MIN_VALUE, 0, 2 * Number.MIN_VALUE]
    for (const conf of confidences) {
      source.ingest(`sample IS observed @ ${Confidence.formatExact(conf)}`, { strict: true })
      const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
      const result = syncText(target, text, { record: false })
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 1)
      assert.equal(target.currentBeliefs()[0]!.conf, conf)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), text)
      assert.equal(syncText(target, text, { record: false }).merged, 0)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), text)
    }
    assert.equal(rowCount(target), 3)
    assert.deepEqual(rowIds(target), rowIds(source))
  } finally { target.close(); source.close() }
})

test('text sync captures one dry-run decision for execution and reporting', () => {
  const source = open()
  try {
    source.ingest('api IS service')
    const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const dryRun of [true, false]) {
      const target = open()
      try {
        target.ingest('local IS retained')
        const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
        let reads = 0
        const report = syncText(target, text, {
          record: false,
          get dryRun() { return ++reads === 1 ? dryRun : !dryRun }
        })
        assert.deepEqual(report.problems, [])
        assert.equal(report.merged, 1)
        assert.equal(report.dryRun, dryRun)
        assert.equal(reads, 1)
        if (dryRun) assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        else assert.equal(query(target, 'api IS service').length, 1)
      } finally { target.close() }
    }
  } finally { source.close() }
})

for (const mode of ['database', 'text'] as const) for (const dryRun of [false, true]) {
  test(`merge record failure restores copied state and allows retry (${mode}, dryRun=${dryRun})`, () => {
    const { dir, done } = scratch()
    const sourcePath = join(dir, 'source.db')
    const source = open(sourcePath), target = open()
    try {
      source.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api\n  WHEN review IS complete', {
        source: 'agent/reviewer', provenance: { sources: ['manual'], domains: ['team/platform'], run: 'review/1' }
      })
      const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const registry = target.registry()
      const provenanceCount = () => target.db.prepare('SELECT COUNT(*) AS n FROM cave_provenance').get()!.n
      const provenanceBefore = provenanceCount()
      target.db.exec(`CREATE TRIGGER reject_sync_record BEFORE INSERT ON cave_claim
        WHEN NEW.verb = 'SYNCED-INTO' BEGIN SELECT RAISE(ABORT, 'merge record rejected'); END`)
      const sync = (preview: boolean) => mode === 'database'
        ? syncDb(target, sourcePath, { dryRun: preview })
        : syncText(target, text, { dryRun: preview })
      assert.throws(() => sync(dryRun), /merge record rejected/)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(target.registry(), registry)
      assert.equal(Registry.isDeclared(target.registry(), 'MANAGES'), false)
      assert.equal(provenanceCount(), provenanceBefore)
      assert.equal(target.db.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'cave_sync_src'").get(), undefined)
      assert.equal(target.db.prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'cave_sync_new'").get(), undefined)
      target.db.exec('DROP TRIGGER reject_sync_record')
      const retry = sync(false)
      assert.deepEqual(retry.problems, [])
      assert.equal(retry.merged, 4)
      assert.equal(retry.edges, 1)
      assert.ok(retry.record)
      assert.equal(Registry.primaryOf(target.registry(), 'MANAGED-BY').isInverse, true)
      const imported = source.currentBeliefs().find(row => row.subject === 'alice')!
      assert.deepEqual(target.provenanceOf(imported.id), source.provenanceOf(imported.id))
      assert.equal(sync(false).merged, 0)
    } finally { source.close(); target.close(); done() }
  })
}

test('edge-only sync rolls back rejected bookkeeping and recovers without recopying claims', () => {
  for (const mode of ['database', 'text'] as const) {
    const { dir, done } = scratch()
    const sourcePath = join(dir, 'source.db')
    const source = open(sourcePath), target = open()
    try {
      const [parent, child] = source.ingest('job IS task\nreview IS complete').ids
      assert.equal(syncDb(target, sourcePath, { record: false }).merged, 2)
      source.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(parent!, 'WHEN', child!)
      const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
      const sync = () => mode === 'database' ? syncDb(target, sourcePath) : syncText(target, text)
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      target.db.exec(`CREATE TRIGGER reject_edge_sync_record BEFORE INSERT ON cave_claim
        WHEN NEW.verb = 'SYNCED-INTO' BEGIN SELECT RAISE(ABORT, 'edge merge record rejected'); END`)
      assert.throws(sync, /edge merge record rejected/)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(target.edgesOf(parent!), [])
      assert.equal(target.db.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'cave_sync_src'").get(), undefined)
      target.db.exec('DROP TRIGGER reject_edge_sync_record')
      const recovered = sync()
      assert.equal(recovered.merged, 0)
      assert.equal(recovered.skipped, 2)
      assert.equal(recovered.edges, 1)
      assert.deepEqual(recovered.problems, [])
      assert.match(recovered.record ?? '', /\+0 claim\(s\), \+1 edge\(s\)/)
      assert.equal(target.edgesOf(parent!)[0]!.child.id, child)
      const after = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const repeated = sync()
      assert.equal(repeated.merged, 0)
      assert.equal(repeated.edges, 0)
      assert.equal(repeated.record, undefined)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), after)
    } finally { target.close(); source.close(); done() }
  }
})

for (const dryRun of [false, true]) {
  for (const mode of ['merge-drop-detach', 'merge-drop-detach-unprintable', 'merge-detach', 'drop-detach', 'drop', 'detach']) {
    test(`database sync preserves ${mode} failures (dryRun=${dryRun})`, t => {
      const { dir, done } = scratch()
      const sourcePath = join(dir, 'source.db')
      const source = open(sourcePath), target = open()
      const mergeError = new Error('merge write failed'), dropError = new Error('temporary drop failed'), detachError = new Error('source detach failed')
      if (mode.endsWith('unprintable')) {
        Object.defineProperty(mergeError, 'message', { get() { throw new Error('message unavailable') } })
        Object.defineProperty(dropError, 'message', { value: Object.create(null) })
      }
      let drops = 0, detaches = 0
      try {
        source.ingest('remote IS imported')
        target.ingest('local IS retained')
        const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
        const sourceBefore = source.exportText({ tx: true, maxSensitivity: 'restricted' })
        const exec = target.db.exec.bind(target.db)
        t.mock.method(target.db, 'exec', (sql: string) => {
          if (sql.startsWith('INSERT INTO main.cave_claim') && mode.includes('merge')) throw mergeError
          exec(sql)
          if (sql === 'DROP TABLE IF EXISTS temp.cave_sync_new' && ++drops === 2 && mode.includes('drop')) throw dropError
          if (sql === 'DETACH DATABASE cave_sync_src') {
            detaches++
            if (mode.includes('detach')) throw detachError
          }
        })
        const expected = [
          ...(mode.includes('merge') ? [mergeError] : []),
          ...(mode.includes('drop') ? [dropError] : []),
          ...(mode.includes('detach') ? [detachError] : [])
        ]
        const leaves = (error: unknown): unknown[] => {
          if (!(error instanceof AggregateError)) return [error]
          assert.equal(error.cause, error.errors[0])
          return error.errors.flatMap(leaves)
        }
        assert.throws(() => syncDb(target, sourcePath, { dryRun, record: false }), error => {
          assert.deepEqual(leaves(error), expected)
          assert.ok(error instanceof Error)
          if (mode.endsWith('unprintable')) {
            assert.ok(error.message.includes('[unprintable thrown value]'))
            assert.ok(error.message.includes(detachError.message))
          } else for (const failure of expected) assert.ok(error.message.includes(failure.message))
          return true
        })
        assert.equal(drops, 2, 'initial stale-table removal and final cleanup each run once')
        assert.equal(detaches, 1)
        t.mock.restoreAll()
        assert.equal(target.db.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'cave_sync_src'").get(), undefined)
        assert.equal(target.db.prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'cave_sync_new'").get(), undefined)
        if (dryRun || mode !== 'detach') assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        else assert.match(target.exportText({ current: true }), /remote IS imported/, 'detach failure occurs after the merge commits')
        assert.equal(source.exportText({ tx: true, maxSensitivity: 'restricted' }), sourceBefore)
        assert.deepEqual(syncDb(target, sourcePath, { record: false }).problems, [])
        target.ingest('caller IS usable')
      } finally {
        t.mock.restoreAll()
        source.close()
        target.close()
        done()
      }
    })
  }
}

test('database sync recognizes hard links to itself before attaching', t => {
  const { dir, done } = scratch()
  const path = join(dir, 'store.db')
  const alias = join(dir, 'alias.db')
  const store = open(path)
  try {
    store.ingest('api IS service')
    linkSync(path, alias)
    const before = store.exportText({ tx: true })
    const prepare = store.db.prepare.bind(store.db)
    let attachments = 0
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (sql.startsWith('ATTACH')) {
        attachments += 1
        throw new Error('must not attach the same database under another filename')
      }
      return prepare(sql)
    })
    for (const dryRun of [false, true]) {
      assert.deepEqual(syncDb(store, alias, { dryRun }), {
        merged: 0, skipped: 0, edges: 0, dryRun, problems: []
      })
    }
    assert.equal(attachments, 0)
    assert.equal(store.exportText({ tx: true }), before)
    store.ingest('cache IS service')
    assert.equal(rowCount(store), 2)
  } finally { store.close(); done() }
})

test('annotated replicas preserve explicit provenance, identity and ordinary comment parsing', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path), replica = open(), plain = open()
  try {
    source.ingest('api IS trusted @src:cli ; first\nservice IS reviewed @src:manual', {
      source: 'agent/reviewer', provenance: { sources: ['manual', 'quoted "source"', `line${String.fromCharCode(0x2028)}separator`], domains: ['team/platform'], run: 'review/1' },
    })
    const rows = source.currentBeliefs()
    source.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(rows[0]!.id, 'BECAUSE', rows[1]!.id)
    const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    const report = syncText(replica, text, { record: false })
    assert.deepEqual(report.problems, [])
    for (const row of source.currentBeliefs()) {
      assert.deepEqual(replica.provenanceOf(row.id), source.provenanceOf(row.id))
      assert.equal(replica.currentBeliefs().find(value => value.id === row.id)!.claim_key, row.claim_key)
    }
    assert.equal(report.edges, 1)
    assert.deepEqual(syncText(replica, text + text, { record: false }).problems, [])
    assert.equal(syncText(replica, text, { record: false }).merged, 0)
    assert.deepEqual(syncDb(replica, path, { record: false }).problems, [])
    plain.ingest(text, { strict: true })
    assert.deepEqual(plain.currentBeliefs().map(row => row.comment), ['first', null])
  } finally { plain.close(); replica.close(); source.close(); done() }
})

test('provenance payloads validate before any rows, edges or metadata change', () => {
  const good = { actors: ['reviewer'], sources: ['manual'], runs: [], domains: [] }
  for (const payload of [
    '{broken', '{}', '[]', '{"extra":true}',
    JSON.stringify({ provenance: { ...good, actors: [7] } }),
    JSON.stringify({ provenance: { ...good, sources: [''] } }),
    JSON.stringify({ provenance: { ...good, extra: [] } }),
    JSON.stringify({ provenance: { actors: [] } }),
    JSON.stringify({ provenance: good, extra: true }),
  ]) {
    const store = open()
    try {
      const before = store.exportText({ tx: true })
      const report = syncText(store, `;@ ${Uuidv7.next()}\nrequest IS reviewed\n  ;@ ${Uuidv7.next()} ${payload}\n  BECAUSE api IS trusted`)
      assert.ok(report.problems.length > 0, payload)
      assert.equal(report.merged, 0)
      assert.equal(report.edges, 0)
      assert.equal(store.exportText({ tx: true }), before)
    } finally { store.close() }
  }
})

test('escaped malformed Unicode provenance rejects the whole sync and permits corrected input', () => {
  const store = open()
  try {
    store.ingest('retained IS history')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const empty = { actors: [], sources: [], runs: [], domains: [] }
    for (const key of ['actors', 'sources', 'runs', 'domains']) {
      for (const value of ['\ud800', '\udc00', 'before\ud800after']) {
        for (const dryRun of [false, true]) {
          const payload = JSON.stringify({ provenance: { ...empty, [key]: [value] } })
          const text = `;@ ${Uuidv7.next()}\nrequest IS reviewed\n  ;@ ${Uuidv7.next()} ${payload}\n  BECAUSE api IS trusted`
          const result = syncText(store, text, { record: false, dryRun })
          assert.equal(result.merged, 0)
          assert.equal(result.edges, 0)
          assert.ok(result.problems.some(problem => problem.line === 3 && /provenance/.test(problem.message)))
          assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
      }
    }
    const id = Uuidv7.next()
    const sources = ['café', '😀', '\ufffd', 'before\0after']
    const text = `;@ ${id} ${JSON.stringify({ provenance: { ...empty, sources } })}\napi IS trusted`
    assert.deepEqual(syncText(store, text, { record: false }).problems, [])
    assert.deepEqual(new Set(store.provenanceOf(id).sources), new Set(sources))
  } finally { store.close() }
})

test('explicit provenance participates in repeated and existing identity checks', () => {
  const store = open()
  const metadata = (actor: string) => JSON.stringify({ provenance: { actors: [actor], sources: [], runs: [], domains: [] } })
  try {
    const id = Uuidv7.next()
    const first = `;@ ${id} ${metadata('reviewer')}\napi IS trusted`
    assert.equal(syncText(store, first, { record: false, dryRun: true }).merged, 1)
    assert.equal(rowCount(store), 0)
    assert.equal(syncText(store, first, { record: false }).merged, 1)
    const before = store.exportText({ tx: true })
    const changed = `;@ ${Uuidv7.next()}\nrequest IS reviewed\n  ;@ ${id} ${metadata('other')}\n  BECAUSE api IS trusted`
    assert.ok(syncText(store, changed).problems.length > 0)
    assert.ok(syncText(store, `${first}\n;@ ${id} ${metadata('other')}\napi IS trusted`).problems.length > 0)
    // A legacy first occurrence must not bypass validation of a later payload.
    const empty = JSON.stringify({ provenance: { actors: [], sources: [], runs: [], domains: [] } })
    assert.ok(syncText(store, `;@ ${id}\napi IS trusted\n;@ ${id} ${empty}\napi IS trusted`).problems.length > 0)
    assert.equal(store.exportText({ tx: true }), before)
  } finally { store.close() }
})

test('explicit empty dimensions survive reopen, current export, and database copying', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const id = Uuidv7.next()
  const empty = { actors: [], sources: [], runs: [], domains: [] }
  let source = open(path)
  const target = open()
  try {
    assert.deepEqual(syncText(source, `;@ ${id} ${JSON.stringify({ provenance: empty })}\napi IS trusted @src:manual`, { record: false }).problems, [])
    source.close(); source = open(path)
    assert.deepEqual(source.provenanceOf(id), empty)
    const text = source.exportText({ current: true, tx: true })
    assert.match(text, /"provenance"/)
    assert.deepEqual(syncDb(target, path, { record: false }).problems, [])
    assert.deepEqual(target.provenanceOf(id), empty)
    assert.deepEqual(syncText(target, text, { record: false }).problems, [])
  } finally { target.close(); source.close(); done() }
})

test('text replicas and ordinary imports preserve exact confidence, including computed and tiny values', () => {
  const source = open()
  const replica = open()
  const imported = open()
  try {
    const values = [0.500001, 0.8 * 0.9, 1 / 3, Number.MIN_VALUE, 1e-20, 0.999, 1 - Number.EPSILON]
    source.insertResult({
      claims: values.map((conf, i) => ({ line: i + 1, claim: Claim.of({
        subject: Claim.entity(`sample/${i}`), verb: 'IS', payload: Claim.relation(Claim.entity('sample')), conf,
      }) })),
      edges: [], problems: [], registry: source.registry(),
    })
    const annotated = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.deepEqual(syncText(replica, annotated, { record: false }).problems, [])
    assert.deepEqual(replica.currentBeliefs().map(row => row.conf), values)
    assert.equal(syncText(source, annotated, { record: false }).merged, 0)
    imported.ingest(source.exportText({ maxSensitivity: 'restricted' }), { strict: true })
    assert.deepEqual(imported.currentBeliefs().map(row => row.conf), values)
  } finally {
    source.close()
    replica.close()
    imported.close()
  }
})

test('existing-ID comparison distinguishes confidence beyond rounded display precision', () => {
  const store = open()
  try {
    const [id] = store.ingest('api IS trusted @ 50.0001%').ids
    const report = syncText(store, `;@ ${id}\napi IS trusted @ 50.0002%`)
    assert.ok(report.problems.length > 0)
    assert.equal(report.merged, 0)
  } finally {
    store.close()
  }
})

test('text sync rejects existing identities with different content before adding rows or lineage', () => {
  for (const changed of [
    'api IS compromised @src:review #verified ; original',
    'api IS trusted @src:review #verified @ 50% ; original',
    'api IS trusted @src:other #verified ; original',
    'api IS trusted @src:review #unverified ; original',
    'api IS trusted @src:review #verified ; changed',
  ]) {
    const store = open()
    try {
      const [id] = store.ingest('api IS trusted @src:review #verified ; original').ids
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const text = `;@ ${Uuidv7.next()}\nrequest IS denied\n  ;@ ${id}\n  BECAUSE ${changed}`
      const report = syncText(store, text)
      assert.ok(report.problems.length > 0, changed)
      assert.match(report.problems[0]!.message, /already stored.*different content/)
      assert.equal(report.merged, 0)
      assert.equal(report.edges, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally {
      store.close()
    }
  }
})

test('text sync accepts existing semantic identities despite raw spelling and metadata ordering', () => {
  const store = open()
  try {
    const [id] = store.ingest('api PART-OF platform @production @src:review #b #a ; original').ids
    const text = `;@ ${Uuidv7.next()}\nrequest IS reviewed\n  ;@ ${id}\n  BECAUSE platform CONTAINS api @src:review @production #a #b ; original`
    const report = syncText(store, text, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 1)
    assert.equal(report.skipped, 1)
    assert.equal(report.edges, 1)
    assert.equal(syncText(store, text, { record: false }).merged, 0)
  } finally {
    store.close()
  }
})

for (const atReservation of [false, true]) test(`text sync canonicalizes using the reserved vocabulary (peer writes at reservation=${atReservation})`, () => {
  const { dir, done } = scratch()
  const path = join(dir, 'target.db')
  const target = open(path)
  const peer = open(path)
  try {
    const vocabulary = 'MANAGES IS verb\nMANAGES REVERSE MANAGED-BY'
    let crossed = false
    const intercepted = new Proxy(target, {
      get(store, property, receiver) {
        if (property !== 'transaction') return Reflect.get(store, property, receiver)
        return <T>(body: () => T): T => {
          if (!crossed) {
            crossed = true
            if (atReservation) peer.ingest(vocabulary)
          }
          return store.transaction(body)
        }
      },
    })
    if (!atReservation) peer.ingest(vocabulary)
    const id = Uuidv7.next()
    const report = syncText(intercepted, `;@ ${id}\napi MANAGED-BY alice`, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 1)
    assert.equal(crossed, true)
    const row = target.db.prepare('SELECT subject, verb, object FROM cave_claim WHERE id = ?').get(id)
    assert.deepEqual({ ...row }, { subject: 'alice', verb: 'MANAGES', object: 'api' })

    peer.ingest('MANAGES RENAMED-TO SUPERVISES')
    const renamedId = Uuidv7.next()
    const renamed = `;@ ${renamedId}\nbob SUPERVISES web`
    const next = syncText(target, renamed, { record: false })
    assert.deepEqual(next.problems, [])
    assert.equal(next.merged, 1)
    const renamedRow = target.db.prepare('SELECT subject, verb, object FROM cave_claim WHERE id = ?').get(renamedId)
    assert.deepEqual({ ...renamedRow }, { subject: 'bob', verb: 'MANAGES', object: 'web' })
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(syncText(target, renamed, { record: false }).skipped, 1)
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    peer.close()
    target.close()
    done()
  }
})

test('text sync dry runs retain committed peer vocabulary and discard staged declarations', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'target.db')
  const target = open(path)
  const peer = open(path)
  try {
    peer.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY')
    const before = rowCount(target)
    const original = target.registry()
    const text = `;@ ${Uuidv7.next()}\nTEMPORARY IS verb\n;@ ${Uuidv7.next()}\napi MANAGED-BY alice`
    const dry = syncText(target, text, { dryRun: true, record: false })
    assert.deepEqual(dry.problems, [])
    assert.equal(dry.merged, 2)
    assert.equal(rowCount(target), before)
    assert.equal(target.registry(), original)
    assert.equal(Registry.primaryOf(target.registry(), 'MANAGED-BY').isInverse, true)
    assert.equal(Registry.isDeclared(target.registry(), 'TEMPORARY'), false)
    syncText(target, text, { record: false })
    assert.equal(target.db.prepare("SELECT COUNT(*) AS n FROM cave_claim WHERE verb = 'MANAGES'").get()?.['n'], 1)
  } finally {
    peer.close()
    target.close()
    done()
  }
})

for (const dryRun of [false, true]) test(`database sync rejects caller-owned transactions without writes or attachments (dryRun=${dryRun})`, () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  const target = open()
  try {
    source.ingest('remote IS present')
    source.close()
    target.transaction(() => {
      target.ingest('caller IS preserved')
      const before = rowCount(target)
      let failure: unknown
      try { syncDb(target, path, { dryRun }) } catch (error) { failure = error }
      assert.ok(failure instanceof Error)
      assert.equal(rowCount(target), before, 'a rejected sync leaves earlier caller writes intact')
      assert.equal(target.db.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'cave_sync_src'").get(), undefined)
      assert.match(failure.message, /caller-owned transaction/)
    })
    assert.equal(rowCount(target), 1)
    assert.equal(syncDb(target, path, { record: false }).merged, 1, 'a standalone retry succeeds')
  } finally {
    target.close()
    done()
  }
})

test('annotated-text sync remains nestable through commit, rollback, and dry run', () => {
  const source = open()
  source.ingest('remote IS present')
  const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
  source.close()
  for (const mode of ['commit', 'rollback', 'dry-run']) {
    const target = open()
    try {
      target.ingest('caller IS preserved')
      const rollback = new Error('caller rollback')
      const run = () => target.transaction(() => {
        const report = syncText(target, text, { record: false, dryRun: mode === 'dry-run' })
        assert.deepEqual(report.problems, [])
        assert.equal(report.merged, 1)
        if (mode === 'rollback') throw rollback
      })
      if (mode === 'rollback') assert.throws(run, error => error === rollback)
      else run()
      assert.equal(rowCount(target), mode === 'commit' ? 2 : 1)
    } finally {
      target.close()
    }
  }
})

test('invalid Unicode merge labels roll back and valid Unicode labels recover exactly', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'source.db')
  const source = open(sourcePath)
  try {
    source.ingest('remote IS knowledge')
    const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const mode of ['database', 'text'] as const) {
      const target = open()
      try {
        target.ingest('local IS retained')
        const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
        const sync = (labels: { from?: string, into?: string }) => mode === 'database'
          ? syncDb(target, sourcePath, labels) : syncText(target, text, labels)
        for (const key of ['from', 'into']) for (const value of ['bad\ud800label', 'bad\udc00label']) {
          assert.throws(() => sync({ [key]: value }), /unpaired UTF-16 surrogate/)
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
          assert.equal(target.db.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'cave_sync_src'").get(), undefined)
          assert.equal(Registry.isDeclared(target.registry(), 'SYNCED-INTO'), false)
        }
        const labels = { from: 'café😀�', into: 'work/团队' }
        const recovered = sync(labels)
        assert.equal(recovered.merged, 1)
        assert.deepEqual(recovered.problems, [])
        const record = target.currentBeliefs().find(row => row.verb === 'SYNCED-INTO')!
        assert.equal(record.subject, `store/${labels.from}`)
        assert.equal(record.object, `store/${labels.into}`)
        const committed = target.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.equal(sync(labels).record, undefined)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), committed)
      } finally { target.close() }
    }
  } finally { source.close(); done() }
})

test('labelOf and sanitizeLabel produce one entity token', () => {
  assert.equal(labelOf('laptop.db'), 'laptop')
  assert.equal(labelOf('/backups/main store.db'), 'main-store')
  assert.equal(labelOf('notes.backup.cave'), 'notes.backup')
  assert.equal(labelOf('/backups/team:blue.db'), 'team-blue')
  assert.equal(labelOf('.db'), 'store')
  assert.equal(sanitizeLabel('my label; #1 @home'), 'my-label-1-home')
  assert.equal(sanitizeLabel(''), 'store')
})

test('conditional vocabulary does not suppress the merge record declaration', () => {
  for (const role of ['WHEN', 'VIA', 'BECAUSE']) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path)
    try {
      source.ingest(`api IS service\n  ${role} SYNCED-INTO IS verb`, { strict: true })
      const text = source.exportText({ tx: true })
      assert.equal(Registry.isDeclared(source.registry(), 'SYNCED-INTO'), false)
      for (const mode of ['text', 'database']) {
        const target = open()
        try {
          const merge = (dryRun: boolean) => mode === 'text' ?
            syncText(target, text, { dryRun }) : syncDb(target, path, { dryRun })
          const preview = merge(true)
          assert.deepEqual(preview.problems, [])
          assert.equal(preview.merged, 2)
          assert.ok(preview.record)
          assert.equal(rowCount(target), 0)
          assert.equal(Registry.isDeclared(target.registry(), 'SYNCED-INTO'), false)
          const applied = merge(false)
          assert.deepEqual(applied.problems, [])
          assert.equal(applied.merged, 2)
          assert.equal(applied.edges, 1)
          assert.equal(Registry.isDeclared(target.registry(), 'SYNCED-INTO'), true, `${mode}/${role}`)
          assert.equal(rowCount(target), 4, 'source rows, top-level declaration and merge event')
          const before = target.exportText({ tx: true })
          const repeated = merge(false)
          assert.equal(repeated.record, undefined)
          assert.equal(target.exportText({ tx: true }), before)
        } finally { target.close() }
      }
    } finally { source.close(); done() }
  }
})

test('merge records use the options captured before source rows trigger callbacks', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  try {
    source.ingest('api IS service')
    const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const mode of ['text', 'database']) {
      const target = open()
      try {
        const options = { from: 'source', into: 'target', record: true }
        // This native-store regression uses SQLite's callback API beyond the portable database interface.
        ;(target.db as unknown as DatabaseSync).function('change_sync_options', () => {
          options.from = 'changed-source'
          options.into = 'changed-target'
          options.record = false
          return 0
        })
        target.db.exec(`CREATE TRIGGER mutate_sync_options AFTER INSERT ON cave_claim
          WHEN NEW.subject = 'api' BEGIN SELECT change_sync_options(); END`)
        const report = mode === 'text' ? syncText(target, text, options) : syncDb(target, path, options)
        assert.deepEqual(report.problems, [])
        assert.equal(options.record, false, 'the source insertion ran the callback')
        assert.ok(report.record)
        assert.equal(query(target, 'store/source SYNCED-INTO store/target').length, 1)
        assert.equal(query(target, 'store/changed-source SYNCED-INTO store/changed-target').length, 0)
      } finally { target.close() }
    }
  } finally { source.close(); done() }
})

test('merge records preserve their direction through imported reverse vocabulary', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  try {
    source.ingest('RECEIVED-FROM IS verb\nRECEIVED-FROM REVERSE SYNCED-INTO\napi IS service')
    const text = source.exportText({ tx: true })
    for (const mode of ['text', 'database']) {
      const target = open()
      try {
        const options = { from: 'source', into: 'target' }
        const report = mode === 'text' ? syncText(target, text, options) : syncDb(target, path, options)
        assert.deepEqual(report.problems, [])
        assert.match(report.record!, /^store\/source SYNCED-INTO store\/target ; /)
        const row = target.byContext('src:sync').find(row => row.verb === 'RECEIVED-FROM')!
        assert.equal(row.subject, 'store/target')
        assert.equal(row.object, 'store/source')
        assert.equal(row.comment, `+${report.merged} claim(s), +${report.edges} edge(s)`)
        assert.equal(query(target, 'store/source SYNCED-INTO store/target').length, 1)
        assert.equal(query(target, 'store/target SYNCED-INTO store/source').length, 0)
        const repeated = mode === 'text' ? syncText(target, text, options) : syncDb(target, path, options)
        assert.equal(repeated.merged, 0)
        assert.equal(repeated.record, undefined)
      } finally { target.close() }
    }
  } finally { source.close(); done() }
})

test('literal delimiters and attribute colons in sync labels preserve merge records', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  try {
    source.ingest('api IS service')
    const text = source.exportText({ tx: true })
    for (const mode of ['text', 'database']) {
      for (const quote of ['"', '`', ':']) {
        for (const side of ['from', 'into', 'both']) {
          const target = open()
          try {
            const options = {
              from: `team${side === 'into' ? '-' : quote}blue`,
              into: `local${side === 'from' ? '-' : quote}green`
            }
            const preview = mode === 'text' ? syncText(target, text, { ...options, dryRun: true }) :
              syncDb(target, path, { ...options, dryRun: true })
            assert.deepEqual(preview.problems, [])
            assert.equal(preview.record, 'store/team-blue SYNCED-INTO store/local-green ; +1 claim(s), +0 edge(s)')
            assert.equal(rowCount(target), 0)
            const report = mode === 'text' ? syncText(target, text, options) : syncDb(target, path, options)
            assert.deepEqual(report.problems, [])
            const row = target.byContext('src:sync').find(row => row.verb === 'SYNCED-INTO')!
            assert.equal(row.subject, 'store/team-blue')
            assert.equal(row.object, 'store/local-green')
            assert.equal(row.comment, '+1 claim(s), +0 edge(s)')
            assert.equal(report.record, 'store/team-blue SYNCED-INTO store/local-green ; +1 claim(s), +0 edge(s)')
          } finally { target.close() }
        }
      }
    }
  } finally { source.close(); done() }
})

test('database sync rejects changed existing identities atomically, including dry runs', () => {
  for (const mutate of [
    "UPDATE cave_claim SET object = 'compromised' WHERE subject = 'api'",
    "UPDATE cave_claim SET conf = 0.500002 WHERE subject = 'api'",
    "UPDATE cave_claim SET comment = 'changed' WHERE subject = 'api'",
    "UPDATE cave_claim SET value_num = 42 WHERE subject = 'api'",
    "UPDATE cave_claim SET importance = 1 WHERE subject = 'api'",
    "UPDATE cave_claim SET claim_key = 'wrong-series' WHERE subject = 'api'",
    "UPDATE cave_context SET context = 'src:other'",
    "UPDATE cave_tag SET value = 'other'",
    "UPDATE cave_provenance SET value = 'other'",
  ]) for (const dryRun of [false, true]) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path)
    const target = open()
    try {
      const [id] = source.ingest('api IS trusted @src:review #status:verified @ 50.0001% ; original').ids
      syncDb(target, path, { record: false })
      const [parent] = source.ingest('request IS denied').ids
      source.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(parent!, 'BECAUSE', id!)
      source.db.exec(mutate)
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const report = syncDb(target, path, { dryRun })
      assert.ok(report.problems.length > 0, mutate)
      assert.match(report.problems[0]!.message, /already stored.*different content/)
      assert.equal(report.merged, 0)
      assert.equal(report.edges, 0)
      assert.equal(report.record, undefined)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(target.db.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'cave_sync_src'").get(), undefined)
    } finally {
      target.close()
      source.close()
      done()
    }
  }
})

test('database sync accepts text-replayed identities with different raw spelling and metadata order', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  const target = open()
  try {
    const [id] = source.ingest('api PART-OF platform @production @src:review #b #a ; original').ids
    assert.deepEqual(syncText(target, `;@ ${id}\nplatform CONTAINS api @src:review @production #a #b ; original`, { record: false }).problems, [])
    const [parent] = source.ingest('request IS reviewed').ids
    source.db.prepare('INSERT INTO cave_edge (parent_id, role, child_id) VALUES (?, ?, ?)').run(parent!, 'BECAUSE', id!)
    const report = syncDb(target, path, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 1)
    assert.equal(report.skipped, 1)
    assert.equal(report.edges, 1)
    assert.equal(syncDb(target, path, { record: false }).edges, 0)
  } finally {
    target.close()
    source.close()
    done()
  }
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
    assert.deepEqual(a.provenanceOf(merged).sources, ['maria'])
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
    assert.deepEqual(a.provenanceOf(record[0]!).actors, ['sync'])
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

test('db merge derives provenance when the source predates the dimension table', () => {
  const { dir, done } = scratch()
  try {
    const sourcePath = join(dir, 'legacy.db')
    const source = open(sourcePath)
    source.ingest('api USES postgres @src:inventory @scope:billing', {
      source: 'rule/abc123',
      lifecycle: true
    })
    source.close()
    const legacy = new DatabaseSync(sourcePath)
    legacy.exec('DROP TABLE cave_provenance')
    legacy.exec('PRAGMA user_version = 0')
    legacy.close()

    const target = open(join(dir, 'target.db'))
    const report = syncDb(target, sourcePath, { record: false })
    assert.equal(report.merged, 1)
    assert.equal(syncDb(target, sourcePath, { record: false }).merged, 0)
    const row = target.currentBeliefs()[0]!
    assert.deepEqual(target.provenanceOf(row), {
      actors: ['rule/abc123'],
      sources: ['inventory'],
      runs: ['rule/abc123'],
      domains: ['billing']
    })
    target.close()
  } finally {
    done()
  }
})

test('legacy sync preserves large context sets, empty provenance and dry-run recovery', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'legacy-contexts.db')
  const source = open(path)
  const target = open()
  try {
    const sources = Array.from({ length: 5_000 }, (_, index) => `source-${index}`)
    source.ingest('bare IS item\napi USES postgres ' + sources.map(value => `@src:${value}`).join(' '), { strict: true })
    source.db.exec('DROP TABLE cave_provenance; PRAGMA user_version = 0')
    const preview = syncDb(target, path, { record: false, dryRun: true })
    assert.deepEqual(preview.problems, [])
    assert.equal(preview.merged, 2)
    assert.equal(rowCount(target), 0)
    const merged = syncDb(target, path, { record: false })
    assert.deepEqual(merged.problems, [])
    assert.equal(merged.merged, 2)
    const rows = target.currentBeliefs()
    const inferred = target.provenanceOf(rows.find(row => row.subject === 'api')!)
    assert.deepEqual(new Set(inferred.sources), new Set(sources))
    assert.deepEqual(target.provenanceOf(rows.find(row => row.subject === 'bare')!),
      { actors: [], sources: [], runs: [], domains: [] })
    const repeated = syncDb(target, path, { record: false })
    assert.equal(repeated.merged, 0)
    assert.equal(repeated.skipped, 2)
    assert.deepEqual(repeated.problems, [])
  } finally { source.close(); target.close(); done() }
})

test('database identity checks allow provenance inferred during copying but reject explicit changes', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  const target = open()
  try {
    source.ingest('api IS trusted @src:cli', { source: 'agent/reviewer', provenance: { domains: ['team/platform'] } })
    assert.deepEqual(syncDb(target, path, { record: false }).problems, [])
    const repeated = syncDb(target, path, { record: false })
    assert.deepEqual(repeated.problems, [])
    assert.equal(repeated.merged, 0)
    assert.equal(target.db.prepare("SELECT 1 FROM cave_provenance WHERE dimension = 'actor' AND value = 'cli'").get(), undefined)
    // Older sync implementations added this inferred actor while copying.
    target.db.exec("INSERT INTO cave_provenance (claim_id, dimension, value) SELECT id, 'actor', 'cli' FROM cave_claim")
    assert.deepEqual(syncDb(target, path, { record: false }).problems, [])
    source.db.exec("UPDATE cave_provenance SET value = 'team/other' WHERE dimension = 'domain'")
    assert.ok(syncDb(target, path, { record: false }).problems.length > 0)
  } finally {
    target.close()
    source.close()
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

test('database sync rejects invalid or mismatched transaction identities before copying', () => {
  for (const change of [
    "UPDATE cave_claim SET id = 'invalid', tx = 'invalid' WHERE subject = 'bad'",
    "UPDATE cave_claim SET id = upper(id), tx = upper(tx) WHERE subject = 'bad'",
    "UPDATE cave_claim SET tx = '01980000-0000-7000-8000-000000000000' WHERE subject = 'bad'",
  ]) for (const dryRun of [false, true]) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open()
    try {
      source.ingest('good IS source\nbad IS source')
      source.db.exec(change)
      const report = syncDb(target, path, { dryRun })
      assert.ok(report.problems.length > 0)
      assert.match(report.problems[0]!.message, /invalid transaction identity/)
      assert.equal(report.merged, 0)
      assert.equal(report.record, undefined)
      assert.equal(rowCount(target), 0)
    } finally { target.close(); source.close(); done() }
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
    assert.throws(() => syncDb(a, join(dir, 'notes.cave')), /cannot (attach|inspect) sync source/)
    assert.equal(rowCount(a), 0, 'failed syncs leave the store untouched')
    a.close()
  } finally {
    done()
  }
})

for (const dryRun of [false, true]) test(`source validation retains original failures and permits retry (dryRun=${dryRun})`, t => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'source.db')
  const source = open(sourcePath), target = open()
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message unavailable') } })
  try {
    source.ingest('remote IS imported')
    target.ingest('local IS retained')
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const phase of ['attach', 'inspect', 'schema']) for (const failure of [new Error('schema inspection failed'), Object.create(null), unreadable]) {
      const prepare = target.db.prepare.bind(target.db)
      let attempts = 0
      t.mock.method(target.db, 'prepare', (sql: string) => {
        const selected = phase === 'attach' ? sql.startsWith('ATTACH DATABASE')
          : phase === 'inspect' ? sql.includes('FROM cave_sync_src.sqlite_master')
            : sql.startsWith('PRAGMA cave_sync_src.table_info(')
        if (selected) { attempts++; throw failure }
        return prepare(sql)
      })
      assert.throws(() => syncDb(target, sourcePath, { dryRun, record: false }), error => {
        assert.ok(error instanceof Error)
        assert.equal(error.cause, failure)
        assert.ok(error.message.startsWith(`${sourcePath}: `))
        assert.ok(error.message.endsWith(failure === unreadable || !(failure instanceof Error)
          ? '[unprintable thrown value]' : 'schema inspection failed'))
        return true
      })
      assert.equal(attempts, 1)
      t.mock.restoreAll()
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(target.db.prepare('PRAGMA database_list').all().some(row => row.name === 'cave_sync_src'), false)
    }
    assert.deepEqual(syncDb(target, sourcePath, { record: false }).problems, [])
    assert.match(target.exportText(), /remote IS imported/)
  } finally { t.mock.restoreAll(); source.close(); target.close(); done() }
})

test('sync rejects incompatible transaction-index collation in the attached source and permits repair', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'source.db')
  const source = open(sourcePath), target = open()
  try {
    source.ingest('api IS service')
    target.ingest('existing IS retained')
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('CREATE INDEX idx_cave_tx ON cave_claim(tx COLLATE NOCASE)')
    assert.throws(() => syncDb(target, sourcePath, { record: false }), /incompatible index idx_cave_tx/)
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(target.db.prepare('PRAGMA database_list').all().some(row => row.name === 'cave_sync_src'), false)
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('CREATE INDEX idx_cave_tx ON cave_claim(tx)')
    const report = syncDb(target, sourcePath, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 1)
  } finally { source.close(); target.close(); done() }
})

test('version-1 sources must retain explicit provenance structure before sync', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'version1.db')
  const source = open(sourcePath), target = open()
  try {
    source.ingest('api IS service @src:inventory', { provenance: { actor: 'reviewer', domains: ['billing'] } })
    target.ingest('existing IS retained')
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('PRAGMA user_version = 1')
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    source.db.exec('ALTER TABLE cave_provenance RENAME TO retained_provenance')
    for (const dryRun of [false, true]) {
      assert.throws(() => syncDb(target, sourcePath, { record: false, dryRun }), /missing table cave_provenance/)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(target.db.prepare('PRAGMA database_list').all().some(row => row.name === 'cave_sync_src'), false)
    }
    source.db.exec('ALTER TABLE retained_provenance RENAME TO cave_provenance')
    const report = syncDb(target, sourcePath, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 1)
    const row = target.currentBeliefs().find(row => row.subject === 'api')!
    assert.deepEqual(target.provenanceOf(row), source.provenanceOf(source.currentBeliefs()[0]!))
    assert.equal(source.db.prepare('PRAGMA user_version').get()!.user_version, 1)
  } finally { source.close(); target.close(); done() }
})

test('version-1 database sources merge into version 2 without upgrading the source', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'version1.db')
  const source = open(sourcePath), target = open()
  try {
    source.ingest('api IS service\n  WHEN review IS complete')
    const before = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('PRAGMA user_version = 1')
    const report = syncDb(target, sourcePath, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 2)
    assert.equal(report.edges, 1)
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(source.db.prepare('PRAGMA user_version').get()!.user_version, 1)
    assert.equal(source.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_cave_tx'").get(), undefined)
  } finally { source.close(); target.close(); done() }
})

test('sync rejects a store from a newer incompatible schema version', () => {
  const { dir, done } = scratch()
  try {
    const target = open(join(dir, 'target.db'))
    const futurePath = join(dir, 'future.db')
    const future = open(futurePath)
    future.ingest('future IS knowledge')
    future.db.exec('PRAGMA user_version = 3')
    future.close()
    assert.throws(() => syncDb(target, futurePath), /schema version 3 is newer than this runtime supports \(2\)/)
    assert.equal(rowCount(target), 0)
    target.close()
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

test('large repeated text identities still validate later content and provenance', () => {
  const store = open()
  try {
    const id = store.ingest('sample IS observed @src:manual').ids[0]!
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const claim = 'sample IS observed @src:manual'
    const bare = `;@ ${id}\n${claim}\n`
    const provenance = store.provenanceOf(id)
    const explicit = (value: typeof provenance, text = claim) =>
      `;@ ${id} ${JSON.stringify({ provenance: value })}\n${text}\n`
    const repeated = bare + explicit(provenance).repeat(2000)
    assert.deepEqual(syncText(store, repeated, { record: false }).problems, [])
    for (const tail of [explicit(provenance, 'sample IS different @src:manual'),
      explicit({ ...provenance, sources: ['different'] })]) {
      const result = syncText(store, repeated + tail, { record: false })
      assert.equal(result.merged, 0)
      assert.ok(result.problems.some(problem => problem.line === 4004 && /already stored with different content/.test(problem.message)))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    // The cache belongs to one validation call; a new replay sees committed rows.
    const nextId = Uuidv7.next()
    const next = `;@ ${nextId}\nnew IS observed\n`.repeat(2000)
    assert.equal(syncText(store, next, { record: false }).merged, 1)
    assert.equal(syncText(store, next, { record: false }).merged, 0)
  } finally { store.close() }
})

test('annotation-like comments preserve history and provenance across text and database sync', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'source.db')
  const source = open(sourcePath), target = open()
  try {
    const comments = ['@', '@missing-space', '@ not-a-uuid extra', `@ ${Uuidv7.next()} {"provenance":{}}`]
    for (const [index, comment] of comments.entries()) {
      source.ingest(`; ${comment}\nsample IS observed @ ${(index + 1) * 20}% ; final note`, {
        strict: true, source: 'agent/reviewer',
        provenance: { sources: ['manual'], domains: ['team/platform'], run: 'review/1' }
      })
    }
    assert.equal(rowCount(source), comments.length)
    const text = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const comment of comments) assert.ok(text.includes(`; ${comment}\n`))
    for (const merged of [comments.length, 0]) {
      const result = syncText(target, text, { record: false })
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, merged)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), text)
      assert.deepEqual(rowIds(target), rowIds(source))
      for (const id of rowIds(source)) assert.deepEqual(target.provenanceOf(id), source.provenanceOf(id))
    }
    const database = syncDb(target, sourcePath, { record: false })
    assert.deepEqual(database.problems, [])
    assert.equal(database.merged, 0)
    assert.equal(database.skipped, comments.length)
    assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), text)
  } finally { target.close(); source.close(); done() }
})

test('malformed annotation-shaped lines reject sync even beside valid annotations', () => {
  const store = open()
  try {
    store.ingest('existing IS preserved')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const valid = `;@ ${Uuidv7.next()}\nx NEEDS y\n`
    for (const malformed of [';@', ';@missing-space', ';@ not-a-uuid extra', `;@ ${Uuidv7.next()} []`]) {
      for (const dryRun of [false, true]) {
        for (const text of [`${malformed}\n${valid}`, `${valid}${malformed}\n`]) {
          const report = syncText(store, text, { dryRun, record: false })
          assert.equal(report.merged, 0)
          assert.ok(report.problems.some(problem => /malformed transaction annotation/.test(problem.message)), malformed)
          assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        }
      }
    }
    const corrected = syncText(store, `; @ ordinary comment\n${valid}`, { record: false })
    assert.deepEqual(corrected.problems, [])
    assert.equal(corrected.merged, 1)
    assert.equal(syncText(store, `; @ ordinary comment\n${valid}`, { record: false }).merged, 0)
  } finally { store.close() }
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

test('syncFile preserves inherited and non-enumerable dry-run options for both source formats', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'incoming.db'), textPath = join(dir, 'incoming.cave')
  const source = open(path)
  try {
    source.ingest('api IS service')
    writeFileSync(textPath, source.exportText({ tx: true, maxSensitivity: 'restricted' }))
    for (const sourcePath of [path, textPath]) {
      for (const options of [Object.create({ dryRun: true, record: false, from: 'source', into: 'target' }),
        Object.defineProperties({}, {
          dryRun: { value: true }, record: { value: false },
          from: { value: 'source' }, into: { value: 'target' }
        })]) {
        const target = open()
        try {
          target.ingest('local IS retained')
          const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
          const report = syncFile(target, sourcePath, options)
          assert.deepEqual(report.problems, [])
          assert.equal(report.dryRun, true)
          assert.equal(report.merged, 1)
          assert.equal(report.record, undefined)
          assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
          const committed = syncFile(target, sourcePath, Object.create(options, {
            dryRun: { value: false }, record: { value: true }
          }))
          assert.equal(committed.merged, 1)
          assert.ok(committed.record)
          assert.equal(query(target, 'api IS service').length, 1)
          assert.equal(query(target, 'store/source SYNCED-INTO store/target').length, 1)
        } finally { target.close() }
      }
    }
  } finally { source.close(); done() }
})

test('syncFile failures preserve existing history, release attachments and allow corrected input', () => {
  const { dir, done } = scratch()
  const source = open(), target = open(join(dir, 'target.db'))
  try {
    source.ingest('api IS service')
    target.ingest('local IS retained', { provenance: { sources: ['manual'], domains: ['team'] } })
    const valid = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
    const path = join(dir, 'incoming.cave')
    const missing = join(dir, 'missing.cave')
    for (const dryRun of [false, true]) {
      for (const sourcePath of [missing, dir]) {
        assert.throws(() => syncFile(target, sourcePath, { dryRun }),
          error => error instanceof Error && 'code' in error &&
            (sourcePath === missing ? error.code === 'ENOENT' : ['EISDIR', 'EPERM', 'EACCES'].includes(String(error.code))))
        assert.equal(existsSync(missing), false, 'source detection must not create a missing file')
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        const attached = target.db.prepare('PRAGMA database_list').all() as { name: string }[]
        assert.ok(attached.every(entry => entry.name !== 'cave_sync_src'))
      }
      writeFileSync(path, Buffer.concat([Buffer.from(valid.trimEnd() + ' ; invalid '), Buffer.from([0xff])]))
      assert.throws(() => syncFile(target, path, { dryRun }), /invalid UTF-8/)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      for (const input of ['SQLite format 3\0broken', 'api IS service', ';@ invalid\napi IS service']) {
        writeFileSync(path, input)
        if (input.startsWith('SQLite')) {
          assert.throws(() => syncFile(target, path, { dryRun }), /cannot (attach|inspect) sync source/)
        } else {
          const result = syncFile(target, path, { dryRun })
          assert.ok(result.problems.length > 0)
          assert.equal(result.merged, 0)
          assert.equal(result.record, undefined)
        }
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        const attached = target.db.prepare('PRAGMA database_list').all() as { name: string }[]
        assert.ok(attached.every(entry => entry.name !== 'cave_sync_src'))
        writeFileSync(path, valid)
        const preview = syncFile(target, path, { dryRun: true })
        assert.deepEqual(preview.problems, [])
        assert.equal(preview.merged, 1)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
    }
    const recovered = syncFile(target, path)
    assert.deepEqual(recovered.problems, [])
    assert.equal(recovered.merged, 1)
    assert.equal(query(target, 'local IS retained').length, 1)
    assert.equal(query(target, 'api IS service').length, 1)
    assert.equal(syncFile(target, path).merged, 0)
  } finally { source.close(); target.close(); done() }
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

    // Work appends outsort the seed (§28.2). Terse canonical emission may
    // refactor a shared prefix, so identity annotations — not physical-line
    // prefix equality — define the pure-addition review.
    work.ingest('api HAS owner: platform-team', { source: 'cli' })
    const reviewed = work.exportText({ tx: true })
    const txsOf = (text: string): Set<string> =>
      new Set(text.split('\n').flatMap(line => {
        const tx = txOfLine(line)
        return tx === undefined ? [] : [tx]
      }))
    const committedTxs = txsOf(committed)
    const reviewedTxs = txsOf(reviewed)
    assert.ok([...committedTxs].every(tx => reviewedTxs.has(tx)), 'review keeps every committed row')
    assert.equal(reviewedTxs.size, committedTxs.size + 1, 'review adds exactly the branch row')

    // Main advanced meanwhile — a git-level collision at the file's end. The
    // merge-driver move: union both texts in a fresh store and re-export.
    main.ingest('auth USES jwt @ 40%', { source: 'cli' })
    const theirs = main.exportText({ tx: true })
    const union = open(join(dir, 'union.db'))
    syncText(union, reviewed, { record: false })
    syncText(union, theirs, { record: false })
    const merged = union.exportText({ tx: true })
    const mergedTxs = txsOf(merged)
    for (const tx of [...txsOf(reviewed), ...txsOf(theirs)]) {
      assert.ok(mergedTxs.has(tx), `union keeps every reviewed row: ${tx}`)
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


test('text sync identity ignores Unicode tag order when locale collation ties', () => {
  const store = open()
  try {
    const first = '\u00e9', second = 'e\u0301'
    const [id] = store.ingest(`api IS service #${first} #${second}`).ids
    assert.ok(id)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const report = syncText(store, `;@ ${id}\napi IS service #${second} #${first}`, { record: false })
    assert.deepEqual(report.problems, [])
    assert.equal(report.merged, 0)
    assert.equal(report.skipped, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const fresh = Uuidv7.next()
    const repeated = syncText(store, `;@ ${fresh}\nworker IS service #${first} #${second}\n;@ ${fresh}\nworker IS service #${second} #${first}`, { record: false })
    assert.deepEqual(repeated.problems, [])
    assert.equal(repeated.merged, 1)
  } finally { store.close() }
})


test('Unicode tag values replay in any order while changed values reject the whole batch', () => {
  const store = open()
  try {
    const id = Uuidv7.next(), first = '\u00e9', second = 'e\u0301'
    const original = `api IS service #label:${first} #label:${second}`
    const reordered = `api IS service #label:${second} #label:${first}`
    const accepted = syncText(store, `;@ ${id}\n${original}\n;@ ${id}\n${reordered}`, { record: false })
    assert.deepEqual(accepted.problems, [])
    assert.equal(accepted.merged, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const conflicting = syncText(store, `;@ ${Uuidv7.next()}\nfresh IS candidate\n;@ ${id}\napi IS service #label:${first} #label:changed`, { record: false })
    assert.ok(conflicting.problems.length > 0)
    assert.equal(conflicting.merged, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const repeated = syncText(store, `;@ ${id}\n${reordered}`, { record: false })
    assert.deepEqual(repeated.problems, [])
    assert.equal(repeated.skipped, 1)
  } finally { store.close() }
})

test('database sync reserves one source state in merge and preview and releases it for later writes', t => {
  for (const journal of ['WAL', 'DELETE']) for (const dryRun of [false, true]) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open(join(dir, 'target.db'))
    try {
      source.db.exec(`PRAGMA journal_mode = ${journal}`)
      target.db.exec(`PRAGMA journal_mode = ${journal}`)
      source.db.exec('PRAGMA busy_timeout = 0')
      source.ingest('original IS present')
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const sourceBefore = source.exportText({ tx: true, maxSensitivity: 'restricted' })
      const prepare = target.db.prepare.bind(target.db)
      let attempted = 0
      const hook = t.mock.method(target.db, 'prepare', (sql: string) => {
        if (sql.startsWith('SELECT id, tx FROM cave_sync_src.cave_claim')) {
          attempted++
          assert.throws(() => source.ingest('concurrent IS blocked'), /locked/)
          assert.equal(source.exportText({ tx: true, maxSensitivity: 'restricted' }), sourceBefore)
        }
        return prepare(sql)
      })
      const result = syncDb(target, path, { record: false, dryRun })
      hook.mock.restore()
      assert.equal(attempted, 1)
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 1)
      assert.equal(query(target, 'original IS present').length, dryRun ? 0 : 1)
      assert.equal(query(target, 'concurrent IS blocked').length, 0)
      if (dryRun) assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.ok((target.db.prepare('PRAGMA database_list').all() as { name: string }[])
        .every(entry => entry.name !== 'cave_sync_src'))
      source.ingest('later IS writable')
      const retry = syncDb(target, path, { record: false })
      assert.deepEqual(retry.problems, [])
      assert.equal(retry.merged, dryRun ? 2 : 1)
      assert.equal(query(target, 'later IS writable').length, 1)
      assert.equal(query(target, 'local IS retained').length, 1)
      assert.equal(syncDb(target, path, { record: false }).merged, 0)
    } finally { source.close(); target.close(); done() }
  }
})

test('a busy database source rejects sync atomically and releases the target for retry', () => {
  for (const journal of ['WAL', 'DELETE']) for (const dryRun of [false, true]) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open(join(dir, 'target.db'))
    try {
      source.db.exec(`PRAGMA journal_mode = ${journal}`)
      target.db.exec(`PRAGMA journal_mode = ${journal}`)
      target.db.exec('PRAGMA busy_timeout = 0')
      source.ingest('original IS committed')
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      source.transaction(() => {
        source.ingest('pending IS uncommitted')
        assert.throws(() => syncDb(target, path, { dryRun }), /locked/)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.ok((target.db.prepare('PRAGMA database_list').all() as { name: string }[])
          .every(entry => entry.name !== 'cave_sync_src'))
        // The source is still reserved: this append proves target cleanup did
        // not leave an attached source lock or an unfinished transaction behind.
        target.ingest('after-failure IS writable')
      })
      const previewBefore = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const preview = syncDb(target, path, { dryRun: true })
      assert.deepEqual(preview.problems, [])
      assert.equal(preview.merged, 2)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), previewBefore)
      const retry = syncDb(target, path)
      assert.deepEqual(retry.problems, [])
      assert.equal(retry.merged, 2)
      assert.ok(retry.record)
      assert.equal(query(target, 'pending IS uncommitted').length, 1)
      assert.equal(query(target, 'after-failure IS writable').length, 1)
      assert.equal(syncDb(target, path).merged, 0)
    } finally { source.close(); target.close(); done() }
  }
})

test('exclusive source locks retain their cause and permit sync after release', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path), target = open(join(dir, 'target.db'))
  try {
    source.db.exec('PRAGMA journal_mode = DELETE')
    target.db.exec('PRAGMA busy_timeout = 0')
    source.ingest('remote IS retained')
    const before = target.exportText({ tx: true })
    for (const dryRun of [false, true]) {
      source.db.exec('BEGIN EXCLUSIVE')
      try {
        assert.throws(() => syncDb(target, path, { dryRun }), error => {
          assert.ok(error instanceof Error)
          assert.match(error.message, /cannot attach sync source.*locked/)
          assert.ok(error.cause instanceof Error)
          assert.match(error.cause.message, /locked/)
          return true
        })
        assert.equal(target.exportText({ tx: true }), before)
        assert.ok((target.db.prepare('PRAGMA database_list').all() as { name: string }[])
          .every(entry => entry.name !== 'cave_sync_src'))
      } finally { source.db.exec('ROLLBACK') }
    }
    assert.equal(syncDb(target, path, { record: false }).merged, 1)
    assert.equal(syncDb(target, path, { record: false }).merged, 0)
  } finally { source.close(); target.close(); done() }
})

for (const value of ['', new Uint8Array([0xff])]) test(`database sync rejects malformed source provenance before copying (${typeof value === 'string' ? 'empty' : 'blob'})`, () => {
  for (const dimension of ['actor', 'source', 'run', 'domain']) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open()
    try {
      source.ingest('CUSTOM IS verb\nremote CUSTOM imported\n  BECAUSE evidence')
      const id = source.currentBeliefs().find(row => row.subject === 'remote')!.id
      source.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, dimension, value)
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const sourceBefore = JSON.stringify(source.db.prepare('SELECT * FROM cave_provenance ORDER BY rowid').all())
      for (const dryRun of [false, true]) {
        const result = syncDb(target, path, { dryRun })
        assert.equal(result.merged, 0)
        assert.equal(result.skipped, 0)
        assert.equal(result.edges, 0)
        assert.equal(result.record, undefined)
        assert.deepEqual(result.problems.map(problem => problem.line), [0])
        assert.ok(result.problems[0]!.message.includes(id))
        assert.match(result.problems[0]!.message, /provenance/)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.equal(Registry.isDeclared(target.registry(), 'CUSTOM'), false)
        assert.equal(JSON.stringify(source.db.prepare('SELECT * FROM cave_provenance ORDER BY rowid').all()), sourceBefore)
        assert.ok((target.db.prepare('PRAGMA database_list').all() as { name: string }[])
          .every(entry => entry.name !== 'cave_sync_src'))
      }
      source.db.prepare('UPDATE cave_provenance SET value = ? WHERE claim_id = ? AND dimension = ?').run('repaired', id, dimension)
      const preview = syncDb(target, path, { dryRun: true })
      assert.deepEqual(preview.problems, [])
      assert.equal(preview.merged, 3)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      const result = syncDb(target, path)
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 3)
      assert.equal(result.edges, 1)
      assert.ok(result.record)
      assert.equal(Registry.isDeclared(target.registry(), 'CUSTOM'), true)
      assert.match(target.exportText({ tx: true, maxSensitivity: 'restricted' }), /repaired/)
      assert.equal(syncDb(target, path).merged, 0)
    } finally { source.close(); target.close(); done() }
  }
})

test('database sync rejects inconsistent historical claim keys before copying', () => {
  for (const corruption of ['key', 'context']) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open()
    try {
      source.ingest('CUSTOM IS verb\nremote CUSTOM imported @review\n  BECAUSE evidence')
      const id = source.currentBeliefs().find(row => row.subject === 'remote')!.id
      const key = source.currentBeliefs().find(row => row.id === id)!.claim_key
      if (corruption === 'key') source.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('wrong-key', id)
      else source.db.prepare('DELETE FROM cave_context WHERE claim_id = ?').run(id)
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true, maxSensitivity: 'restricted' })
      const sourceBefore = JSON.stringify(['cave_claim', 'cave_context'].map(table => source.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
      for (const dryRun of [false, true]) {
        const result = syncDb(target, path, { dryRun })
        assert.equal(result.merged, 0)
        assert.equal(result.skipped, 0)
        assert.equal(result.edges, 0)
        assert.equal(result.record, undefined)
        assert.deepEqual(result.problems.map(problem => problem.line), [0])
        assert.ok(result.problems[0]!.message.includes(id))
        assert.match(result.problems[0]!.message, /stored claim/)
        assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
        assert.equal(Registry.isDeclared(target.registry(), 'CUSTOM'), false)
        assert.equal(JSON.stringify(['cave_claim', 'cave_context'].map(table => source.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())), sourceBefore)
        assert.ok((target.db.prepare('PRAGMA database_list').all() as { name: string }[])
          .every(entry => entry.name !== 'cave_sync_src'))
      }
      if (corruption === 'key') source.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(key, id)
      else source.db.prepare('INSERT INTO cave_context (claim_id, context) VALUES (?, ?)').run(id, 'review')
      const preview = syncDb(target, path, { dryRun: true })
      assert.deepEqual(preview.problems, [])
      assert.equal(preview.merged, 3)
      assert.equal(target.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      const result = syncDb(target, path)
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 3)
      assert.equal(result.edges, 1)
      assert.ok(result.record)
      assert.equal(Registry.isDeclared(target.registry(), 'CUSTOM'), true)
      assert.match(target.exportText({ tx: true, maxSensitivity: 'restricted' }), /@review/)
      assert.equal(syncDb(target, path).merged, 0)
    } finally { source.close(); target.close(); done() }
  }
})

test('database sync validates stored claims beyond the first validation batch', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path), target = open()
  try {
    source.ingest(Array.from({ length: 520 }, (_, index) => `item/${index} HAS count: 1`).join('\n'))
    const id = source.currentBeliefs().find(row => row.subject === 'item/519')!.id
    source.db.prepare('UPDATE cave_claim SET value_num = 2 WHERE id = ?').run(id)
    const before = target.exportText({ tx: true })
    for (const dryRun of [false, true]) {
      const result = syncDb(target, path, { dryRun, record: false })
      assert.equal(result.merged, 0)
      assert.equal(result.edges, 0)
      assert.equal(result.problems.length, 1)
      assert.ok(result.problems[0]!.message.includes(id))
      assert.equal(target.exportText({ tx: true }), before)
    }
    source.db.prepare('UPDATE cave_claim SET value_num = 1 WHERE id = ?').run(id)
    const result = syncDb(target, path, { record: false })
    assert.equal(result.merged, 520)
    assert.deepEqual(result.problems, [])
    assert.equal(target.exportText({ tx: true }), source.exportText({ tx: true }))
  } finally { source.close(); target.close(); done() }
})

test('database sync rejects historical tags that cannot be emitted as CAVE', () => {
  for (const [key, value] of [['note', 'private\nvalue'], ['private\nkey', null]] as const) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open()
    try {
      source.ingest('valid IS retained\nprivate-subject IS retained')
      const id = source.currentBeliefs().find(row => row.subject === 'private-subject')!.id
      source.db.prepare('INSERT INTO cave_tag (claim_id, key, value) VALUES (?, ?, ?)').run(id, key, value)
      const sourceBefore = JSON.stringify(source.db.prepare('SELECT * FROM cave_tag').all())
      target.ingest('local IS retained')
      const before = target.exportText({ tx: true })
      for (const dryRun of [false, true]) {
        const result = syncDb(target, path, { dryRun, record: false })
        assert.equal(result.merged, 0)
        assert.equal(result.problems.length, 1)
        assert.ok(result.problems[0]!.message.includes(id))
        assert.doesNotMatch(result.problems[0]!.message, /private/)
        assert.equal(target.exportText({ tx: true }), before)
        assert.equal(JSON.stringify(source.db.prepare('SELECT * FROM cave_tag').all()), sourceBefore)
        assert.ok(target.db.prepare('PRAGMA database_list').all().every(row => row.name !== 'cave_sync_src'))
      }
      source.db.prepare('DELETE FROM cave_tag WHERE claim_id = ?').run(id)
      const result = syncDb(target, path, { record: false })
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 2)
      assert.match(target.exportText({ tx: true }), /private-subject IS retained/)
      assert.equal(syncDb(target, path, { record: false }).merged, 0)
    } finally { source.close(); target.close(); done() }
  }
})

test('database sync rejects dangling source metadata and edges even when the target has the referenced claim', () => {
  for (const legacy of [false, true]) for (const kind of ['context', 'tag', 'provenance', 'parent', 'child']) {
    const { dir, done } = scratch()
    const path = join(dir, 'source.db')
    const source = open(path), target = open()
    try {
      const id = source.ingest('remote IS retained').ids[0]!
      const absent = target.ingest('local IS retained').ids[0]!
      source.db.exec('PRAGMA foreign_keys = OFF')
      const table = kind === 'context' ? 'cave_context' : kind === 'tag' ? 'cave_tag' : kind === 'provenance' ? 'cave_provenance' : 'cave_edge'
      if (legacy) {
        source.db.exec(`CREATE TABLE ${table}_legacy AS SELECT * FROM ${table}`)
        source.db.exec(`DROP TABLE ${table}`)
        source.db.exec(`ALTER TABLE ${table}_legacy RENAME TO ${table}`)
        source.db.exec('PRAGMA user_version = 0')
        assert.deepEqual(source.db.prepare(`PRAGMA foreign_key_list(${table})`).all(), [])
      }
      if (kind === 'context') source.db.prepare('INSERT INTO cave_context VALUES (?, ?)').run(absent, 'private-context')
      else if (kind === 'tag') source.db.prepare('INSERT INTO cave_tag VALUES (?, ?, ?)').run(absent, 'note', 'private-value')
      else if (kind === 'provenance') source.db.prepare('INSERT INTO cave_provenance VALUES (?, ?, ?)').run(absent, 'source', 'private-source')
      else source.db.prepare('INSERT INTO cave_edge VALUES (?, ?, ?)').run(kind === 'parent' ? absent : id, 'BECAUSE', kind === 'child' ? absent : id)
      source.db.exec('PRAGMA foreign_keys = ON')
      const schemaBefore = JSON.stringify(source.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all())
      const sourceBefore = JSON.stringify(source.db.prepare(`SELECT * FROM ${table}`).all())
      const before = target.exportText({ tx: true })
      for (const dryRun of [false, true]) {
        const result = syncDb(target, path, { dryRun })
        assert.equal(result.merged, 0)
        assert.equal(result.edges, 0)
        assert.equal(result.record, undefined)
        assert.equal(result.problems.length, 1)
        assert.match(result.problems[0]!.message, /missing claims/)
        assert.doesNotMatch(result.problems[0]!.message, /private/)
        assert.equal(target.exportText({ tx: true }), before)
        assert.equal(JSON.stringify(source.db.prepare(`SELECT * FROM ${table}`).all()), sourceBefore)
        assert.ok(target.db.prepare('PRAGMA database_list').all().every(row => row.name !== 'cave_sync_src'))
      }
      source.db.exec(`DELETE FROM ${table}`)
      const result = syncDb(target, path, { record: false })
      assert.deepEqual(result.problems, [])
      assert.equal(result.merged, 1)
      assert.equal(syncDb(target, path, { record: false }).merged, 0)
      assert.equal(JSON.stringify(source.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all()), schemaBefore)
      if (legacy) assert.equal(source.db.prepare('PRAGMA user_version').get()!.user_version, 0)
    } finally { source.close(); target.close(); done() }
  }
})

test('database sync rejects unsupported historical edge roles before copying', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path), target = open()
  try {
    source.ingest('remote IS retained\n  BECAUSE evidence')
    source.db.prepare('UPDATE cave_edge SET role = ?').run('private-invalid-role')
    const sourceBefore = JSON.stringify(source.db.prepare('SELECT * FROM cave_edge').all())
    target.ingest('local IS retained')
    const before = target.exportText({ tx: true })
    for (const dryRun of [false, true]) {
      const result = syncDb(target, path, { dryRun })
      assert.equal(result.merged, 0)
      assert.equal(result.edges, 0)
      assert.equal(result.record, undefined)
      assert.equal(result.problems.length, 1)
      assert.match(result.problems[0]!.message, /edge role/)
      assert.doesNotMatch(result.problems[0]!.message, /private/)
      assert.equal(target.exportText({ tx: true }), before)
      assert.equal(JSON.stringify(source.db.prepare('SELECT * FROM cave_edge').all()), sourceBefore)
      assert.ok(target.db.prepare('PRAGMA database_list').all().every(row => row.name !== 'cave_sync_src'))
    }
    source.db.prepare('UPDATE cave_edge SET role = ?').run('BECAUSE')
    const result = syncDb(target, path, { record: false })
    assert.deepEqual(result.problems, [])
    assert.equal(result.merged, 2)
    assert.equal(result.edges, 1)
    assert.match(target.exportText({ tx: true }), /BECAUSE evidence/)
    assert.equal(syncDb(target, path, { record: false }).merged, 0)
  } finally { source.close(); target.close(); done() }
})
