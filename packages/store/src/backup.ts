/** Exact SQLite snapshot backup, verification, and atomic restore. */

import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync, existsSync, fsyncSync, linkSync, openSync, readSync,
  realpathSync, renameSync, rmSync, statSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { withDescriptor } from './descriptor.ts'
import { errorMessage } from './error-message.ts'
import type { Store } from './store.ts'
import { nodeSqliteAdapter } from './node-adapter.ts'
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

class PublishedSnapshotError extends Error {}

/** Retain the operation failure and identify a temporary file whose removal failed. */
const failWithTemporaryCleanup = (temporary: string, operation: string, error: unknown): never => {
  try { rmSync(temporary, { force: true }) } catch (cleanupError) {
    throw new AggregateError([error, cleanupError],
      `CAVE ${operation} failed: ${errorMessage(error)}; temporary cleanup also failed: ${temporary}: ${errorMessage(cleanupError)}`,
      { cause: error })
  }
  throw error
}

const withFile = <T>(path: string, operation: string, body: (fd: number) => T): T =>
  withDescriptor(openSync(path, 'r'), `snapshot ${operation}`, body)

const hashFile = (path: string): string => withFile(path, 'hash', fd => {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  for (;;) {
    const size = readSync(fd, buffer, 0, buffer.length, null)
    if (size === 0) break
    hash.update(buffer.subarray(0, size))
  }
  return hash.digest('hex')
})

const syncFile = (path: string): void => withFile(path, 'sync', fd => {
  try {
    fsyncSync(fd)
  } catch (error) {
    // Windows can reject a redundant fsync while SQLite's completed
    // VACUUM statement still owns the snapshot handle. Verification below
    // must still reopen and validate the complete database before publish.
    if (process.platform !== 'win32' ||
      !(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error
  }
})

const errorCode = (error: unknown): unknown =>
  error instanceof Error && 'code' in error ? error.code : undefined

const syncDirectory = (path: string): void => {
  let fd: number
  try {
    fd = openSync(dirname(resolve(path)), 'r')
  } catch (error) {
    // Windows may reject opening a directory through the ordinary file API.
    const code = errorCode(error)
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES' || code === 'EISDIR')) return
    throw error
  }
  withDescriptor(fd, 'snapshot directory sync', descriptor => {
    try {
      fsyncSync(descriptor)
    } catch (error) {
      const code = errorCode(error)
      // Unsupported directory synchronization is a portability limitation;
      // I/O, space, interruption, and unexpected errors must remain visible.
      if (code === 'EINVAL' || code === 'ENOTSUP' || code === 'ENOSYS' ||
        (process.platform === 'win32' && code === 'EPERM') ||
        (process.platform === 'aix' && code === 'EBADF')) return
      throw error
    }
  })
}

const publish = (temporary: string, destination: string, force: boolean, operation: string): void => {
  const target = resolve(destination)
  requireStoppedDestination(target, operation)
  if (force) {
    renameSync(temporary, target)
  } else {
    // A hard link publishes the fully written inode atomically and fails if a
    // racing process created the destination after the initial existence check.
    linkSync(temporary, target)
  }
  try {
    if (!force) rmSync(temporary)
    syncDirectory(target)
  } catch (error) {
    throw new PublishedSnapshotError(`CAVE ${operation}: snapshot published to ${target}, but post-publication cleanup or directory sync failed: ${errorMessage(error)}`, { cause: error })
  }
}

const canonicalPath = (path: string): string => {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  return existsSync(parent) ? resolve(realpathSync(parent), basename(absolute)) : absolute
}

const samePath = (left: string, right: string): boolean => {
  if (existsSync(left) && existsSync(right)) {
    const a = statSync(left)
    const b = statSync(right)
    if (a.dev === b.dev && a.ino === b.ino) return true
  }
  return canonicalPath(left) === canonicalPath(right)
}

const sourceFile = (source: string, target: string): boolean =>
  [source, canonicalPath(source)].some(base =>
    ['', '-wal', '-shm', '-journal'].some(suffix => samePath(`${base}${suffix}`, target)))

const requireStoppedDestination = (target: string, operation: string): void => {
  for (const base of new Set([target, canonicalPath(target)])) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (existsSync(`${base}${suffix}`)) {
        throw new Error(`CAVE ${operation}: refusing while ${base}${suffix} exists; stop all users and remove stale sidecars`)
      }
    }
  }
}

