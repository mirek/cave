import type { Database, SqlJsStatic, Statement } from 'sql.js'

type SqlValue = null | number | string | Uint8Array
type Row = Record<string, SqlValue>

let sqlite: undefined | SqlJsStatic

export const setSqliteModule = (module: SqlJsStatic): void => {
  sqlite = module
}

class StatementSync {
  private readonly statement: Statement
  private readonly db: Database

  constructor(statement: Statement, db: Database) {
    this.statement = statement
    this.db = db
  }

  private bind(params: readonly SqlValue[]): void {
    this.statement.reset()
    if (params.length > 0) this.statement.bind([...params])
  }

  all(...params: SqlValue[]): Row[] {
    this.bind(params)
    const rows: Row[] = []
    while (this.statement.step()) rows.push(this.statement.getAsObject() as Row)
    this.statement.reset()
    return rows
  }

  get(...params: SqlValue[]): Row | undefined {
    this.bind(params)
    const row = this.statement.step() ? this.statement.getAsObject() as Row : undefined
    this.statement.reset()
    return row
  }

  run(...params: SqlValue[]): { changes: number, lastInsertRowid: number } {
    this.bind(params)
    this.statement.step()
    this.statement.reset()
    return { changes: this.db.getRowsModified(), lastInsertRowid: 0 }
  }
}

export class DatabaseSync {
  readonly database: Database

  constructor(filename = ':memory:') {
    if (sqlite === undefined) throw new Error('SQLite WASM has not been initialized')
    void filename
    this.database = new sqlite.Database()
  }

  exec(sql: string): void {
    try {
      this.database.exec(sql)
    } catch (error) {
      if (sql.includes('USING fts5')) {
        this.database.exec(sql.replace('USING fts5', 'USING fts4'))
        return
      }
      throw error
    }
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this.database.prepare(sql), this.database)
  }

  close(): void { this.database.close() }
  export(): Uint8Array { return this.database.export() }
}
