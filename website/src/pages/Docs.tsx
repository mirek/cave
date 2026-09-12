import { useEffect, useMemo, useState } from 'react'
import { docBySlug, docs } from '../content.ts'
import { Markdown } from '../components/Markdown.tsx'
import { Input } from '../components/ui/input.tsx'
import { caveVersion } from '../version.ts'
import type { ReadingPosition } from '../lib/use-route.ts'
import { docEditHref, scrollToDocFragment } from '../lib/doc-links.ts'
import { revealBelowHeader } from '../lib/reveal-focused-block.ts'

const groups = ['Learn', 'Reference', 'Integrations', 'Project'] as const

const searchable = (text: string): string =>
  text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')

export const Docs = ({ slug, fragment, position, filter, setFilter, includeContents, setIncludeContents }: { includeContents: boolean, setIncludeContents: (value: boolean) => void, slug: string, fragment: string, position?: ReadingPosition, filter: string, setFilter: (value: string) => void }) => {
  const [contents, setContents] = useState<{ slug: string | undefined, titleId: string | undefined, entries: readonly { id: string, label: string }[] }>({ slug: undefined, titleId: undefined, entries: [] })
  const normalizedFilter = searchable(filter).trim()
  let selectedSection: string | undefined
  try { selectedSection = decodeURIComponent(fragment) } catch { /* Malformed fragments select no section. */ }
  const doc = docBySlug(slug)
  const sections = contents.slug === doc?.slug ? contents.entries : []
  useEffect(() => {
    setContents({ slug: doc?.slug, titleId: document.querySelector<HTMLElement>('.docs-article h1[id]')?.id, entries: Array.from(document.querySelectorAll<HTMLElement>('.docs-article h2[id]'))
      .map(heading => ({ id: heading.id, label: heading.textContent ?? '' })) })
  }, [doc])
  useEffect(() => {
    document.title = `${doc?.label ?? 'Document not found'} — CAVE Docs`
  }, [doc])
  const searchIndex = useMemo(() => docs.map(item => ({
    item,
    text: searchable(`${item.label} ${item.slug} ${item.group}${includeContents ? ` ${item.markdown}` : ''}`)
  })), [includeContents])
  const visible = useMemo(() => {
    const words = normalizedFilter.split(/\s+/).filter(Boolean)
    return words.length === 0 ? docs : searchIndex
      .filter(({ text }) => words.every(word => text.includes(word)))
      .map(({ item }) => item)
  }, [normalizedFilter, searchIndex])

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.docs-sidebar nav')
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav === null || nav === undefined || active === null || active === undefined || nav.scrollWidth <= nav.clientWidth) return
    const bounds = nav.getBoundingClientRect()
    const link = active.getBoundingClientRect()
    if (link.left < bounds.left) nav.scrollLeft += link.left - bounds.left
    else if (link.right > bounds.right) nav.scrollLeft += link.right - bounds.right
  }, [visible])

  useEffect(() => {
    document.querySelector<HTMLElement>('.docs-sidebar [aria-current="page"]')
      ?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
    window.scrollTo({ top: 0, behavior: 'instant' })
    if (fragment !== '') scrollToDocFragment(fragment)
    else {
      const heading = document.querySelector<HTMLElement>('.docs-article h1')
      if (heading !== null) {
        heading.tabIndex = -1
        heading.focus({ preventScroll: true })
      }
    }
    if (position !== undefined) {
      const disclosure = document.querySelector<HTMLDetailsElement>('.docs-contents')
      if (disclosure !== null) disclosure.open = position.contentsOpen ?? false
      window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' })
    }
  }, [slug, fragment, position, contents])

  const sectionNavigation = doc !== undefined && sections.length > 0 && (
    <details className="docs-contents" key={doc.slug}>
      <summary>On this page</summary>
      <nav aria-label="On this page">
        <ul>{sections.map(section => {
          const target = section.id.replace(/^cave-doc-/, '')
          const href = `#/docs/${doc.slug}#${encodeURIComponent(target)}`
          return <li key={section.id}><a href={href} aria-current={selectedSection === target || selectedSection === section.id ? 'location' : undefined} onClick={event => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && window.location.hash === href) {
              event.preventDefault()
              scrollToDocFragment(encodeURIComponent(target))
            }
          }}>{section.label}</a></li>
        })}</ul>
      </nav>
    </details>
  )

  return (
    <main className="docs-shell">
      <aside className="docs-sidebar">
        <div className="docs-version"><span>Documentation</span><strong>v{caveVersion}</strong></div>
        <div role="search" aria-label="Documentation">
          <label className="docs-search">
            <span aria-hidden="true">⌕</span>
            <Input id="documentation-filter" aria-describedby="documentation-filter-status documentation-filter-help" aria-label="Filter documentation" aria-keyshortcuts={visible.length === 1 ? 'Escape Enter ArrowDown' : visible.length > 0 ? 'Escape ArrowDown' : 'Escape'} value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter documentation" onKeyDown={event => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing &&
                  !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && filter !== '') {
                event.preventDefault()
                setFilter('')
              }
              if (event.key === 'Enter' && !event.nativeEvent.isComposing &&
                  !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && visible.length === 1) {
                event.preventDefault()
                document.querySelector<HTMLAnchorElement>('.docs-sidebar nav a')?.click()
              }
              if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing &&
                  !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && visible.length > 0) {
                event.preventDefault()
                const first = document.querySelector<HTMLAnchorElement>('.docs-sidebar nav a')
                if (first !== null) {
                  first.focus({ preventScroll: true })
                  const reveal = () => {
                    // Cancel browser-keyboard scrolling even when the link is already visible.
                    window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' })
                    revealBelowHeader(first)
                  }
                  reveal()
                  requestAnimationFrame(() => {
                    if (first.isConnected && document.activeElement === first) reveal()
                  })
                }
              }
            }} />
          </label>
          <label className="docs-filter-scope">
            <input id="documentation-contents" type="checkbox" checked={includeContents} onChange={event => setIncludeContents(event.target.checked)} />
            Include page contents
          </label>
          <p id="documentation-filter-help" className="docs-filter-status">{includeContents ? 'Filter by page name, group or contents.' : 'Filter by page name or group.'} All words must match one page. Down Arrow browses matches. Escape clears the filter.</p>
          <p id="documentation-filter-status" className="docs-filter-status" role="status">
            {filter.trim() === '' ? `Showing all ${docs.length} documentation pages.` : normalizedFilter === '' ? 'Showing all documentation pages. Enter letters or numbers to filter.' : visible.length === 0 ? 'No matching documentation pages.' : visible.length === 1 ? '1 matching documentation page. Press Enter to open.' : `${visible.length} matching documentation pages.`}
          </p>
          {!includeContents && normalizedFilter !== '' && visible.length === 0 && (
            <div>
              <button className="docs-filter-clear" onClick={() => {
                setIncludeContents(true)
                document.getElementById('documentation-filter')?.focus()
              }}>Search page contents</button>
            </div>
          )}
          {filter !== '' && (
            <button className="docs-filter-clear" aria-label="Clear documentation filter" onClick={() => {
              setFilter('')
              document.getElementById('documentation-filter')?.focus()
            }}>Clear filter</button>
          )}
        </div>
        <nav aria-label="Documentation">
          {groups.map(group => {
            const entries = visible.filter(item => item.group === group)
            return entries.length === 0 ? null : (
              <section key={group}>
                <h2>{group}</h2>
                {entries.map(item => (
                  <a
                    key={item.slug}
                    className={item.slug === doc?.slug ? 'active' : ''}
                    aria-current={item.slug === doc?.slug ? 'page' : undefined}
                    href={`#/docs/${item.slug}`}
                    onClick={event => {
                      // Overview aliases can change the hash without changing the document.
                      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
                          item.slug === slug && fragment === '') {
                        if (window.location.hash === `#/docs/${item.slug}`) event.preventDefault()
                        scrollToDocFragment('')
                      }
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </section>
            )
          })}
        </nav>
      </aside>
      <article className="markdown docs-article">
        {doc === undefined ? (
          <>
            <div className="docs-eyebrow">CAVE / Documentation</div>
            <h1>Document not found</h1>
            <p>This documentation link does not match a published page.</p>
            <p><a href="#/docs/overview">Open documentation overview</a>, or choose a page from the documentation navigation.</p>
          </>
        ) : (
          <>
            <div className="docs-eyebrow">CAVE / {doc.group}</div>
            <Markdown source={doc.source} afterHeading={contents.slug === doc.slug && contents.titleId !== undefined
              ? { id: contents.titleId, content: <>{sectionNavigation}
                <button className="docs-filter-clear docs-filter-return" onClick={() => {
                  const target = document.getElementById('documentation-filter')
                  if (target === null) return
                  target.focus({ preventScroll: true })
                  target.closest('.docs-sidebar')?.scrollTo({ top: 0, behavior: 'instant' })
                  window.scrollTo({ top: 0, behavior: 'instant' })
                }}>Find another page</button>
              </> } : undefined}>{doc.markdown}</Markdown>
            <footer className="docs-footer">
              <span>CAVE v{caveVersion} documentation</span>
              <a href={docEditHref(doc.source)} target="_blank" rel="noreferrer">Edit on GitHub ↗</a>
            </footer>
          </>
        )}
      </article>
    </main>
  )
}
