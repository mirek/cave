/** Exact SQLite snapshot backup, verification, and atomic restore. */

import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, fsyncSync, linkSync, openSync, readSync,
  realpathSync, renameSync, rmSync, statSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Store } from './store.ts'
import * as Schema from './schema.ts'

export type Snapshot = {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly schemaVersion: number
  readonly rows: number
  readonly maxTx: null | string
}

export type WriteOptions = {
  /** Replace an existing destination atomically. Never permits source = destination. */
  readonly force?: boolean
}

const temporaryPath = (destination: string): string => {
  const target = resolve(destination)
  return resolve(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
}

const hashFile = (path: string): string => {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const size = readSync(fd, buffer, 0, buffer.length, null)
      if (size === 0) break
      hash.update(buffer.subarray(0, size))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

const syncFile = (path: string): void => {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

const syncDirectory = (path: string): void => {
  let fd: undefined | number
  try {
    fd = openSync(dirname(resolve(path)), 'r')
    fsyncSync(fd)
  } catch {
    // Some platforms do not permit opening/fsyncing a directory. The fully
    // written database itself is still synced before publication.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const publish = (temporary: string, destination: string, force: boolean): void => {
  const target = resolve(destination)
  if (force) {
    renameSync(temporary, target)
    syncDirectory(target)
    return
  }
  // A hard link publishes the fully written inode atomically and fails if a
  // racing process created the destination after the initial existence check.
  linkSync(temporary, target)
  rmSync(temporary)
  syncDirectory(target)
}

const samePath = (left: string, right: string): boolean =>
  existsSync(left) && existsSync(right) ?
    realpathSync(left) === realpathSync(right) :
    resolve(left) === resolve(right)

/** Validate a standalone snapshot without migrating or mutating it. */
export const verifyBackup = (path: string, expectedSha256?: string): Snapshot => {
  const target = resolve(path)
  if (!existsSync(target)) {
    throw new Error(`CAVE backup: ${target}: no such file`)
  }
  const db = new DatabaseSync(target, { readOnly: true })
  let schemaVersion = 0
  let rows = 0
  let maxTx: null | string = null
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity.map(row => row.integrity_check).join('; ')}`)
    }
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeys.length > 0) {
      throw new Error(`foreign_key_check failed for ${foreignKeys.length} row(s)`)
    }
    schemaVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (schemaVersion !== Schema.currentVersion) {
      throw new Error(`schema version ${schemaVersion} is not the exact-backup format ${Schema.currentVersion}`)
    }
    Schema.validate(db, schemaVersion)
    const summary = db.prepare('SELECT COUNT(*) AS rows, MAX(tx) AS max_tx FROM cave_claim').get() as
      { rows: number, max_tx: null | string }
    rows = summary.rows
    maxTx = summary.max_tx
  } finally {
    db.close()
  }
  const sha256 = hashFile(target)
  if (expectedSha256 !== undefined && sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`CAVE backup: SHA-256 mismatch: expected ${expectedSha256.toLowerCase()}, got ${sha256}`)
  }
  return { path: target, bytes: statSync(target).size, sha256, schemaVersion, rows, maxTx }
}

/** Create and atomically publish a verified, point-in-time SQLite snapshot. */
export const backup = (store: Store, destination: string, options: WriteOptions = {}): Snapshot => {
  const target = resolve(destination)
  const source = store.db.location()
  if (source !== null && samePath(source, target)) {
    throw new Error('CAVE backup: destination is the source database')
  }
  if (existsSync(target) && options.force !== true) {
    throw new Error(`CAVE backup: ${target} already exists; pass force to replace it`)
  }
  if (store.db.isTransaction) {
    throw new Error('CAVE backup: cannot snapshot inside an open transaction')
  }
  const temporary = temporaryPath(target)
  try {
    store.db.prepare('VACUUM INTO ?').run(temporary)
    syncFile(temporary)
    const checked = verifyBackup(temporary)
    publish(temporary, target, options.force === true)
    return { ...checked, path: target }
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** Verify a snapshot, then atomically restore its exact bytes to a stopped destination. */
export const restoreBackup = (
  snapshotPath: string,
  destination: string,
  options: WriteOptions & { expectedSha256?: string } = {}
): Snapshot => {
  const source = resolve(snapshotPath)
  const target = resolve(destination)
  if (samePath(source, target)) {
    throw new Error('CAVE restore: snapshot and destination are the same file')
  }
  if (existsSync(target) && options.force !== true) {
    throw new Error(`CAVE restore: ${target} already exists; pass force to replace it`)
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(`${target}${suffix}`)) {
      throw new Error(`CAVE restore: refusing while ${target}${suffix} exists; stop all users and remove stale sidecars`)
    }
  }
  const checked = verifyBackup(source, options.expectedSha256)
  const temporary = temporaryPath(target)
  try {
    copyFileSync(source, temporary)
    syncFile(temporary)
    const copied = verifyBackup(temporary, checked.sha256)
    publish(temporary, target, options.force === true)
    return { ...copied, path: target }
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
