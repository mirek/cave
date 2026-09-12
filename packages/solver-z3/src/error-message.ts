/** Formatting a failure must not prevent runtime cleanup or replace its diagnostic. */
export const errorMessage = (error: unknown): string => {
  try { return error instanceof Error ? String(error.message) : String(error) }
  catch { return '[unprintable thrown value]' }
}
