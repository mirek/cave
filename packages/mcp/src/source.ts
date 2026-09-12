/** Shared validation for unprefixed MCP actor-source context tokens. */
export const sourceValue = (value: unknown, label: string): undefined | string => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || /[^A-Za-z0-9._/:-]/.test(value)) {
    throw new Error(`${label} must be a context token (letters, digits, . _ / : -)`)
  }
  if (value.startsWith('src:')) {
    throw new Error(`${label} must not include the src: prefix`)
  }
  return value
}
