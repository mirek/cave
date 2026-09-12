import { useEffect } from 'react'
import type { ReadingPosition } from '../lib/use-route.ts'

/** Mount inside Suspense so focus waits for the destination's content. */
export const RouteFocus = ({ position }: { position?: ReadingPosition }) => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    const heading = document.querySelector<HTMLElement>('main h1')
    if (heading !== null) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
    if (position !== undefined) window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' })
  }, [position])
  return null
}
