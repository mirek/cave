import { errorMessage } from './error-message.ts'

/** Preserve cancellation details and independent transport failures together. */
export const rethrowFetchFailure = (signal: AbortSignal | undefined, error: unknown): never => {
  if (!signal?.aborted) throw error
  const reason = signal.reason
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
  throw new AggregateError([reason, error],
    `${errorMessage(reason)}; source fetch also failed: ${errorMessage(error)}`, { cause: reason })
}
