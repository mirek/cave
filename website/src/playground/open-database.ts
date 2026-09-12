import { openWith, type SqliteAdapter, type Store } from '@cavelang/store/adapter'
import { errorMessage, SqliteInitializationError } from './errors.ts'

/** Startup faults require a fresh runtime, including uncertain startup cleanup. */
export const openPlaygroundDatabase = (adapter: SqliteAdapter): Store => {
  try {
    return openWith(adapter, ':memory:')
  } catch (error) {
    throw new SqliteInitializationError(`Playground database initialization failed: ${errorMessage(error)}`, { cause: error })
  }
}
