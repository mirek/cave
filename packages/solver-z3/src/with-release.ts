import { errorMessage } from './error-message.ts'

/** Await the operation before releasing its owned native resource. */
export const withRelease = async <T>(operation: () => Promise<T>, release: () => void): Promise<T> => {
  let failed = false
  let operationError: unknown
  try {
    return await operation()
  } catch (error) {
    failed = true
    operationError = error
    throw error
  } finally {
    try { release() } catch (error) {
      if (!failed) throw error
      throw new AggregateError([operationError, error],
        `Z3 operation failed: ${errorMessage(operationError)}; native release also failed: ${errorMessage(error)}`,
        { cause: operationError })
    }
  }
}
