import { errorMessage as message } from './error-message.ts'

/** Preserve a pending exception when releasing an evaluation-owned resource fails. */
export const cleanup = (failures: readonly unknown[], release: () => void): void => {
  try { release() }
  catch (error) {
    if (failures.length === 0) throw error
    const previous = failures[0]
    throw new AggregateError([previous, error], `${message(previous)}; evaluation cleanup also failed: ${message(error)}`, { cause: previous })
  }
}

/** Keep diagnostics already attached to cancellation, or retain a simultaneous work failure. */
export const throwIfCancelled = (signal: AbortSignal | undefined, error: unknown): void => {
  try { signal?.throwIfAborted() }
  catch (reason) {
    const pending: unknown[] = [error], seen = new Set<unknown>()
    while (pending.length > 0) {
      const value = pending.pop()
      if (value === reason) throw error
      if (seen.has(value)) continue
      seen.add(value)
      try {
        if (value instanceof AggregateError) {
          try { for (const inner of value.errors) pending.push(inner) } catch { /* Opaque metadata cannot prove cancellation is already included. */ }
        }
        if (value instanceof Error) {
          try {
            const cause = value.cause
            if (cause !== undefined) pending.push(cause)
          } catch { /* Retain the original error even when its cause cannot be read. */ }
        }
      } catch { /* An opaque thrown object may reject prototype inspection too. */ }
    }
    throw new AggregateError([reason, error], `${message(reason)}; evaluation also failed: ${message(error)}`, { cause: reason })
  }
}
