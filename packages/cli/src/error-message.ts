/** Formatting an exception must not replace the failure being reported. */
export const errorMessage = (error: unknown, debug = false): string => {
  if (debug) {
    try {
      if (error instanceof Error) {
        const stack = error.stack
        if (stack !== undefined) return String(stack)
      }
    } catch { /* An unavailable stack can still have a useful message. */ }
  }
  try { return error instanceof Error ? String(error.message) : String(error) }
  catch { return '[unprintable thrown value]' }
}
