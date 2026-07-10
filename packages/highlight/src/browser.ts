/** Browser entry point for CAVE's Tree-sitter highlighter. */

import { Language, Parser } from 'web-tree-sitter'
import { createHighlighter, type Highlighter } from './core.ts'

export * from './core.ts'

export type BrowserHighlighterOptions = {
  /** URL emitted for `web-tree-sitter/web-tree-sitter.wasm`. */
  readonly parserWasmUrl: string
  /** URL emitted for `@cavelang/tree-sitter-cave/wasm`. */
  readonly languageWasmUrl: string
  /** Contents of `@cavelang/tree-sitter-cave/highlights`. */
  readonly querySource: string
}

/** Loads the parser and CAVE grammar WASM, then creates a browser highlighter. */
export const createBrowserHighlighter = async ({
  parserWasmUrl,
  languageWasmUrl,
  querySource,
}: BrowserHighlighterOptions): Promise<Highlighter> => {
  await Parser.init({ locateFile: () => parserWasmUrl })
  const language = await Language.load(languageWasmUrl)
  return createHighlighter(language, querySource)
}
