import type { Store } from '@cavelang/store'

/** Read under an internally named savepoint without hiding an error during release. */
export const readSnapshot = <T>(store: Store, name: string, read: () => T): T => {
  store.db.exec(`SAVEPOINT ${name}`)
  let result: T
  try {
    result = read()
  } catch (error) {
    try { store.db.exec(`RELEASE ${name}`) } catch (releaseError) {
      throw new AggregateError([error, releaseError],
        `CAVE read snapshot ${name} failed and release also failed`, { cause: error })
    }
    throw error
  }
  store.db.exec(`RELEASE ${name}`)
  return result
}
