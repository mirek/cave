import type { Database, SqlJsStatic, Statement } from 'sql.js'
import type {
  SqliteAdapter, SqliteDatabase, SqliteStatement, SqliteValue,
} from '@cavelang/store/adapter'

type SqlValue = null | number | string | Uint8Array
type Row = Record<string, SqlValue>

const sqlValue = (value: SqliteValue): SqlValue => {
  if (typeof value === 'bigint') {
    const number = Number(value)
    if (!Number.isSafeInteger(number)) {
      throw new Error('SQLite WASM cannot bind an integer outside the JavaScript safe range')
    }
    return number
  }
  return value
}

class SqlJsStatement implements SqliteStatement {
  private readonly statement: Statement
  private readonly db: Database

  constructor(statement: Statement, db: Database) {
    this.statement = statement
    this.db = db
  }

  private bind(params: readonly SqliteValue[]): void {
    this.statement.reset()
    if (params.length > 0) this.statement.bind(params.map(sqlValue))
  }

  all(...params: SqliteValue[]): Row[] {
    this.bind(params)
    const rows: Row[] = []
    while (this.statement.step()) rows.push(this.statement.getAsObject() as Row)
    this.statement.reset()
    return rows
  }

  get(...params: SqliteValue[]): Row | undefined {
    this.bind(params)
    const row = this.statement.step() ? this.statement.getAsObject() as Row : undefined
    this.statement.reset()
    return row
  }

  run(...params: SqliteValue[]): { changes: number, lastInsertRowid: number } {
    this.bind(params)
    this.statement.step()
    this.statement.reset()
    return { changes: this.db.getRowsModified(), lastInsertRowid: 0 }
  }
}

class SqlJsDatabase implements SqliteDatabase {
  readonly database: Database

  constructor(sqlite: SqlJsStatic, filename = ':memory:') {
    void filename
    this.database = new sqlite.Database()
  }

  exec(sql: string): void {
    this.database.exec(sql)
  }

  prepare(sql: string): SqlJsStatement {
    return new SqlJsStatement(this.database.prepare(sql), this.database)
  }

  close(): void { this.database.close() }
  export(): Uint8Array { return this.database.export() }
}

/** Build an explicit CAVE adapter around one initialized SQL.js module. */
export const createSqlJsAdapter = (sqlite: SqlJsStatic): SqliteAdapter => ({
  name: 'sql.js (WASM)',
  capabilities: {
    transactions: { immediate: true, savepoints: true },
    fullText: 'fts4',
  },
  open: (path, options = {}) => {
    if (options.readOnly === true || options.allowExtension === true) {
      throw new Error('SQLite WASM does not support read-only file stores or native extensions')
    }
    return new SqlJsDatabase(sqlite, path)
  },
})
