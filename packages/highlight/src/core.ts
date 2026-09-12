import { Parser, Query, type Language } from 'web-tree-sitter'

/** One highlighted range: `capture` is a `highlights.scm` name like `keyword`. */
export type Span = {
  readonly start: number
  readonly end: number
  readonly capture: string
}

/** Capture name (or dotted prefix) to ANSI SGR parameters, e.g. `keyword: '35'`. */
export type Theme = Readonly<Record<string, string>>

/**
 * Terminal-default-friendly theme: entities (`variable`) stay uncolored on
 * purpose — they are the bulk of every line; color carries the structure.
 */
export const defaultTheme: Theme = {
  comment: '90',
  keyword: '35',
  'keyword.operator': '95',
  property: '33',
  number: '36',
  type: '36',
  string: '32',
  'string.special': '96',
  label: '34',
  constant: '33',
  operator: '91',
  tag: '94',
  punctuation: '90'
}

export type Highlighter = {
  /** Non-overlapping capture spans of `text`, in document order. */
  readonly spans: (text: string) => readonly Span[]
  /** `text` with ANSI colors applied per `theme` (default {@link defaultTheme}). */
  readonly ansi: (text: string, theme?: Theme) => string
}

/** A factory-created highlighter whose parser and query belong to the caller. */
export type OwnedHighlighter = Highlighter & {
  /** Release the parser and query once; subsequent spans/ansi calls throw. */
  readonly close: () => void
}

/** Longest dotted prefix of `capture` present in `theme`. */
const styleOf = (theme: Theme, capture: string): undefined | string => {
  for (let name = capture; ; name = name.slice(0, name.lastIndexOf('.'))) {
    const style = Object.hasOwn(theme, name) ? theme[name] : undefined
    if (style !== undefined) {
      return style
    }
    if (!name.includes('.')) {
      return undefined
    }
  }
}

/** Renders `spans` over `text` as ANSI; exported for custom span sources. */
export const paint = (text: string, spans: readonly Span[], theme: Theme = defaultTheme): string => {
  const ranges = spans.map(({ start, end, capture }) => ({ start, end, capture }))
  let out = ''
  let at = 0
  for (const span of ranges) {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
        span.start < at || span.end < span.start || span.end > text.length) {
      throw new TypeError('Highlight spans must be ordered, non-overlapping integer ranges within the source')
    }
    const style = styleOf(theme, span.capture)
    out += text.slice(at, span.start)
    const piece = text.slice(span.start, span.end)
    out += style === undefined ? piece : `\u001B[${style}m${piece}\u001B[0m`
    at = span.end
  }
  return out + text.slice(at)
}

/** Release an owned resource without replacing a primary failure. */
const withCleanup = <T>(body: () => T, cleanup: () => void, message: string): T => {
  let result: T
  try { result = body() } catch (error) {
    try { cleanup() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], message, { cause: error })
    }
    throw error
  }
  cleanup()
  return result
}

/** Creates a highlighter from an initialized Tree-sitter language and query. */
export const createHighlighter = (language: Language, querySource: string): OwnedHighlighter => {
  const query = new Query(language, querySource)
  let parser: Parser | undefined
  const release = (): void => {
    const errors: unknown[] = []
    try { parser?.delete() } catch (error) { errors.push(error) }
    try { query.delete() } catch (error) { errors.push(error) }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Highlighter cleanup failed', { cause: errors[0] })
    }
  }
  try {
    parser = new Parser()
    parser.setLanguage(language)
  } catch (error) {
    withCleanup(() => { throw error }, release, 'Highlighter setup failed and cleanup also failed')
  }
  let closed = false
  const spans = (text: string): readonly Span[] => {
    if (closed) throw new Error('Highlighter is closed')
    const tree = parser!.parse(text)
    if (tree === null) {
      return []
    }
    return withCleanup(() => {
      const all = query.captures(tree.rootNode)
        .map(({ name, node }) => ({ start: node.startIndex, end: node.endIndex, capture: name }))
        .filter(span => span.end > span.start)
        .sort((a, b) => a.start - b.start || b.end - a.end)
      // One capture per node keeps these disjoint already; guard anyway so a
      // future query with nested captures degrades to outermost-wins.
      const disjoint: Span[] = []
      let at = 0
      for (const span of all) {
        if (span.start >= at) {
          disjoint.push(span)
          at = span.end
        }
      }
      return disjoint
    }, () => tree.delete(), 'Highlight capture failed and tree cleanup also failed')
  }
  return {
    spans,
    ansi: (text, theme = defaultTheme) => paint(text, spans(text), theme),
    close: () => {
      if (closed) return
      closed = true
      release()
    }
  }
}
