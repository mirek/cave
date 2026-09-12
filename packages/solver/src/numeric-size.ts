/** Estimate pre-reduction decimal digits without constructing a BigInt. */
const integerDigits = (value: unknown): number => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(Math.abs(value)).length : 0
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value)) return 0
  return value.length - (/^[+-]/.test(value) ? 1 : 0)
}

export const numericDigits = (value: unknown, sort: 'int' | 'real'): number => {
  if (sort === 'int') return integerDigits(value)
  if (typeof value !== 'string') {
    if (value === null || typeof value !== 'object') return 0
    const pair = value as { numerator?: unknown, denominator?: unknown }
    return integerDigits(pair.numerator) + integerDigits(pair.denominator)
  }
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(value)
  if (match === null) return 0
  const coefficient = match[2]!
  const digits = coefficient.replace('.', '')
  const exponent = match[3] === undefined ? 0 : Number(match[3])
  if (!Number.isSafeInteger(exponent)) return 0 // Exact reports invalid exponent syntax.
  // Zero never constructs a power of ten, but reading its coefficient still counts.
  if (!/[1-9]/.test(digits)) return digits.length + 1
  const dot = coefficient.indexOf('.')
  const scale = (dot === -1 ? 0 : coefficient.length - dot - 1) - exponent
  return digits.length + Math.max(0, -scale) + (scale > 0 ? scale + 1 : 1)
}
