import type { Span } from '@cavelang/highlight/browser'

/**
 * Highlight spans for the ISO-style EBNF used in spec §16. Captures reuse the
 * site's tree-sitter classes: rule definitions are `keyword`, `(* … *)` comments
 * `comment`, quoted terminals `string`, `= | ;` `operator`, and grouping
 * brackets `punctuation`. Unterminated comments and strings run to the end of
 * the source (comments) or line (strings) so partial edits stay readable.
 */
export const ebnfSpans = (source: string): Span[] => {
  const spans: Span[] = []
  let at = 0
  let lineStart = true
  while (at < source.length) {
    const char = source[at]!
    if (source.startsWith('(*', at)) {
      const close = source.indexOf('*)', at + 2)
      const end = close === -1 ? source.length : close + 2
      spans.push({ start: at, end, capture: 'comment' })
      at = end
    } else if (char === '"' || char === "'" || char === '`') {
      const lineEnd = source.indexOf('\n', at)
      const close = source.indexOf(char, at + 1)
      const limit = lineEnd === -1 ? source.length : lineEnd
      const end = close === -1 || close > limit ? limit : close + 1
      spans.push({ start: at, end, capture: 'string' })
      at = end
    } else if (/[A-Za-z_]/u.test(char)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(at))![0]
      const end = at + name.length
      if (lineStart && /^\s*=/u.test(source.slice(end))) spans.push({ start: at, end, capture: 'keyword' })
      at = end
    } else if (char === '=' || char === '|' || char === ';' || char === ',' || char === '-') {
      spans.push({ start: at, end: at + 1, capture: 'operator' })
      at++
    } else if ('[](){}'.includes(char)) {
      spans.push({ start: at, end: at + 1, capture: 'punctuation' })
      at++
    } else {
      at++
    }
    if (char === '\n') lineStart = true
    else if (!/\s/u.test(char)) lineStart = false
  }
  return spans
}
