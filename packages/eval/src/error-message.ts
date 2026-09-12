/** Diagnostic formatting must preserve evaluation outcomes and cleanup failures. */
export const errorMessage = (value: unknown): string => {
  try {
    return value instanceof Error ? String(value.message) : String(value)
  } catch {
    return '[unprintable thrown value]'
  }
}
