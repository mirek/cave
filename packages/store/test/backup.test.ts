import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { backup, open, restoreBackup, verifyBackup } from '@cavelang/store'
import type { SqliteDatabase } from '@cavelang/store/adapter'

const scratch = (): { dir: string, done: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-backup-'))
  return {
    dir,
    done: () => {
      // DatabaseSync.close() delegates to sqlite3_close_v2; Node exposes no
      // StatementSync finalizer, so collect unreachable wrappers before the
      // Windows assertion that the closed source file can be removed.
      globalThis.gc?.()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const table = (db: SqliteDatabase | DatabaseSync, name: string, order: string): unknown[] =>
  db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all()

test('exact backup and restore preserve rows, tx order, provenance, history, and lineage', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'source.db')
  const snapshotPath = join(dir, 'snapshot.db')
  const restoredPath = join(dir, 'restored.db')
  try {
    const source = open(sourcePath)
    source.ingest('api HAS owner: platform @src:inventory #team:core', { source: 'cli' })
    source.ingest('api HAS owner: security @src:inventory #team:core', { source: 'cli' })
    source.ingest('api CAUSE outage @ 80%\n  BECAUSE dependency-failed', { source: 'agent/test' })
    const created = backup(source, snapshotPath)
    assert.equal(created.rows, source.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get()!['n'])
    assert.match(created.sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(verifyBackup(snapshotPath, created.sha256), created)

    const restored = restoreBackup(snapshotPath, restoredPath, { expectedSha256: created.sha256 })
    assert.equal(restored.sha256, created.sha256, 'restore copies the verified snapshot bytes exactly')
    const copy = open(restoredPath)
    for (const [name, order] of [
      ['cave_claim', 'tx'], ['cave_context', 'claim_id, context'],
      ['cave_provenance', 'claim_id, dimension, value'], ['cave_tag', 'claim_id, key, value'],
      ['cave_edge', 'parent_id, role, child_id']
    ] as const) {
      assert.deepEqual(table(copy.db, name, order), table(source.db, name, order), name)
    }
    const owner = copy.currentBeliefs().find(row => row.attribute === 'owner')!
    assert.equal(copy.history(owner.claim_key).length, 2)
    assert.deepEqual(copy.provenanceOf(owner), {
      actors: ['cli'], sources: ['inventory'], runs: [], domains: []
    })
    assert.equal(copy.edgesOf(copy.currentBeliefs().find(row => row.verb === 'CAUSE')!.id).length, 1)
    copy.close()
    source.close()
  } finally {
    done()
  }
})

test('online backup captures a valid WAL snapshot while a reader and writer are active', async () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'wal.db')
  const snapshotPath = join(dir, 'wal.snapshot.db')
  try {
    const source = open(sourcePath)
    source.db.exec('PRAGMA journal_mode = WAL')
    source.db.exec('PRAGMA wal_autocheckpoint = 0')
    source.ingest(Array.from({ length: 2000 }, (_, at) => `item/${at} IS seeded`).join('\n'))
    const before = source.currentBeliefs().length

    const reader = new DatabaseSync(sourcePath, { readOnly: true })
    reader.exec('BEGIN')
    assert.equal((reader.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n, before)

    const storeModule = new URL('../src/index.ts', import.meta.url).href
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { open } from ${JSON.stringify(storeModule)}
      const store = open(process.argv[1])
      process.stdout.write('ready\\n')
      process.stdin.once('data', async () => {
        try {
          for (let attempt = 0; ; attempt++) {
            try {
              store.ingest('concurrent IS committed', { source: 'cli' })
              break
            } catch (error) {
              if (attempt === 9 || !String(error).includes('SQLITE_BUSY')) throw error
              await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
            }
          }
          store.close()
          process.stdout.write('done\\n')
        } catch (error) {
          console.error(error)
          store.close()
          process.exitCode = 1
        }
      })
    `, sourcePath], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    let childError = ''
    child.stderr.on('data', chunk => { childError += String(chunk) })
    const exited = new Promise<void>((resolve, reject) => {
      child.once('exit', code => code === 0
        ? resolve()
        : reject(new Error(`writer exited ${code}: ${childError.trim()}`)))
      child.once('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', chunk => String(chunk).includes('ready') ? resolve() : reject(new Error(String(chunk))))
      child.once('error', reject)
    })
    child.stdin.end('go\n')
    const created = backup(source, snapshotPath)
    await exited
    reader.exec('ROLLBACK')
    reader.close()

    const checked = verifyBackup(snapshotPath, created.sha256)
    assert.ok(checked.rows === before || checked.rows === before + 1,
      'the point-in-time snapshot is wholly before or after the concurrent commit')
    const restored = open(snapshotPath)
    assert.equal(restored.db.prepare('PRAGMA integrity_check').get()!['integrity_check'], 'ok')
    restored.close()
    source.close()
  } finally {
    done()
  }
})

test('backup and restore publish only verified files and preserve prior destinations on failure', () => {
  const { dir, done } = scratch()
  const sourcePath = join(dir, 'source.db')
  const snapshotPath = join(dir, 'snapshot.db')
  const destination = join(dir, 'destination.db')
  const invalid = join(dir, 'invalid.db')
  try {
    const source = open(sourcePath)
    source.ingest('api IS healthy')
    backup(source, snapshotPath)
    assert.throws(() => backup(source, snapshotPath), /already exists/)
    assert.doesNotThrow(() => backup(source, snapshotPath, { force: true }))
    assert.throws(() => backup(source, sourcePath, { force: true }), /destination is the source database/)
    source.close()

    writeFileSync(destination, 'keep me')
    writeFileSync(invalid, 'not sqlite')
    assert.throws(() => restoreBackup(invalid, destination, { force: true }))
    assert.equal(readFileSync(destination, 'utf8'), 'keep me')
    assert.throws(() => restoreBackup(snapshotPath, destination), /already exists/)
    const restored = restoreBackup(snapshotPath, destination, { force: true })
    assert.equal(verifyBackup(destination).sha256, restored.sha256)

    writeFileSync(`${destination}-wal`, 'active')
    assert.throws(() => restoreBackup(snapshotPath, destination, { force: true }), /stop all users and remove stale sidecars/)
  } finally {
    done()
  }
})
