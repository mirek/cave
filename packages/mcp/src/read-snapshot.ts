import type { Store } from '@cavelang/store'
import { errorMessage } from './error-message.ts'

/** A deferred snapshot permits peer writes and nests in the caller's transaction. */
export const readSnapshot = <T>(store: Store, read: () => T): T => {
  const savepoint = 'cave_mcp_read'
  store.db.exec(`SAVEPOINT ${savepoint}`)
  let result: T
  try { result = read() } catch (error) {
    try { store.db.exec(`RELEASE ${savepoint}`) } catch (releaseError) {
      throw new AggregateError([error, releaseError],
        `CAVE MCP read failed: ${errorMessage(error)}; read snapshot release also failed: ${errorMessage(releaseError)}`,
        { cause: error })
    }
    throw error
  }
  store.db.exec(`RELEASE ${savepoint}`)
  return result
}
