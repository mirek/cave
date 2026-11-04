import type { ReactNode } from 'react'
import type { Span } from '@cavelang/highlight/browser'
import { firstSpanEndingAfter } from './highlight-range.ts'

const captureClass = (capture: string): string =>
  `syntax syntax-${capture.replaceAll('.', '-')}`

/** Source text between start and end with each span wrapped in its syntax class. */
export const renderRange = (
  source: string,
  spans: readonly Span[],
  start = 0,
  end = source.length,
): ReactNode[] => {
  const nodes: ReactNode[] = []
  let at = start
  for (let index = firstSpanEndingAfter(spans, start); index < spans.length; index++) {
    const span = spans[index]!
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
