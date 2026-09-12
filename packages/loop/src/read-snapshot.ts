import type { Store } from '@cavelang/store'
const errorMessage = (value: unknown): string => {
  try { return value instanceof Error ? String(value.message) : String(value) }
  catch { return '[unprintable thrown value]' }
}

/** A deferred snapshot permits peer writes and nests in the caller's transaction. */
export const readSnapshot = <T>(store: Store, read: () => T): T => {
  const savepoint = 'cave_loop_read'
  store.db.exec(`SAVEPOINT ${savepoint}`)
  let result: T
  try { result = read() } catch (error) {
    try { store.db.exec(`RELEASE ${savepoint}`) } catch (releaseError) {
      throw new AggregateError([error, releaseError],
        `CAVE loop read failed: ${errorMessage(error)}; read snapshot release also failed: ${errorMessage(releaseError)}`,
        { cause: error })
    }
    throw error
  }
  store.db.exec(`RELEASE ${savepoint}`)
  return result
}
