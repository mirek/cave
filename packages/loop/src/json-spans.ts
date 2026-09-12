/** Index valid JSON value prefixes in linear time, without recursion or decoding. */
export const jsonValueEnds = (text: string): Int32Array => {
  const size = text.length
  const next = new Int32Array(size + 1)
  const digits = new Int32Array(size + 1)
  const strings = new Int32Array(size + 1)
  const values = new Int32Array(size + 1)
  const elements = new Int32Array(size + 1)
  const members = new Int32Array(size + 1)
  next[size] = size
  digits[size] = size
  const digit = (at: number): boolean => at < size && text[at]! >= '0' && text[at]! <= '9'
  for (let at = size - 1; at >= 0; at--) {
    const char = text[at]!
    next[at] = char === ' ' || char === '\n' || char === '\r' || char === '\t' ? next[at + 1]! : at
    digits[at] = digit(at) ? digits[at + 1]! : at
    if (char === '"') strings[at] = at + 1
    else if (char === '\\') {
      const escaped = text[at + 1]
      if (escaped !== undefined && '"\\/bfnrt'.includes(escaped)) strings[at] = strings[at + 2] ?? 0
      else if (escaped === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) strings[at] = strings[at + 6] ?? 0
    } else if (char.charCodeAt(0) >= 0x20) strings[at] = strings[at + 1]!
  }
  // Suffix indexes share comma-separated tails across all candidate openings.
  // Every dependency lies to the right, including nested objects and arrays.
  for (let at = size - 1; at >= 0; at--) {
    const char = text[at]!
    if (char === '"') values[at] = strings[at + 1]!
    else if (char === '[' || char === '{') {
      const start = next[at + 1]!
      const close = char === '[' ? ']' : '}'
      values[at] = text[start] === close ? start + 1 : (char === '[' ? elements[start]! : members[start]!)
    } else if (text.startsWith('true', at)) values[at] = at + 4
    else if (text.startsWith('false', at)) values[at] = at + 5
    else if (text.startsWith('null', at)) values[at] = at + 4
    else if (char === '-' || digit(at)) {
      let end = char === '-' ? at + 1 : at
      if (digit(end)) {
        end = text[end] === '0' ? end + 1 : digits[end]!
        let valid = true
        if (text[end] === '.') {
          end++
          valid = digit(end)
          end = digits[end] ?? end
        }
        if (text[end] === 'e' || text[end] === 'E') {
          end++
          if (text[end] === '+' || text[end] === '-') end++
          valid = valid && digit(end)
          end = digits[end] ?? end
        }
        if (valid) values[at] = end
      }
    }
    const end = values[at]!
    if (end === 0) continue
    const separator = next[end]!
    if (text[separator] === ']') elements[at] = separator + 1
    else if (text[separator] === ',') elements[at] = elements[next[separator + 1]!]!
    if (char === '"' && text[separator] === ':') {
      const value = values[next[separator + 1]!]!
      if (value === 0) continue
      const after = next[value]!
      if (text[after] === '}') members[at] = after + 1
      else if (text[after] === ',') members[at] = members[next[after + 1]!]!
    }
  }
  return values
}
