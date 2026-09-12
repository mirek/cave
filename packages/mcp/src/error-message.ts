/** Formatting diagnostics must not replace the failure being reported. */
export const errorMessage = (value: unknown): string => {
  try {
    return value instanceof Error ? String(value.message) : String(value)
  } catch {
    return '[unprintable thrown value]'
  }
}
