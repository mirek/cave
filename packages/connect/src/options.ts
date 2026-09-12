/** Validate optional connector mode flags without coercion. */
export const booleanOption = (value: unknown, name: string): boolean => {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`)
  return value
}
