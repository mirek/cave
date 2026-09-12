import type { Store } from '@cavelang/store/adapter'

const message = (error: unknown): string => {
  try { return error instanceof Error ? String(error.message) : String(error) }
  catch { return '[unprintable thrown value]' }
}

/** A deferred savepoint also nests within a caller-owned transaction. */
export const readSnapshot = <T>(store: Store, read: () => T): T => {
  const savepoint = 'cave_query_read'
  store.db.exec(`SAVEPOINT ${savepoint}`)
  let result: T
  try { result = read() } catch (error) {
    try { store.db.exec(`RELEASE ${savepoint}`) } catch (releaseError) {
      throw new AggregateError([error, releaseError],
        `CAVE-Q matching failed: ${message(error)}; read snapshot release also failed: ${message(releaseError)}`,
        { cause: error })
    }
    throw error
  }
  store.db.exec(`RELEASE ${savepoint}`)
  return result
}
