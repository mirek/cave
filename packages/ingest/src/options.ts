export const booleanOption = (value: unknown, name: string): boolean => {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`)
  return value
}


/** Filesystem and URL paths must not be silently repaired during encoding. */
export const sourcePath = (value: string, name: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  if (/[\uD800-\uDFFF]/u.test(value)) throw new TypeError(`${name} must contain well-formed Unicode`)
  return value
}

/** Capture and validate the whole source list before any selection work. */
export const sourceList = (input: readonly string[], name: string): string[] => {
  if (!Array.isArray(input)) throw new TypeError(`${name} must be an array of strings`)
  const values = Array.from(input)
  if (values.some(value => typeof value !== 'string')) throw new TypeError(`${name} must be an array of strings`)
  for (const value of values) sourcePath(value, name)
  return values
}
