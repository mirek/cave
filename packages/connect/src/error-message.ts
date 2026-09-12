/** Preserve failures even when their diagnostic text cannot be read. */
export const errorMessage = (value: unknown): string => {
  try {
    return value instanceof Error ? String(value.message) : String(value)
  } catch {
    return '[unprintable thrown value]'
  }
}
