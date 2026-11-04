import { useEffect, useState } from 'react'
import { createBrowserHighlighter, type Highlighter, type Span } from '@cavelang/highlight/browser'
import caveLanguageWasmUrl from '@cavelang/tree-sitter-cave/wasm?url'
import caveQuerySource from '@cavelang/tree-sitter-cave/highlights?raw'
import treeSitterWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import { renderRange } from '../lib/render-spans.tsx'

let highlighterPromise: Promise<Highlighter> | undefined

const loadHighlighter = (): Promise<Highlighter> =>
  highlighterPromise ??= createBrowserHighlighter({
    parserWasmUrl: treeSitterWasmUrl,
    languageWasmUrl: caveLanguageWasmUrl,
    querySource: caveQuerySource,
  }).catch(error => {
    highlighterPromise = undefined
    throw error
  })

const useCaveSpans = (source: string): readonly Span[] => {
  const [highlight, setHighlight] = useState<{ source: string, spans: readonly Span[] }>({ source, spans: [] })

  useEffect(() => {
    let current = true
    void loadHighlighter()
      .then(highlighter => {
        if (current) setHighlight({ source, spans: highlighter.spans(source) })
      })
      // Highlighting is progressive enhancement: plain source remains visible
      // if loading fails. A later mount or source change can retry the load.
      .catch(() => undefined)
    return () => { current = false }
  }, [source])

  return highlight.source === source ? highlight.spans : []
}

export const CaveCode = ({ code, lineNumbers = false }: { code: string, lineNumbers?: boolean }) => {
  const spans = useCaveSpans(code)
  if (!lineNumbers) return <>{renderRange(code, spans)}</>

  let offset = 0
  return <>{code.split('\n').map((line, index) => {
    const start = offset
    const end = start + line.length
    offset = end + 1
    return (
      <span className="code-line" key={index}>
        <i aria-hidden="true">{String(index + 1).padStart(2, '0')}</i>
        {renderRange(code, spans, start, end)}
        {line.length === 0 ? ' ' : null}
      </span>
    )
  })}</>
}
