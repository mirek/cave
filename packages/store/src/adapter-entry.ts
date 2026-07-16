/** Explicit, runtime-neutral SQLite composition surface. */

export { openWith } from './runtime.ts'
export type { Store } from './runtime.ts'
export * as Resolve from './resolve.ts'
export * as Row from './row.ts'
export * as QuerySql from './query-sql.ts'
export * as Record from './record.ts'
export type {
  Adapter as SqliteAdapter,
  BackupCapability as SqliteBackupCapability,
  Capabilities as SqliteCapabilities,
  Database as SqliteDatabase,
  OpenOptions as SqliteOpenOptions,
  Row as SqliteRow,
  Statement as SqliteStatement,
  Value as SqliteValue,
} from './adapter.ts'
