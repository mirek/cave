/**
 * Browser compatibility layer for the small synchronous node:sqlite surface
 * used by @cavelang/store. SQL.js provides SQLite compiled to WebAssembly;
 * this adapter lets the production store/query implementation run unchanged.
 */
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { setSqliteModule } from './sqlite-adapter.ts'

export { DatabaseSync } from './sqlite-adapter.ts'

let initializing: undefined | Promise<SqlJsStatic>

export const initializeSqlite = (): Promise<SqlJsStatic> => {
  initializing ??= initSqlJs({ locateFile: () => wasmUrl }).then(module => {
    setSqliteModule(module)
    return module
  })
  return initializing
}
