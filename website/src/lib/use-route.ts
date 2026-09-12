import { useEffect, useRef, useState } from 'react'

export type ReadingPosition = { left: number, top: number, contentsOpen?: boolean, documentationFilter?: string, documentationContents?: boolean }
const path = (): string => window.location.hash.replace(/^#\/?/, '') || 'home'
const entryKey = '__cave_history_entry'
// These identify local history entries, not security tokens or CAVE records.
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
let nextEntry = 0

const readingPosition = (): ReadingPosition => ({
  left: window.scrollX,
  top: window.scrollY,
  contentsOpen: document.querySelector<HTMLDetailsElement>('.docs-contents')?.open,
  documentationFilter: document.querySelector<HTMLInputElement>('#documentation-filter')?.value,
  documentationContents: document.querySelector<HTMLInputElement>('#documentation-contents')?.checked,
})

/** Keep reading positions per history entry, including repeated visits to a route. */
export const useRoute = () => {
  const [documentationFilter, setDocumentationFilter] = useState('')
  const [documentationContents, setDocumentationContents] = useState(false)
  const [route, setRoute] = useState<{ path: string, position?: ReadingPosition }>(() => ({ path: path() }))
  const positions = useRef(new Map<string, ReadingPosition>())
  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    const entry = (previous?: { id: string, hash: string }): string => {
      const state = window.history.state
      const existing = state?.[entryKey]
      if (typeof existing === 'string' && !(existing === previous?.id && window.location.hash !== previous.hash)) return existing
      const id = `${session}:${++nextEntry}`
      window.history.replaceState({ ...state, [entryKey]: id }, '')
      return id
    }
    let current = { id: entry(), hash: window.location.hash }
    const remember = () => {
      // A hash change can trigger scrolling before the route has rendered.
      if (window.location.hash === current.hash) {
        positions.current.set(current.id, readingPosition())
      }
    }
    const update = () => {
      const id = entry(current)
      if (id === current.id && window.location.hash === current.hash) return
      // popstate precedes hashchange and keeps the outgoing scroll available,
      // even when its last scroll event is queued or the new URL is identical.
      positions.current.set(current.id, readingPosition())
      const position = positions.current.get(id)
      current = { id, hash: window.location.hash }
      if (position?.documentationFilter !== undefined) setDocumentationFilter(position.documentationFilter)
      if (position?.documentationContents !== undefined) setDocumentationContents(position.documentationContents)
      setRoute({ path: path(), position })
    }
    remember()
    window.addEventListener('scroll', remember, { passive: true })
    document.addEventListener('click', remember, true)
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    return () => {
      window.history.scrollRestoration = previousRestoration
      window.removeEventListener('scroll', remember)
      document.removeEventListener('click', remember, true)
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
    }
  }, [])
  return { ...route, documentationFilter, setDocumentationFilter, documentationContents, setDocumentationContents }
}
