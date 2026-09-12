import { DatabaseCleanupError } from './errors.ts'
export { DatabaseCleanupError } from './errors.ts'

type Database = { close(): void }

/** Load first, then retire the old database; the caller publishes only on success. */
export const replaceDatabase = <T>(current: Database | undefined, replacement: Database, load: () => T): T => {
  let result: T
  try { result = load() } catch (error) {
    try { replacement.close() } catch (cleanupError) {
      throw new DatabaseCleanupError(error, [cleanupError])
    }
    throw error
  }
  try { current?.close() } catch (error) {
    try { replacement.close() } catch (cleanupError) {
      throw new DatabaseCleanupError(error, [cleanupError])
    }
    throw new DatabaseCleanupError(error)
  }
  return result
}
