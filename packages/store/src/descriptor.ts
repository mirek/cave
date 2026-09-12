import { closeSync } from 'node:fs'
import { errorMessage } from './error-message.ts'

/** Close once without allowing cleanup to replace the operation's error. */
export const withDescriptor = <T>(fd: number, operation: string, body: (fd: number) => T): T => {
  let result: T
  try {
    result = body(fd)
  } catch (error) {
    try { closeSync(fd) } catch (closeError) {
      throw new AggregateError([error, closeError],
        `CAVE ${operation} failed: ${errorMessage(error)}; descriptor close also failed: ${errorMessage(closeError)}`,
        { cause: error })
    }
    throw error
  }
  closeSync(fd)
  return result
}
