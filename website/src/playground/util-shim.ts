/** Minimal browser implementation used by @prelude/parser error messages. */
export const inspect = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
