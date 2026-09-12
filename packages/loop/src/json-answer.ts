import { jsonValueEnds } from './json-spans.ts'

/**
 * Last eligible JSON array amid prose. Complete strings and objects consume
 * nested candidates; an optional own property names a supported object wrapper.
 * Malformed prose retains balanced-candidate recovery. No input is evaluated.
 */
export const lastJsonArray = (output: string, property?: string): unknown[] | undefined => {
  // Complete JSON containers consume nested candidates before array answers
  // are selected. Raw delimiter boundaries retain recovery from unfinished prose.
  const spans: { start: number, end: number, rawEnd: number }[] = []
  type Opening = { index: number, close: string }
  const stack: Opening[] = []
  const rawStack: Opening[] = []
  let quote: number | undefined
  let escaped = false
  for (let at = 0; at < output.length; at += 1) {
    const char = output[at]
    let opening: Opening | undefined
    if (char === '[' || char === '{') {
      opening = { index: spans.length, close: char === '[' ? ']' : '}' }
      spans.push({ start: at, end: -1, rawEnd: -1 })
      rawStack.push(opening)
    } else if (rawStack.length > 0 && char === rawStack[rawStack.length - 1]!.close) {
      spans[rawStack.pop()!.index]!.rawEnd = at
    }
    if (quote !== undefined) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') {
        spans[quote]!.end = at
        quote = undefined
      }
      continue
    }
    if (char === '"') {
      quote = spans.length
      spans.push({ start: at, end: -1, rawEnd: -1 })
    } else if (opening !== undefined) {
      stack.push(opening)
    } else if (stack.length > 0 && char === stack[stack.length - 1]!.close) {
      spans[stack.pop()!.index]!.end = at
    }
  }
  const valueEnds = jsonValueEnds(output)
  let parsed: unknown
  let consumed = -1
  for (const { start, end, rawEnd } of spans) {
    if (start <= consumed) continue
    // Recover answers after unfinished prose brackets or quotes, but only
    // after valid outer JSON has consumed every candidate inside its span.
    for (const candidate of new Set([end, rawEnd])) {
      if (candidate === -1 || valueEnds[start] !== candidate + 1) continue
      try {
        const value: unknown = JSON.parse(output.slice(start, candidate + 1))
        if (Array.isArray(value)) parsed = value
        else if (property !== undefined && value !== null && typeof value === 'object' &&
            Object.hasOwn(value, property)) {
          const nested = (value as Record<string, unknown>)[property]
          if (Array.isArray(nested)) parsed = nested
        }
        consumed = candidate
        break
      } catch {
        // Try the recovery boundary, then the next balanced candidate.
      }
    }
  }
  return Array.isArray(parsed) ? parsed : undefined
}
