import { revealBelowHeader } from './reveal-focused-block.ts'

type DocumentReference = { readonly slug: string, readonly source: string }

const encodeRepositoryPath = (source: string): string =>
  source.split('/').map(encodeURIComponent).join('/')

export const docEditHref = (source: string): string =>
  `https://github.com/mirek/cave/edit/main/${encodeRepositoryPath(source)}`

/** Resolve repository-relative documentation links without leaving the site. */
export const docHref = (href: string | undefined, source: string, docs: readonly DocumentReference[]): string | undefined => {
  if (href === undefined || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#/')) return href
  const encodedSource = encodeRepositoryPath(source)
  const target = new URL(href, `https://repository.invalid/${encodedSource}`)
  let path = target.pathname.slice(1).replace(/\/$/, '')
  const encodedSeparator = /%2f/i.test(path)
  try { path = decodeURIComponent(path) } catch { /* Keep malformed escapes literal. */ }
  const readme = path === '' ? 'README.md' : `${path}/README.md`
  const doc = encodedSeparator ? undefined : docs.find(item => item.source === path || item.source === readme)
  if (doc !== undefined && target.search === '') return `#/docs/${doc.slug}${target.hash}`
  return `https://github.com/mirek/cave/blob/main${target.pathname}${target.search}${target.hash}`
}

export const scrollToDocFragment = (fragment: string): void => {
  const article = document.querySelector<HTMLElement>('.docs-article')
  if (article === null) return
  let id: string | undefined
  try { id = decodeURIComponent(fragment) } catch { /* Fall back to the document heading. */ }
  const candidates = id === undefined ? [] : [document.getElementById(`cave-doc-${id}`), document.getElementById(id)]
  const target = candidates.find(candidate => candidate !== null && article.contains(candidate))
    ?? article.querySelector<HTMLElement>('h1')
  if (target === null) return
  revealBelowHeader(target)
  target.tabIndex = -1
  target.focus({ preventScroll: true })
}