const expectedDigest = (value: undefined | string): undefined | string => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError('CAVE backup: expected SHA-256 must be 64 hexadecimal characters')
  }
  return value.toLowerCase()
}

/** Validate a standalone snapshot without migrating or mutating it. */
export const verifyBackup = (path: string, expectedSha256?: string): Snapshot => {
  const expected = expectedDigest(expectedSha256)
  const target = resolve(path)
  if (!existsSync(target)) {
    throw new Error(`CAVE backup: ${target}: no such file`)
  }
  // Metadata and the checksum must describe the same standalone file. Opening
  // a live WAL database would read committed rows absent from the hashed bytes.
  for (const base of new Set([target, canonicalPath(target)])) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (existsSync(`${base}${suffix}`)) {
        throw new Error(`CAVE backup: ${base}${suffix} exists; verification requires a standalone snapshot, create one with backup()`)
      }
    }
  }
  const db = nodeSqliteAdapter.open(target, { readOnly: true })
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
    if (schemaVersion < 1 || schemaVersion > Schema.currentVersion) {
      throw new Error(`schema version ${schemaVersion} is not a supported exact-backup format (1..${Schema.currentVersion})`)
    }
    Schema.validate(db, schemaVersion)
    const summary = db.prepare('SELECT COUNT(*) AS rows, MAX(tx) AS max_tx FROM cave_claim').get() as
      { rows: number, max_tx: null | string }
    rows = summary.rows
    maxTx = summary.max_tx
  } catch (error) {
    try { db.close() } catch (closeError) {
      throw new AggregateError([error, closeError],
        `CAVE backup verification failed: ${errorMessage(error)}; database close also failed: ${errorMessage(closeError)}`,
        { cause: error })
    }
    throw error
  }
  db.close()
  const sha256 = hashFile(target)
  if (expected !== undefined && sha256 !== expected) {
    throw new Error(`CAVE backup: SHA-256 mismatch: expected ${expected}, got ${sha256}`)
  }
  return { path: target, bytes: statSync(target).size, sha256, schemaVersion, rows, maxTx }
}

/** Create and atomically publish a verified, point-in-time SQLite snapshot. */
export const backup = (store: Store, destination: string, options: WriteOptions = {}): Snapshot => {
  const force = options.force === true
  const target = resolve(destination)
  const capability = store.adapter.capabilities.backup
  if (capability === undefined) {
    throw new Error(`CAVE backup: SQLite adapter ${JSON.stringify(store.adapter.name)} does not support exact snapshots`)
  }
  const source = capability.location(store.db)
  if (source !== null && sourceFile(source, target)) {
    throw new Error('CAVE backup: destination is the source database')
  }
  if (existsSync(target) && !force) {
    throw new Error(`CAVE backup: ${target} already exists; pass force to replace it`)
  }
  requireStoppedDestination(target, 'backup')
  if (capability.inTransaction(store.db)) {
    throw new Error('CAVE backup: cannot snapshot inside an open transaction')
  }
  const temporary = temporaryPath(target)
  try {
    capability.write(store.db, temporary)
    syncFile(temporary)
    const checked = verifyBackup(temporary)
    publish(temporary, target, force, 'backup')
    return { ...checked, path: target }
  } catch (error) {
    return failWithTemporaryCleanup(temporary, 'backup', error)
  }
}

/** Verify a snapshot, then atomically restore its exact bytes to a stopped destination. */
export const restoreBackup = (
  snapshotPath: string,
  destination: string,
  options: WriteOptions & { expectedSha256?: string } = {}
): Snapshot => {
  const force = options.force === true
  const expectedSha256 = expectedDigest(options.expectedSha256)
  const source = resolve(snapshotPath)
  const target = resolve(destination)
  if (samePath(source, target)) {
    throw new Error('CAVE restore: snapshot and destination are the same file')
  }
  if (sourceFile(source, target)) {
    throw new Error('CAVE restore: destination is a sidecar of the source snapshot')
  }
  if (existsSync(target) && !force) {
    throw new Error(`CAVE restore: ${target} already exists; pass force to replace it`)
  }
  requireStoppedDestination(target, 'restore')
  const checked = verifyBackup(source, expectedSha256)
  const temporary = temporaryPath(target)
  try {
    copyFileSync(source, temporary)
    syncFile(temporary)
    const copied = verifyBackup(temporary, checked.sha256)
    publish(temporary, target, force, 'restore')
    return { ...copied, path: target }
  } catch (error) {
    return failWithTemporaryCleanup(temporary, 'restore', error)
  }
}
