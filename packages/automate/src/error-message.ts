/** Formatting a failed step must not interrupt the remaining cycle. */
export const errorMessage = (value: unknown): string => {
  try {
    return value instanceof Error ? String(value.message) : String(value)
  } catch {
    return '[unprintable thrown value]'
  }
}
