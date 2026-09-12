import { useEffect, useRef, useState } from 'react'
import { revealFocusedBlock } from '../lib/reveal-focused-block.ts'
import type { ComponentPropsWithoutRef } from 'react'

/** Keep wide reference tables readable and keyboard-scrollable. */
export const ScrollableTable = ({ children, node: _node, ...props }:
  ComponentPropsWithoutRef<'table'> & { node?: unknown }) => {
  const ref = useRef<HTMLTableElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const table = ref.current
    if (table === null) return
    const measure = () => setOverflow(table.scrollWidth > table.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    // Intrinsic column widths may change while the outer table width stays fixed.
    for (const section of table.children) observer.observe(section)
    return () => observer.disconnect()
  }, [children])
  return <table {...props} ref={ref} tabIndex={overflow ? 0 : undefined}
    onFocus={event => {
      props.onFocus?.(event)
      revealFocusedBlock(event)
    }}
    aria-label={overflow ? 'Scrollable documentation table' : undefined}>{children}</table>
}
