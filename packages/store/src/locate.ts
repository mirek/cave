/**
 * Locating a store by path — a SQLite file, a CAVE text file assembled in
 * memory, or nothing yet.
 *
 * Canonical CAVE text is the interchange format (spec §2.2), so a text file
 * is a complete description of a store: every command that only reads can
 * treat `notes.cave` exactly like `notes.db` by replaying it into an
 * in-memory store first. Detection is by content, never by extension — a
 * store named `k.cave` and a text file named `notes.txt` both work.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { resolve } from 'node:path'
import { nodeSqliteAdapter } from './node-adapter.ts'
import { openWith } from './runtime.ts'
import type { OpenOptions, Store } from './runtime.ts'
import type { Access } from './store.ts'

/** What a `--db` path names. */
export type Kind = 'memory' | 'sqlite' | 'text' | 'missing'

/** SQLite database files begin with this NUL-terminated 16-byte header. */
const sqliteHeader = 'SQLite format 3\u0000'

/** @returns `true` when the file starts with the SQLite header — a store file rather than canonical text. */
export const isStoreFile = (path: string): boolean => {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(16)
    return readSync(fd, head, 0, 16, 0) === 16 && head.toString('latin1') === sqliteHeader
  } finally {
    closeSync(fd)
  }
}

/** Classifies a store path by what is on disk. */
export const kindOf = (path: string): Kind => {
  if (path === ':memory:') {
    return 'memory'
  }
  if (!existsSync(path)) {
    return 'missing'
  }
  return isStoreFile(path) ? 'sqlite' : 'text'
}

/**
 * What the caller will do with the store. A `read` never creates, migrates,
 * or changes anything on disk — SQLite opens read-only, so a write-protected
 * store serves too (the `-wal`/`-shm` sidecars of a WAL-mode store are the
 * only files SQLite may recreate, since readers and writers coordinate
 * through them; an `immutable` open would avoid them only by risking stale
 * reads under a concurrent writer). A `scratch` open is a dry run that appends inside a
 * transaction it rolls back: writable, but it creates and migrates nothing
 * either. A `write` open creates a missing SQLite store and upgrades an
 * older schema, as `cave add` always has.
 */
export type Intent = 'read' | 'scratch' | 'write'

/**
 * Completes a text store after its file is replayed (spec §23.4): the
 * connector follows the `source/<name>` declarations the file carries,
 * resolving their paths against the file's directory (`root` is the file's
 * absolute path). The store package knows nothing about sources; surfaces
 * pass `@cavelang/connect`'s `assemble`. A thrown `LocateError` fails the
 * load like unparsable text.
 */
export type Assemble = (store: Store, root: string) => void

export type LocateOptions = Omit<OpenOptions, 'access'> & {
  readonly intent?: Intent
  readonly assemble?: Assemble
}

const accessOf = (intent: Intent): Access =>
  intent === 'read' ? 'read-only' : intent === 'scratch' ? 'no-migrate' : 'migrate'

/** Opens an existing SQLite store; a schema that a non-writing open cannot use is a usage failure. */
const openSqlite = (path: string, intent: Intent, options: OpenOptions): Store => {
  try {
    return openWith(nodeSqliteAdapter, path, { ...options, access: accessOf(intent) })
  } catch (error) {
    if (intent !== 'write' && error instanceof Error && error.message.startsWith('CAVE: schema')) {
      throw new LocateError(`${path}: ${error.message.slice('CAVE: '.length)}`)
    }
    throw error
  }
}

/**
 * A `--db` path that cannot be opened as asked: nothing there for a read,
 * CAVE text for a write, or text that does not parse. Surfaces report it as
 * a usage failure rather than a crash.
 */
export class LocateError extends Error {
  override readonly name = 'LocateError'
}

/** Message for a read open of a path with nothing behind it. */
export const missingStoreMessage = (path: string): string =>
  `no store at ${path} — create one with \`cave add --db ${path}\`, or pass a CAVE text file`

/** Message for a write open of a CAVE text file. */
export const textStoreReadOnlyMessage = (path: string): string =>
  `${path} is CAVE text, not a database — text stores are read-only; ` +
  `materialize it with \`cave import --db <store.db> ${path}\``

/**
 * Replays a CAVE text file into a fresh in-memory store. Replay uses
 * `cave import` semantics — no actor stamp (spec §9.5), so the assembled
 * claims are the ones `cave import` of the same file would store. Any
 * line that fails to parse fails the load: the file *is* the database,
 * and a store silently missing rows is worse than an error.
 */
export const openText = (path: string, options: Omit<OpenOptions, 'access'> & { readonly assemble?: Assemble } = {}): Store => {
  const text = readFileSync(path, 'utf8')
  // A fresh in-memory store is always created and initialized: an `access`
  // mode is meaningless here and must not reach the open.
  const store = openWith(nodeSqliteAdapter, ':memory:', { registry: options.registry })
  try {
    const result = store.ingest(text)
    if (result.problems.length > 0) {
      const detail = result.problems.map(problem => `  ${path} line ${problem.line}: ${problem.message}`)
      throw new LocateError(`cannot load ${path} as a store — fix these lines (cave parse ${path}):\n${detail.join('\n')}`)
    }
    options.assemble?.(store, resolve(path))
  } catch (error) {
    store.close()
    throw error
  }
  return store
}

/**
 * Opens the store a `--db` path names, by content:
 *
 * - `:memory:` — a fresh in-memory store;
 * - a SQLite file — read-only for `read`, without migration for `scratch`,
 *   migrating for `write`; an older schema fails a non-writing open with
 *   the command that migrates it;
 * - any other existing file — CAVE text, replayed into memory (never for
 *   `write`: nothing could persist, so it is refused with the
 *   materialization hint);
 * - a missing path — created for `write`, refused otherwise so a typo
 *   never leaves an empty database behind.
 */
export const openAt = (path: string, options: LocateOptions = {}): Store => {
  const { intent = 'write', ...openOptions } = options
  switch (kindOf(path)) {
    case 'memory':
      return openWith(nodeSqliteAdapter, path, openOptions)
    case 'sqlite':
      return openSqlite(path, intent, openOptions)
    case 'text':
      if (intent === 'write') {
        throw new LocateError(textStoreReadOnlyMessage(path))
      }
      return openText(path, openOptions)
    case 'missing':
      if (intent !== 'write') {
        throw new LocateError(missingStoreMessage(path))
      }
      return openWith(nodeSqliteAdapter, path, openOptions)
  }
}
