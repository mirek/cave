import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { revealFocusedBlock } from '../lib/reveal-focused-block.ts'

/** Give overflowing examples a named keyboard target without extra stops when they fit. */
export const ScrollableCode = ({ children, node: _node, ...props }:
  ComponentPropsWithoutRef<'pre'> & { node?: unknown }) => {
  const ref = useRef<HTMLPreElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const pre = ref.current
    if (pre === null) return
    const measure = () => setOverflow(pre.scrollWidth > pre.clientWidth)
    const observer = new ResizeObserver(measure)
    measure()
    observer.observe(pre)
    // The code's intrinsic width can change after fonts or highlighting load.
    for (const code of pre.children) observer.observe(code)
    return () => observer.disconnect()
  }, [children])
  return <div className="code-frame"><pre {...props} ref={ref}
    onFocus={event => { props.onFocus?.(event); revealFocusedBlock(event) }}
    tabIndex={overflow ? 0 : undefined} role={overflow ? 'region' : undefined}
    aria-label={overflow ? 'Scrollable code example' : undefined}>{children}</pre></div>
}
