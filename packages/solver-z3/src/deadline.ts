export const withDeadline = async (
  context: { interrupt: () => void },
  timeoutMs: number,
  check: () => Promise<'sat' | 'unsat' | 'unknown'>
): Promise<{ readonly status: 'sat' | 'unsat' | 'unknown', readonly interrupted: boolean }> => {
  let interrupted = false
  let interruptFailed = false
  let interruptError: unknown
  // Dispatch and native cancellation are asynchronous. Keep requesting cancellation
  // until the check settles instead of assuming one interrupt was acknowledged.
  const interrupt = (): void => {
    interrupted = true
    try { context.interrupt() } catch (error) {
      // Timer failures belong to this check, not the host's uncaught-error
      // handler. Retain one error while continuing cooperative cancellation.
      if (!interruptFailed) { interruptFailed = true; interruptError = error }
    }
    timer = setTimeout(interrupt, 50)
    timer.unref()
  }
  let timer = setTimeout(interrupt, timeoutMs)
  timer.unref()
  try {
    let status: 'sat' | 'unsat' | 'unknown'
    try { status = await check() } catch (error) {
      if (interruptFailed) {
        throw new AggregateError([error, interruptError],
          `Z3 check failed: ${errorMessage(error)}; deadline interruption also failed: ${errorMessage(interruptError)}`,
          { cause: error })
      }
      throw error
    }
    // Wait for native work before the caller releases its solver/optimizer.
    if (interruptFailed) throw interruptError
    return { status, interrupted }
  } finally {
    clearTimeout(timer)
  }
}
import { errorMessage } from './error-message.ts'
