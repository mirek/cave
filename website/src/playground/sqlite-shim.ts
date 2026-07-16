/**
 * Browser composition boundary for the CAVE SQLite adapter contract.
 */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { SqliteAdapter } from '@cavelang/store/adapter'
import { createSqlJsAdapter } from './sqlite-adapter.ts'

let initializing: undefined | Promise<SqliteAdapter>

export const initializeSqlite = (): Promise<SqliteAdapter> => {
  initializing ??= initSqlJs({ locateFile: () => wasmUrl }).then(createSqlJsAdapter)
  return initializing
}
