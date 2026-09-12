/**
 * Browser composition boundary for the CAVE SQLite adapter contract.
 */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { SqliteAdapter } from '@cavelang/store/adapter'
import { createSqlJsAdapter } from './sqlite-adapter.ts'
import { errorMessage, SqliteInitializationError } from './errors.ts'
export { SqliteInitializationError } from './errors.ts'

let initializing: undefined | Promise<SqliteAdapter>

export const initializeSqlite = (): Promise<SqliteAdapter> => {
  initializing ??= initSqlJs({ locateFile: () => wasmUrl }).then(createSqlJsAdapter).catch(error => {
    // SQL.js caches its initialization promise too. Recovery requires a fresh
    // worker realm, rather than retrying this rejected module instance.
    throw new SqliteInitializationError(errorMessage(error), { cause: error })
  })
  return initializing
}
