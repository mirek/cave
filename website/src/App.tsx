import { lazy, Suspense, useEffect, useState } from 'react'
import { Logo } from './components/Logo.tsx'
import { Button } from './components/ui/button.tsx'
import { Home } from './pages/Home.tsx'

const Docs = lazy(() => import('./pages/Docs.tsx').then(module => ({ default: module.Docs })))
const Playground = lazy(() => import('./pages/Playground.tsx').then(module => ({ default: module.Playground })))

const readPath = (): string => window.location.hash.replace(/^#\/?/, '') || 'home'

export const App = () => {
  const [path, setPath] = useState(readPath)

  useEffect(() => {
    const update = () => setPath(readPath())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  const navigate = (next: string) => {
    window.location.hash = `/${next}`
  }
  const isDocs = path.startsWith('docs')
  const isPlayground = path === 'playground'

  return (
    <div className="app">
      <header className="site-header">
        <button className="brand-button" onClick={() => navigate('home')} aria-label="CAVE home"><Logo /></button>
        <nav aria-label="Primary navigation">
          <Button variant="ghost" size="sm" className={isDocs ? 'active' : ''} onClick={() => navigate('docs/overview')}>Docs</Button>
          <Button variant="ghost" size="sm" className={isPlayground ? 'active' : ''} onClick={() => navigate('playground')}>Playground</Button>
          <a className="nav-link" href="https://github.com/mirek/cave" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
        <Button className="header-cta" variant="outline" size="sm" onClick={() => navigate('docs/overview')}>Documentation</Button>
      </header>
      <Suspense fallback={<main className="route-loading"><i /> Loading CAVE…</main>}>
        {isDocs ? <Docs slug={path.split('/')[1] ?? 'overview'} navigate={navigate} /> :
          isPlayground ? <Playground /> : <Home navigate={navigate} />}
      </Suspense>
      {!isDocs && !isPlayground && (
        <footer className="site-footer">
          <Logo />
          <p>Compressed Atomic Verb Expressions.<br />Plain-text claims backed by SQLite.</p>
          <div><button onClick={() => navigate('docs/overview')}>Documentation</button><a href="https://github.com/mirek/cave">GitHub</a><span>v0.24.2</span></div>
        </footer>
      )}
    </div>
  )
}
