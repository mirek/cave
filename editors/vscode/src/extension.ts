/**
 * CAVE language support for VSCode.
 *
 * Highlighting is a semantic-tokens provider over the same
 * `@cavelang/tree-sitter-cave` WASM grammar and `highlights.scm` query that
 * power terminal output (`@cavelang/highlight`) — one grammar, every surface.
 * There is deliberately no TextMate grammar to drift out of sync; tokens
 * appear as soon as the extension activates on the first `.cave` file.
 *
 * The grammar WASM, web-tree-sitter runtime WASM and the highlight query are
 * copied into `dist/` by `build.mjs` and loaded from the extension root.
 */

import { readFileSync } from 'node:fs'
import * as vscode from 'vscode'
import { Language, Parser, Query } from 'web-tree-sitter'

/**
 * highlights.scm capture names (or dotted prefixes) to VSCode standard
 * semantic token types — chosen so common themes color every kind out of
 * the box (`regexp` for code literals, `macro` for contexts, `enumMember`
 * for confidence/sigma/tag values, `decorator` for tag keys).
 */
const CAPTURE_TO_TYPE: Readonly<Record<string, string>> = {
  comment: 'comment',
  keyword: 'keyword',
  variable: 'variable',
  property: 'property',
  number: 'number',
  type: 'type',
  string: 'string',
  'string.special': 'regexp',
  label: 'macro',
  constant: 'enumMember',
  operator: 'operator',
  tag: 'decorator',
  punctuation: 'operator'
}

const legend = new vscode.SemanticTokensLegend([...new Set(Object.values(CAPTURE_TO_TYPE))])

/** Longest dotted prefix of `capture` present in the map. */
const typeOf = (capture: string): undefined | string => {
  for (let name = capture; ; name = name.slice(0, name.lastIndexOf('.'))) {
    const type = CAPTURE_TO_TYPE[name]
    if (type !== undefined) {
      return type
    }
    if (!name.includes('.')) {
      return undefined
    }
  }
}

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  await Parser.init({
    locateFile: () => context.asAbsolutePath('dist/web-tree-sitter.wasm')
  })
  const language = await Language.load(context.asAbsolutePath('dist/tree-sitter-cave.wasm'))
  const query = new Query(language, readFileSync(context.asAbsolutePath('dist/highlights.scm'), 'utf8'))
  const parser = new Parser()
  parser.setLanguage(language)

  const provider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens(document) {
      const tree = parser.parse(document.getText())
      if (tree === null) {
        return new vscode.SemanticTokens(new Uint32Array())
      }
      try {
        const builder = new vscode.SemanticTokensBuilder(legend)
        for (const { name, node } of query.captures(tree.rootNode)) {
          const type = typeOf(name)
          // Semantic tokens are single-line; every CAVE capture is, by grammar.
          if (type === undefined || node.startPosition.row !== node.endPosition.row) {
            continue
          }
          builder.push(
            new vscode.Range(
              node.startPosition.row, node.startPosition.column,
              node.endPosition.row, node.endPosition.column
            ),
            type
          )
        }
        return builder.build()
      } finally {
        tree.delete()
      }
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider({ language: 'cave' }, provider, legend)
  )
}

export const deactivate = (): void => {}
