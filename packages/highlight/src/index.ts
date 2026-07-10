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
import { Language, Parser } from 'web-tree-sitter'
import { createHighlighter, type Highlighter } from './core.ts'

export * from './core.ts'

const resolvePath = (specifier: string): string =>
  fileURLToPath(import.meta.resolve(specifier))

const create = async (): Promise<Highlighter> => {
  await Parser.init()
  const language = await Language.load(resolvePath('@cavelang/tree-sitter-cave/wasm'))
  return createHighlighter(language, readFileSync(resolvePath('@cavelang/tree-sitter-cave/highlights'), 'utf8'))
}

let cached: undefined | Promise<Highlighter>

/** The process-wide highlighter; loads the grammar WASM on first call. */
export const highlighter = (): Promise<Highlighter> =>
  cached ??= create()
