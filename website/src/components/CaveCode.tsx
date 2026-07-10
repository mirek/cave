import { useEffect, useState, type ReactNode } from 'react'
import { createBrowserHighlighter, type Highlighter, type Span } from '@cavelang/highlight/browser'
import caveLanguageWasmUrl from '@cavelang/tree-sitter-cave/wasm?url'
import caveQuerySource from '@cavelang/tree-sitter-cave/highlights?raw'
import treeSitterWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'

let highlighterPromise: Promise<Highlighter> | undefined

const loadHighlighter = (): Promise<Highlighter> =>
  highlighterPromise ??= createBrowserHighlighter({
    parserWasmUrl: treeSitterWasmUrl,
    languageWasmUrl: caveLanguageWasmUrl,
    querySource: caveQuerySource,
  })

const captureClass = (capture: string): string =>
  `syntax syntax-${capture.replaceAll('.', '-')}`

const renderRange = (
  source: string,
  spans: readonly Span[],
  start = 0,
  end = source.length,
): ReactNode[] => {
  const nodes: ReactNode[] = []
  let at = start
  for (const span of spans) {
    if (span.end <= start) continue
    if (span.start >= end) break
    const spanStart = Math.max(span.start, start)
    const spanEnd = Math.min(span.end, end)
    if (spanStart > at) nodes.push(source.slice(at, spanStart))
    nodes.push(<span className={captureClass(span.capture)} key={`${spanStart}-${spanEnd}-${span.capture}`}>{source.slice(spanStart, spanEnd)}</span>)
    at = spanEnd
  }
  if (at < end) nodes.push(source.slice(at, end))
  return nodes
}

const useCaveSpans = (source: string): readonly Span[] => {
  const [highlight, setHighlight] = useState<{ source: string, spans: readonly Span[] }>({ source, spans: [] })

  useEffect(() => {
    let current = true
    void loadHighlighter()
      .then(highlighter => {
        if (current) setHighlight({ source, spans: highlighter.spans(source) })
      })
      // Highlighting is progressive enhancement: plain source remains visible
      // if a browser cannot initialize WebAssembly.
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
        <i>{String(index + 1).padStart(2, '0')}</i>
        {renderRange(code, spans, start, end)}
        {line.length === 0 ? ' ' : null}
      </span>
    )
  })}</>
}
