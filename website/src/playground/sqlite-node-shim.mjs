import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { DatabaseSync, setSqliteModule } from './sqlite-adapter.ts'

const require = createRequire(import.meta.url)
const module = await initSqlJs({
  locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
})
setSqliteModule(module)

export { DatabaseSync }
