import { lazy, Suspense, useEffect, useState } from 'react'
import { Logo } from './components/Logo.tsx'
import { ButtonLink } from './components/ui/button.tsx'
import { Home } from './pages/Home.tsx'
import { RouteBoundary } from './components/RouteBoundary.tsx'
import { RouteFocus } from './components/RouteFocus.tsx'
import { caveVersion } from './version.ts'
import { useRoute } from './lib/use-route.ts'
import { revealBelowHeader } from './lib/reveal-focused-block.ts'

const Docs = lazy(() => import('./pages/Docs.tsx').then(module => ({ default: module.Docs })))
const Playground = lazy(() => import('./pages/Playground.tsx').then(module => ({ default: module.Playground })))

export const App = () => {
  const { path, position, documentationFilter, setDocumentationFilter, documentationContents, setDocumentationContents } = useRoute()
  const [route, ...fragmentParts] = path.split('#')
  const fragment = fragmentParts.join('#')

  const [routeFailure, setRouteFailure] = useState({ route, failed: false })
  // Reset with the rendered route, before a cached lazy failure can report again.
  // A hashchange listener can run after componentDidCatch and erase that report.
  if (routeFailure.route !== route) setRouteFailure({ route, failed: false })

  const isDocs = route === 'docs' || route!.startsWith('docs/')
  const isPlayground = route === 'playground'

  useEffect(() => {
    if (routeFailure.route === route && routeFailure.failed) {
      document.title = 'Page could not load — CAVE'
      return
    }
    if (isDocs) return
    document.title = isPlayground ? 'Playground — CAVE' : route === 'home'
      ? 'CAVE — Knowledge, made durable' : 'Page not found — CAVE'
  }, [route, isDocs, isPlayground, routeFailure])

  return (
    <div className="app">
      <button className="skip-content" onClick={() => {
        const target = document.querySelector<HTMLElement>('main h1') ??
          document.querySelector<HTMLElement>('main')
        if (target === null) return
        target.tabIndex = -1
        target.focus({ preventScroll: true })
        revealBelowHeader(target)
      }}>Skip to content</button>
      <header className="site-header">
        <a className="brand-button" href="#/home" aria-label="CAVE home"><Logo /></a>
        <nav aria-label="Primary navigation">
          <ButtonLink variant="ghost" size="sm" className={isDocs ? 'active' : ''} aria-current={isDocs ? 'location' : undefined} href="#/docs/overview">Docs</ButtonLink>
          <ButtonLink variant="ghost" size="sm" className={isPlayground ? 'active' : ''} aria-current={isPlayground ? 'location' : undefined} href="#/playground">Playground</ButtonLink>
          <a className="nav-link" href="./cave-book.pdf">Book</a>
          <a className="nav-link" href="https://github.com/mirek/cave" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
        <ButtonLink className="header-cta" variant="outline" size="sm" href="#/docs/overview">Documentation</ButtonLink>
      </header>
      <RouteBoundary key={isDocs ? 'docs' : route} resetKey={route!} onError={() => setRouteFailure({ route, failed: true })}>
        <Suspense fallback={<main className="route-loading"><i aria-hidden="true" /><span role="status">Loading CAVE…</span></main>}>
          {isDocs ? <Docs includeContents={documentationContents} setIncludeContents={setDocumentationContents} filter={documentationFilter} setFilter={setDocumentationFilter} slug={route!.slice(5) || 'overview'} fragment={fragment} position={position} /> :
            isPlayground ? <Playground /> : route === 'home' ? <Home /> : (
              <main className="markdown docs-article">
                <h1>Page not found</h1>
                <p>This link does not match a page on the CAVE website.</p>
                <p><a href="#/home">Go to CAVE home</a> or <a href="#/docs/overview">open the documentation</a>.</p>
              </main>
            )}
          {!isDocs && <RouteFocus key={route} position={position} />}
        </Suspense>
      </RouteBoundary>
      {!isDocs && !isPlayground && (
        <footer className="site-footer">
          <Logo />
          <p>Compressed Atomic Verb Expressions.<br />Plain-text claims you can query, replay, and cite.</p>
          <div><a href="#/docs/overview">Documentation</a><a href="./cave-book.pdf">Book</a><a href="https://github.com/mirek/cave">GitHub</a><span>v{caveVersion}</span></div>
        </footer>
      )}
    </div>
  )
}
