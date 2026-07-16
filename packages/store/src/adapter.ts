/** Runtime-neutral SQLite contract used by the CAVE store. */

export type Value = null | number | bigint | string | Uint8Array
export type Row = Record<string, unknown>

export type Statement = {
  readonly all: (...params: Value[]) => Row[]
  readonly get: (...params: Value[]) => Row | undefined
  readonly run: (...params: Value[]) => {
    readonly changes: number | bigint
    readonly lastInsertRowid: number | bigint
  }
}

export type Database = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => Statement
  readonly close: () => void
}

export type OpenOptions = {
  readonly readOnly?: boolean
  /** Permit native extension loading when the implementation supports it. */
  readonly allowExtension?: boolean
}

export type BackupCapability = {
  /** Absolute or implementation-defined source location; null for memory stores. */
  readonly location: (db: Database) => string | null
  readonly inTransaction: (db: Database) => boolean
  /** Write a transactionally consistent standalone database image. */
  readonly write: (db: Database, destination: string) => void
}

export type Capabilities = {
  /** CAVE requires immediate write transactions and nested savepoints. */
  readonly transactions: {
    readonly immediate: true
    readonly savepoints: true
  }
  /** Full-text virtual-table implementation used by the schema. */
  readonly fullText: 'fts4' | 'fts5'
  /** Optional loading of native SQLite extensions. */
  readonly loadExtension?: (db: Database, path: string) => void
  /** Optional exact snapshot support. */
  readonly backup?: BackupCapability
}

/**
 * A synchronous SQLite implementation. Runtime selection happens by passing
 * one of these to `openWith`, never by replacing source modules at build time.
 */
export type Adapter = {
  readonly name: string
  readonly capabilities: Capabilities
  readonly open: (path: string, options?: OpenOptions) => Database
}
