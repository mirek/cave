import type { Database } from './adapter.ts'
import { errorMessage } from './error-message.ts'

/** Keep a multi-query read on one deferred snapshot, including inside caller transactions. */
export const readSnapshot = <T>(db: Database, operation: 'export' | 'resolution' | 'reverse', read: () => T): T => {
  const savepoint = `cave_${operation}_read`
  db.exec(`SAVEPOINT ${savepoint}`)
  let result: T
  try {
    result = read()
  } catch (error) {
    try { db.exec(`RELEASE ${savepoint}`) } catch (releaseError) {
      throw new AggregateError([error, releaseError],
        `CAVE ${operation} failed: ${errorMessage(error)}; read snapshot release also failed: ${errorMessage(releaseError)}`,
        { cause: error })
    }
    throw error
  }
  db.exec(`RELEASE ${savepoint}`)
  return result
}
