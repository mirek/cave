import type { Database, SqlJsStatic, Statement } from 'sql.js'
import { errorMessage } from './errors.ts'
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

/** SQL names are data, including __proto__; repeated names keep the last value. */
const readRow = (statement: Statement, names: readonly string[]): Row => {
  const values = statement.get()
  const row = Object.create(null) as Row
  names.forEach((name, index) => { row[name] = values[index]! })
  return row
}

class SqlJsStatement implements SqliteStatement {
  private statement: Statement | undefined
  private readonly db: Database
  private readonly sql: string
  private readonly assertOpen: () => void

  constructor(sql: string, db: Database, assertOpen: () => void) {
    this.sql = sql
    this.db = db
    this.assertOpen = assertOpen
    this.statement = db.prepare(sql)
  }

  private execute<T>(params: readonly SqliteValue[], read: (statement: Statement) => T): T {
    this.assertOpen()
    const statement = this.statement ?? this.db.prepare(this.sql)
    this.statement = undefined
    let result: T
    try {
      if (params.length > 0) statement.bind(params.map(sqlValue))
      result = read(statement)
    } catch (error) {
      try { statement.free() } catch (freeError) {
        throw new AggregateError([error, freeError],
          `${errorMessage(error)}; SQLite WASM statement release also failed: ${errorMessage(freeError)}`,
          { cause: error })
      }
      throw error
    }
    statement.free()
    return result
  }

  all(...params: SqliteValue[]): Row[] {
    return this.execute(params, statement => {
      const rows: Row[] = []
      let names: string[] | undefined
      while (statement.step()) {
        names ??= statement.getColumnNames()
        rows.push(readRow(statement, names))
      }
      return rows
    })
  }

  get(...params: SqliteValue[]): Row | undefined {
    return this.execute(params, statement => statement.step() ? readRow(statement, statement.getColumnNames()) : undefined)
  }

  run(...params: SqliteValue[]): { changes: number, lastInsertRowid: number } {
    return this.execute(params, statement => {
      // RETURNING yields rows before SQLite finalizes the statement's change count.
      while (statement.step()) { /* run discards result rows, as the native adapter does. */ }
      const changes = this.db.getRowsModified()
      const lastInsertRowid = this.db.exec('SELECT last_insert_rowid()')[0]!.values[0]![0] as number
      return { changes, lastInsertRowid }
    })
  }
}

class SqlJsDatabase implements SqliteDatabase {
  readonly database: Database
  private closed = false

  private readonly assertOpen = (): void => {
    if (this.closed) throw new Error('SQLite WASM database is closed')
  }

  constructor(sqlite: SqlJsStatic) {
    this.database = new sqlite.Database()
  }

  exec(sql: string): void {
    this.assertOpen()
    this.database.exec(sql)
  }

  prepare(sql: string): SqlJsStatement {
    this.assertOpen()
    return new SqlJsStatement(sql, this.database, this.assertOpen)
  }

  close(): void {
    if (this.closed) return
    this.database.close()
    this.closed = true
  }
  export(): Uint8Array { this.assertOpen(); return this.database.export() }
}

/** Build an explicit CAVE adapter around one initialized SQL.js module. */
export const createSqlJsAdapter = (sqlite: SqlJsStatic): SqliteAdapter => ({
  name: 'sql.js (WASM)',
  capabilities: {
    transactions: { immediate: true, savepoints: true },
    fullText: 'fts4',
  },
  open: (path, options = {}) => {
    if (path !== ':memory:') {
      throw new Error('SQLite WASM supports only :memory: databases; file paths are not persistent')
    }
    if (options.readOnly === true || options.allowExtension === true) {
      throw new Error('SQLite WASM does not support read-only file stores or native extensions')
    }
    return new SqlJsDatabase(sqlite)
  },
})
