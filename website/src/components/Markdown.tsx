import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CaveCode } from './CaveCode.tsx'

const externalHref = (href: string | undefined, source: string): string | undefined => {
  if (href === undefined || href.startsWith('#') || /^(https?:|mailto:)/.test(href)) return href
  return new URL(href, `https://github.com/mirek/cave/blob/main/${source}`).href
}

export const Markdown = ({ children, source }: { children: string, source: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, ...props }: ComponentPropsWithoutRef<'a'>) => {
        const resolved = externalHref(href, source)
        const external = resolved?.startsWith('http') === true
        return <a {...props} href={resolved} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} />
      },
      pre: ({ children: code, ...props }: ComponentPropsWithoutRef<'pre'>) => (
        <div className="code-frame"><pre {...props}>{code}</pre></div>
      ),
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
)
