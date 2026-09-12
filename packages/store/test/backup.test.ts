import { test } from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { createHash } from 'node:crypto'
import * as assert from 'node:assert/strict'
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { backup, open, restoreBackup, verifyBackup } from '@cavelang/store'
import type { SqliteDatabase } from '@cavelang/store/adapter'
import { openWith } from '@cavelang/store/adapter'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'

const scratch = (): { dir: string, done: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-backup-'))
  return {
    dir,
    done: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch (error) {
        // DatabaseSync.close() delegates to sqlite3_close_v2 and Node exposes
        // no StatementSync finalizer. Windows can therefore retain the closed
        // source file until its wrappers are collected; CI scratch is ephemeral.
        if (process.platform !== 'win32' ||
          !(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error
      }
    }
  }
}

const table = (db: SqliteDatabase | DatabaseSync, name: string, order: string): unknown[] =>
  db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all()

test('backup and restore require literal true to replace an existing destination', () => {
  const { dir, done } = scratch()
  const source = open()
  const snapshot = join(dir, 'snapshot.db')
  const target = join(dir, 'target.db')
  let coercions = 0
  try {
    source.ingest('api IS healthy')
    backup(source, snapshot)
    const originalSnapshot = readFileSync(snapshot)
    for (const operation of [
      (force: boolean) => backup(source, target, { force }),
      (force: boolean) => restoreBackup(snapshot, target, { force }),
    ]) {
      for (const force of [undefined, false, null, 'true', 'false', 1, 1n,
        Symbol('force'), new Boolean(true),
        { [Symbol.toPrimitive]() { coercions++; return true } }]) {
        writeFileSync(target, 'retained destination')
        assert.throws(() => operation(force as boolean), /already exists; pass force/)
        assert.equal(readFileSync(target, 'utf8'), 'retained destination')
        assert.deepEqual(readFileSync(snapshot), originalSnapshot)
      }
      assert.equal(operation(true).rows, 1)
      assert.equal(verifyBackup(target).rows, 1)
    }
    assert.equal(coercions, 0)
    assert.equal(source.currentBeliefs().length, 1)
  } finally { source.close(); done() }
})

test('backup preserves its initial no-replace decision across adapter callbacks', () => {
  const { dir, done } = scratch()
  const target = join(dir, 'target.db')
  const options = { force: false }
  const capability = nodeSqliteAdapter.capabilities.backup!
  const source = openWith({ ...nodeSqliteAdapter, capabilities: {
    ...nodeSqliteAdapter.capabilities,
    backup: { ...capability, write(db, temporary) {
      capability.write(db, temporary)
      writeFileSync(target, 'concurrent destination')
      options.force = true
    } },
  } })
  try {
    source.ingest('api IS healthy')
    assert.throws(() => backup(source, target, options), /EEXIST/)
    assert.equal(readFileSync(target, 'utf8'), 'concurrent destination')
    assert.equal(source.currentBeliefs().length, 1)
  } finally { source.close(); done() }
})

test('backup and restore capture explicit replacement once per operation', () => {
  const { dir, done } = scratch()
  const source = open()
  const snapshot = join(dir, 'snapshot.db')
  const target = join(dir, 'target.db')
  try {
    source.ingest('api IS healthy')
    backup(source, snapshot)
    for (const operation of [
      (options: { readonly force: boolean }) => backup(source, target, options),
      (options: { readonly force: boolean }) => restoreBackup(snapshot, target, options),
    ]) {
      writeFileSync(target, 'old destination')
      let reads = 0
      assert.equal(operation({ get force() { return ++reads === 1 } }).rows, 1)
      assert.equal(reads, 1)
      assert.equal(verifyBackup(target).rows, 1)
    }
  } finally { source.close(); done() }
})

test('backup refuses publication when the destination becomes a live WAL store during preparation', () => {
  const { dir, done } = scratch()
  const target = join(dir, 'target.db')
  const original = open(target)
  original.ingest('destination IS retained')
  original.close()
  let writer: ReturnType<typeof open> | undefined
  let prepared: string | undefined
  let liveBytes: Buffer | undefined
  const capability = nodeSqliteAdapter.capabilities.backup!
  const source = openWith({ ...nodeSqliteAdapter, capabilities: {
    ...nodeSqliteAdapter.capabilities,
    backup: { ...capability, write(db, temporary) {
      capability.write(db, temporary)
      prepared = temporary
      writer = open(target)
      writer.db.exec('PRAGMA journal_mode = WAL')
      writer.db.exec('PRAGMA wal_autocheckpoint = 0')
      writer.ingest('destination HAS update: pending')
      liveBytes = readFileSync(target)
      assert.ok(existsSync(`${target}-wal`))
    } },
  } })
  try {
    source.ingest('source IS different')
    assert.throws(() => backup(source, target, { force: true }), /stop all users and remove stale sidecars/)
    assert.deepEqual(readFileSync(target), liveBytes)
    assert.equal(existsSync(prepared!), false, 'failed publication removes the prepared snapshot')
    assert.equal(writer!.currentBeliefs().length, 2)
    writer!.close()
    writer = undefined
    const retained = open(target)
    try {
      assert.equal(retained.currentBeliefs().length, 2)
      assert.match(retained.exportText(), /HAS update: pending/)
      assert.doesNotMatch(retained.exportText(), /source/)
    } finally { retained.close() }
  } finally { writer?.close(); source.close(); done() }
})

test('version-1 snapshots verify and restore exact bytes before a separate writable migration', () => {
  const { dir, done } = scratch()
  const snapshot = join(dir, 'version1.db'), restored = join(dir, 'restored.db')
  try {
    const source = open(snapshot)
    source.ingest('api HAS owner: platform @src:inventory\n  WHEN review IS complete')
    const exported = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('PRAGMA user_version = 1')
    source.close()
    const bytes = readFileSync(snapshot)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    assert.equal(verifyBackup(snapshot, sha256).schemaVersion, 1)
    assert.equal(restoreBackup(snapshot, restored, { expectedSha256: sha256 }).schemaVersion, 1)
    assert.deepEqual(readFileSync(snapshot), bytes)
    assert.deepEqual(readFileSync(restored), bytes)
    assert.throws(() => open(restored, { access: 'read-only' }), /needs migration to 2/)
    const migrated = open(restored)
    try {
      assert.equal(migrated.exportText({ tx: true, maxSensitivity: 'restricted' }), exported)
      assert.equal(migrated.db.prepare('PRAGMA user_version').get()!.user_version, 2)
    } finally { migrated.close() }
    assert.deepEqual(readFileSync(snapshot), bytes, 'recovery never upgrades the retained backup')
  } finally { done() }
})

test('unsupported and structurally invalid snapshots cannot replace a restore destination', () => {
  const { dir, done } = scratch()
  const snapshot = join(dir, 'snapshot.db'), target = join(dir, 'target.db')
  try {
    const source = open(snapshot)
    source.ingest('api IS service')
    source.close()
    writeFileSync(target, 'retained destination')
    for (const version of [0, 3, 1]) {
      const db = new DatabaseSync(snapshot)
      db.exec(`PRAGMA user_version = ${version}`)
      if (version === 1) db.exec('DROP INDEX idx_cave_subject')
      db.close()
      const bytes = readFileSync(snapshot)
      const expected = version === 1 ? /missing index idx_cave_subject/ : /not a supported exact-backup format/
      assert.throws(() => verifyBackup(snapshot), expected)
      assert.throws(() => restoreBackup(snapshot, target, { force: true }), expected)
      assert.equal(readFileSync(target, 'utf8'), 'retained destination')
      assert.deepEqual(readFileSync(snapshot), bytes)
    }
  } finally { done() }
})

test('snapshot publication preserves destinations with sidecars and protects source snapshot sidecars', () => {
  const { dir, done } = scratch()
  const source = open()
  const snapshot = join(dir, 'snapshot.db')
  const target = join(dir, 'target.db')
  try {
    source.ingest('api IS healthy')
    const created = backup(source, snapshot)
    writeFileSync(target, 'existing destination')
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${target}${suffix}`
      writeFileSync(sidecar, 'existing sidecar')
      assert.throws(() => backup(source, target, { force: true }), /stop all users and remove stale sidecars/)
      assert.equal(readFileSync(target, 'utf8'), 'existing destination')
      assert.equal(readFileSync(sidecar, 'utf8'), 'existing sidecar')
      rmSync(sidecar)
      assert.throws(() => restoreBackup(snapshot, `${snapshot}${suffix}`, { force: true }), /sidecar of the source snapshot/)
      assert.equal(existsSync(`${snapshot}${suffix}`), false)
    }
    assert.equal(verifyBackup(snapshot).sha256, created.sha256)
    assert.equal(backup(source, target, { force: true }).rows, 1)
  } finally {
    source.close()
    done()
  }
})

test('verification cannot certify WAL-only rows as standalone snapshot contents', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const destination = join(dir, 'restored.db')
  const snapshot = join(dir, 'snapshot.db')
  const source = open(path)
  try {
    source.db.exec('PRAGMA journal_mode = WAL')
    source.db.exec('PRAGMA wal_autocheckpoint = 0')
    source.ingest('api IS healthy')
    assert.equal(source.currentBeliefs().length, 1)
    assert.throws(() => verifyBackup(path), /verification requires a standalone snapshot/)
    assert.throws(() => restoreBackup(path, destination), /verification requires a standalone snapshot/)
    assert.equal(existsSync(destination), false)
    const created = backup(source, snapshot)
    assert.equal(created.rows, 1)
    assert.equal(verifyBackup(snapshot, created.sha256).rows, 1)
    assert.equal(restoreBackup(snapshot, destination).rows, 1)
  } finally {
    source.close()
    done()
  }
})

test('backup refuses source sidecars and hard links even with force', () => {
  const { dir, done } = scratch()
  const path = join(dir, 'source.db')
  const source = open(path)
  try {
    source.db.exec('PRAGMA journal_mode = WAL')
    source.ingest('api IS healthy')
    const wal = readFileSync(`${path}-wal`)
    const linked = join(dir, 'linked.db')
    linkSync(path, linked)
    assert.throws(() => restoreBackup(path, linked, { force: true }), /snapshot and destination are the same file/)
    for (const force of [false, true]) {
      for (const target of [linked, ...['-wal', '-shm', '-journal'].map(suffix => `${path}${suffix}`)]) {
        assert.throws(() => backup(source, target, { force }), /destination is the source database/)
      }
    }
    assert.deepEqual(readFileSync(`${path}-wal`), wal)
    assert.equal(source.currentBeliefs().length, 1)
    source.ingest('api HAS owner: platform')
    assert.equal(source.currentBeliefs().length, 2)
  } finally {
    source.close()
    done()
  }
})

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

test('backup verification preserves validation and close failures without changing the snapshot', t => {
  const { dir, done } = scratch()
  const source = open()
  const snapshot = join(dir, 'snapshot.db')
  try {
    source.ingest('retained IS evidence')
    const created = backup(source, snapshot)
    const bytes = readFileSync(snapshot)
    const validationFailure = new Error('snapshot integrity read failed')
    const closeFailure = new Error('snapshot close failed')
    const originalOpen = nodeSqliteAdapter.open.bind(nodeSqliteAdapter)
    let failRead = true
    let failClose = true
    let closes = 0
    const opened: SqliteDatabase[] = []
    const mockedOpen = t.mock.method(nodeSqliteAdapter, 'open', (...args: Parameters<typeof originalOpen>) => {
      const db = originalOpen(...args)
      opened.push(db)
      const prepare = db.prepare.bind(db)
      t.mock.method(db, 'prepare', (sql: string) => {
        if (failRead && sql === 'PRAGMA integrity_check') throw validationFailure
        return prepare(sql)
      })
      const close = db.close.bind(db)
      t.mock.method(db, 'close', () => { closes += 1; close(); if (failClose) throw closeFailure })
      return db
    })
    assert.throws(() => verifyBackup(snapshot), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [validationFailure, closeFailure])
      assert.ok(error.message.includes(validationFailure.message))
      assert.ok(error.message.includes(closeFailure.message))
      assert.equal(error.cause, validationFailure)
      return true
    })
    assert.equal(closes, 1)
    assert.throws(() => opened[0]!.prepare('SELECT 1').get())
    failRead = false
    assert.throws(() => verifyBackup(snapshot), error => error === closeFailure)
    assert.equal(closes, 2)
    failClose = false
    mockedOpen.mock.restore()
    assert.deepEqual(verifyBackup(snapshot), created)
    assert.deepEqual(readFileSync(snapshot), bytes)
  } finally { source.close(); done() }
})

for (const operation of ['backup', 'restore'] as const) test(`${operation} retains operation and temporary removal errors`, t => {
  const { dir, done } = scratch()
  const source = open()
  try {
    source.ingest('retained IS evidence')
    const snapshot = join(dir, 'snapshot.db')
    backup(source, snapshot)
    const target = join(dir, 'target.db')
    writeFileSync(target, 'previous destination')
    const before = readFileSync(target)
    const failure = new Error('snapshot sync failed')
    const cleanupFailure = new Error('temporary removal failed')
    let temporary = ''
    const remove = fs.rmSync
    t.mock.method(fs, 'fsyncSync', () => { throw failure })
    t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
      if (String(args[0]).endsWith('.tmp')) { temporary = String(args[0]); throw cleanupFailure }
      return remove(...args)
    })
    syncBuiltinESMExports()
    const perform = () => operation === 'backup' ? backup(source, target, { force: true }) :
      restoreBackup(snapshot, target, { force: true })
    assert.throws(perform, error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [failure, cleanupFailure])
      assert.ok(error.message.includes(failure.message))
      assert.ok(error.message.includes(cleanupFailure.message))
      assert.equal(error.cause, failure)
      assert.ok(error.message.includes(temporary))
      return true
    })
    assert.ok(temporary.length > 0)
    assert.equal(existsSync(temporary), true)
    assert.deepEqual(readFileSync(target), before)
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(temporary)
    assert.equal(perform().rows, 1)
    assert.equal(verifyBackup(target).rows, 1)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    source.close()
    done()
  }
})

test('snapshot APIs reject malformed expected checksums before inspecting paths and accept uppercase hex', () => {
  const { dir, done } = scratch()
  const source = open()
  try {
    const missing = join(dir, 'missing.db')
    const target = join(dir, 'target.db')
    for (const invalid of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(64) + '\n', 42, null]) {
      const expected = invalid as string
      assert.throws(() => verifyBackup(missing, expected), /expected SHA-256 must be 64 hexadecimal characters/)
      assert.throws(() => restoreBackup(missing, target, { expectedSha256: expected }),
        /expected SHA-256 must be 64 hexadecimal characters/)
      assert.equal(existsSync(target), false)
    }
    source.ingest('retained IS evidence')
    const snapshot = join(dir, 'snapshot.db')
    const created = backup(source, snapshot)
    assert.deepEqual(verifyBackup(snapshot, created.sha256.toUpperCase()), created)
    assert.equal(restoreBackup(snapshot, target, { expectedSha256: created.sha256.toUpperCase() }).sha256, created.sha256)
  } finally { source.close(); done() }
})


for (const operation of ['hash', 'sync'] as const) test(`snapshot ${operation} retains operation and descriptor-close errors`, t => {
  const { dir, done } = scratch()
  const source = open()
  try {
    source.ingest('retained IS evidence')
    const snapshot = join(dir, 'snapshot.db')
    backup(source, snapshot)
    const target = join(dir, 'target.db')
    writeFileSync(target, 'previous destination')
    const before = readFileSync(target)
    const snapshotBefore = readFileSync(snapshot)
    const failure = new Error(`${operation} failed`)
    const closeFailure = new Error('descriptor close failed')
    const close = fs.closeSync
    let descriptor: number | undefined
    let closes = 0
    if (operation === 'hash') {
      t.mock.method(fs, 'readSync', (fd: number) => { descriptor = fd; throw failure })
    } else {
      t.mock.method(fs, 'fsyncSync', (fd: number) => { descriptor = fd; throw failure })
    }
    t.mock.method(fs, 'closeSync', (fd: number) => {
      close(fd)
      if (fd === descriptor) { closes++; throw closeFailure }
    })
    syncBuiltinESMExports()
    const perform = () => operation === 'hash' ? verifyBackup(snapshot) : backup(source, target, { force: true })
    assert.throws(perform, error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [failure, closeFailure])
      assert.ok(error.message.includes(failure.message))
      assert.ok(error.message.includes(closeFailure.message))
      assert.equal(error.cause, failure)
      return true
    })
    assert.equal(closes, 1)
    t.mock.restoreAll()
    syncBuiltinESMExports()
    assert.deepEqual(readFileSync(target), before)
    assert.deepEqual(readFileSync(snapshot), snapshotBefore)
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false)
    assert.equal(perform().rows, 1)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    source.close()
    done()
  }
})


for (const operation of ['backup', 'restore'] as const) for (const persistent of [false, true]) test(`${operation} identifies publication when temporary unlink fails (persistent: ${persistent})`, t => {
  const { dir, done } = scratch()
  const source = open()
  try {
    source.ingest('published IS evidence')
    const snapshot = join(dir, 'snapshot.db')
    const expected = backup(source, snapshot)
    const target = join(dir, 'target.db')
    const failure = new Error('temporary unlink failed')
    const remove = fs.rmSync
    let removals = 0
    t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
      if (String(args[0]).endsWith('.tmp') && (++removals === 1 || persistent)) throw failure
      return remove(...args)
    })
    syncBuiltinESMExports()
    assert.throws(() => operation === 'backup' ? backup(source, target) : restoreBackup(snapshot, target), error => {
      assert.ok(error instanceof Error)
      assert.ok(error.message.includes(`snapshot published to ${target}`))
      assert.ok(error.message.includes(failure.message))
      if (persistent) {
        assert.ok(error instanceof AggregateError)
        assert.equal((error.cause as Error).cause, failure)
        assert.deepEqual(error.errors, [error.cause, failure])
      } else assert.equal(error.cause, failure)
      return true
    })
    assert.equal(removals, 2)
    t.mock.restoreAll()
    syncBuiltinESMExports()
    const published = verifyBackup(target)
    assert.equal(published.rows, 1)
    if (operation === 'restore') assert.equal(published.sha256, expected.sha256)
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), persistent)
    assert.equal(verifyBackup(snapshot).sha256, expected.sha256)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    source.close()
    done()
  }
})


for (const operation of ['backup', 'restore'] as const) for (const stage of ['open', 'sync', 'sync-close', 'unsupported'] as const) test(`${operation} distinguishes directory ${stage} failures after publication`, t => {
  const { dir, done } = scratch()
  const source = open()
  try {
    source.ingest('directory IS evidence')
    const snapshot = join(dir, 'snapshot.db')
    backup(source, snapshot)
    const target = join(dir, 'target.db')
    const failure = Object.assign(new Error(`directory ${stage} failed`), { code: stage === 'unsupported' ? 'EINVAL' : 'EIO' })
    const closeFailure = new Error('directory close failed')
    const openFile = fs.openSync, sync = fs.fsyncSync, close = fs.closeSync
    let descriptor: number | undefined, closes = 0
    t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
      if (String(args[0]) !== dir) return openFile(...args)
      if (stage === 'open') throw failure
      // A real file descriptor stands in for a directory descriptor on hosts
      // that cannot open directories; the injected errors are platform-neutral.
      descriptor = openFile(snapshot, 'r')
      return descriptor
    })
    t.mock.method(fs, 'fsyncSync', (fd: number) => { if (fd === descriptor) throw failure; sync(fd) })
    t.mock.method(fs, 'closeSync', (fd: number) => {
      close(fd)
      if (fd === descriptor) { closes++; if (stage === 'sync-close') throw closeFailure }
    })
    syncBuiltinESMExports()
    const perform = () => operation === 'backup' ? backup(source, target, { force: true }) : restoreBackup(snapshot, target, { force: true })
    if (stage === 'unsupported') assert.equal(perform().rows, 1)
    else assert.throws(perform, error => {
      assert.ok(error instanceof Error)
      assert.ok(error.message.includes(`snapshot published to ${target}`))
      assert.ok(error.message.includes(failure.message))
      if (stage === 'sync-close') {
        assert.ok(error.message.includes(closeFailure.message))
        assert.ok(error.cause instanceof AggregateError)
        assert.deepEqual(error.cause.errors, [failure, closeFailure])
        assert.equal(error.cause.cause, failure)
      } else assert.equal(error.cause, failure)
      return true
    })
    assert.equal(closes, stage === 'open' ? 0 : 1)
    t.mock.restoreAll()
    syncBuiltinESMExports()
    assert.equal(verifyBackup(target).rows, 1)
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    source.close()
    done()
  }
})

test('exact backup preserves semantically damaged rows for diagnosis and repair', () => {
  const { dir, done } = scratch()
  const source = open(join(dir, 'source.db'))
  const snapshot = join(dir, 'snapshot.db'), destination = join(dir, 'restored.db')
  try {
    const id = source.ingest('retained IS evidence @review').ids[0]!
    const originalKey = source.currentBeliefs()[0]!.claim_key
    source.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run('damaged-key', id)
    source.db.prepare('INSERT INTO cave_provenance (claim_id, dimension, value) VALUES (?, ?, ?)').run(id, 'source', '')
    const data = (store: ReturnType<typeof open>) => JSON.stringify(['cave_claim', 'cave_context', 'cave_provenance']
      .map(table => store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
    const before = data(source)
    const created = backup(source, snapshot)
    assert.equal(created.rows, 1)
    assert.equal(verifyBackup(snapshot, created.sha256).sha256, created.sha256)
    restoreBackup(snapshot, destination, { expectedSha256: created.sha256 })
    assert.deepEqual(readFileSync(destination), readFileSync(snapshot))
    assert.equal(data(source), before)
    const restored = open(destination)
    try {
      assert.equal(data(restored), before)
      assert.throws(() => restored.exportText({ tx: true }), /stored claim key/)
      restored.db.prepare('UPDATE cave_claim SET claim_key = ? WHERE id = ?').run(originalKey, id)
      assert.throws(() => restored.exportText({ tx: true }), /stored provenance/)
      restored.db.prepare('UPDATE cave_provenance SET value = ? WHERE claim_id = ?').run('repaired', id)
      assert.match(restored.exportText({ tx: true }), /retained IS evidence/)
      assert.equal(data(source), before, 'repairing the restored copy does not repair the source')
    } finally { restored.close() }
    assert.equal(verifyBackup(snapshot, created.sha256).sha256, created.sha256)
  } finally { source.close(); done() }
})
