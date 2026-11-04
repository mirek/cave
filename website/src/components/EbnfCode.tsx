import { useMemo } from 'react'
import { ebnfSpans } from '../lib/ebnf-highlight.ts'
import { renderRange } from '../lib/render-spans.tsx'

/** EBNF listing (spec §16) highlighted synchronously; no WASM grammar needed. */
export const EbnfCode = ({ code }: { code: string }) => {
  const spans = useMemo(() => ebnfSpans(code), [code])
  return <>{renderRange(code, spans)}</>
}
