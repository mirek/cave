import { createContext, useContext, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import { CaveCode } from './CaveCode.tsx'
import { ScrollableTable } from './ScrollableTable.tsx'
import { ScrollableCode } from './ScrollableCode.tsx'
import { docs } from '../content.ts'
import { docHref, scrollToDocFragment } from '../lib/doc-links.ts'

type HeadingContent = { readonly id: string, readonly content: ReactNode }
const headingContent = createContext<HeadingContent | undefined>(undefined)
const Heading = ({ node: _node, ...props }: ComponentPropsWithoutRef<'h1'> & { node?: unknown }) => {
  const extra = useContext(headingContent)
  return <><h1 {...props} />{extra?.id === props.id ? extra?.content : null}</>
}

export const Markdown = ({ children, source, afterHeading }: { children: string, source: string, afterHeading?: HeadingContent }) => (
  <headingContent.Provider value={afterHeading}>
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[[rehypeSlug, { prefix: 'cave-doc-' }]]}
    components={{
      h1: Heading,
      table: ScrollableTable,
      a: ({ href, ...props }: ComponentPropsWithoutRef<'a'>) => {
        const resolved = docHref(href, source, docs)
        const external = resolved?.startsWith('http') === true || resolved?.startsWith('//') === true
        return <a {...props} href={resolved} onClick={event => {
          // Clicking the current section again does not emit hashchange.
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && resolved === window.location.hash) {
            event.preventDefault()
            scrollToDocFragment(resolved.split('#').slice(2).join('#'))
          }
        }} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} />
      },
      pre: ScrollableCode,
      code: ({ className, children: code, ...props }: ComponentPropsWithoutRef<'code'>) => {
        const sourceCode = String(code).replace(/\n$/u, '')
        return (
          <code {...props} className={className}>
            {className?.split(' ').includes('language-cave') === true
              ? <CaveCode code={sourceCode} />
              : code}
          </code>
        )
      },
    }}
  >
    {children}
  </ReactMarkdown>
  </headingContent.Provider>
)
