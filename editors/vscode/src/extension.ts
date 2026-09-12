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

/** Release owned resources without replacing a primary failure. */
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

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  await Parser.init({
    locateFile: () => context.asAbsolutePath('dist/web-tree-sitter.wasm')
  })
  const language = await Language.load(context.asAbsolutePath('dist/tree-sitter-cave.wasm'))
  const query = new Query(language, readFileSync(context.asAbsolutePath('dist/highlights.scm'), 'utf8'))
  let parser: Parser | undefined
  let registration: vscode.Disposable | undefined
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    for (const release of [() => registration?.dispose(), () => parser?.delete(), () => query.delete()]) {
      try { release() } catch (error) { errors.push(error) }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'CAVE extension cleanup failed', { cause: errors[0] })
    }
  }

  try {
    parser = new Parser()
    parser.setLanguage(language)

    const provider: vscode.DocumentSemanticTokensProvider = {
      provideDocumentSemanticTokens(document, token) {
        if (disposed || token?.isCancellationRequested) return new vscode.SemanticTokens(new Uint32Array())
        const tree = parser!.parse(document.getText())
        if (tree === null) {
          return new vscode.SemanticTokens(new Uint32Array())
        }
        return withCleanup(() => {
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
        }, () => tree.delete(), 'CAVE token generation failed and tree cleanup also failed')
      }
    }

    registration = vscode.languages.registerDocumentSemanticTokensProvider({ language: 'cave' }, provider, legend)
    context.subscriptions.push({ dispose })
  } catch (error) {
    withCleanup(() => { throw error }, dispose, 'CAVE extension activation failed and cleanup also failed')
  }
}

export const deactivate = (): void => {}
