/**
 * CAVE syntax highlighting.
 *
 * Single-source: parses with the `@cavelang/tree-sitter-cave` WASM grammar
 * via web-tree-sitter and colors the captures of its `queries/highlights.scm`
 * — the same query editors use — so terminal output and editor highlighting
 * can never drift apart.
 *
 * `highlighter()` loads the grammar once per process; `spans` yields flat,
 * non-overlapping capture ranges and `ansi` renders them with a
 * capture-name-keyed theme (longest dotted prefix wins, unstyled text passes
 * through untouched).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Language, Parser, Query } from 'web-tree-sitter'

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

const resolvePath = (specifier: string): string =>
  fileURLToPath(import.meta.resolve(specifier))

/** Longest dotted prefix of `capture` present in `theme`. */
const styleOf = (theme: Theme, capture: string): undefined | string => {
  for (let name = capture; ; name = name.slice(0, name.lastIndexOf('.'))) {
    const style = theme[name]
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
  let out = ''
  let at = 0
  for (const span of spans) {
    const style = styleOf(theme, span.capture)
    out += text.slice(at, span.start)
    const piece = text.slice(span.start, span.end)
    out += style === undefined ? piece : `\u001B[${style}m${piece}\u001B[0m`
    at = span.end
  }
  return out + text.slice(at)
}

const create = async (): Promise<Highlighter> => {
  await Parser.init()
  const language = await Language.load(resolvePath('@cavelang/tree-sitter-cave/wasm'))
  const query = new Query(language, readFileSync(resolvePath('@cavelang/tree-sitter-cave/highlights'), 'utf8'))
  const parser = new Parser()
  parser.setLanguage(language)
  const spans = (text: string): readonly Span[] => {
    const tree = parser.parse(text)
    if (tree === null) {
      return []
    }
    try {
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
    } finally {
      tree.delete()
    }
  }
  return {
    spans,
    ansi: (text, theme = defaultTheme) => paint(text, spans(text), theme)
  }
}

let cached: undefined | Promise<Highlighter>

/** The process-wide highlighter; loads the grammar WASM on first call. */
export const highlighter = (): Promise<Highlighter> =>
  cached ??= create()
