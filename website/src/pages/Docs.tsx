import { useEffect, useMemo, useState } from 'react'
import { docBySlug, docs } from '../content.ts'
import { Markdown } from '../components/Markdown.tsx'
import { Input } from '../components/ui/input.tsx'
import { caveVersion } from '../version.ts'

const groups = ['Learn', 'Reference', 'Integrations', 'Project'] as const

export const Docs = ({ slug, navigate }: { slug: string, navigate: (path: string) => void }) => {
  const [filter, setFilter] = useState('')
  const doc = docBySlug(slug)
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle.length === 0 ? docs : docs.filter(item => item.label.toLowerCase().includes(needle))
  }, [filter])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [doc.slug])

  return (
    <main className="docs-shell">
      <aside className="docs-sidebar">
        <div className="docs-version"><span>Documentation</span><strong>v{caveVersion}</strong></div>
        <label className="docs-search">
          <span aria-hidden="true">⌕</span>
          <Input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter documentation" />
        </label>
        <nav aria-label="Documentation">
          {groups.map(group => {
            const entries = visible.filter(item => item.group === group)
            return entries.length === 0 ? null : (
              <section key={group}>
                <h2>{group}</h2>
                {entries.map(item => (
                  <button
                    key={item.slug}
                    className={item.slug === doc.slug ? 'active' : ''}
                    onClick={() => navigate(`docs/${item.slug}`)}
                  >
                    {item.label}
                  </button>
                ))}
              </section>
            )
          })}
        </nav>
      </aside>
      <article className="markdown docs-article">
        <div className="docs-eyebrow">CAVE / {doc.group}</div>
        <Markdown source={doc.source}>{doc.markdown}</Markdown>
        <footer className="docs-footer">
          <span>CAVE v{caveVersion} documentation</span>
          <a href={`https://github.com/mirek/cave/edit/main/${doc.source}`} target="_blank" rel="noreferrer">Edit on GitHub ↗</a>
        </footer>
      </article>
    </main>
  )
}
