import { useState } from 'react'
import { CaveCode } from '../components/CaveCode.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card } from '../components/ui/card.tsx'

const example = `PARENT-OF IS verb
PARENT-OF REVERSE CHILD-OF

helena PARENT-OF jan
jan PARENT-OF maria @src:archive @ 95%
maria PARENT-OF anna
anna PARENT-OF me`

const capabilities = [
  {
    number: '01',
    title: 'Represent atomic claims',
    text: 'Each line records one claim. Relations, confidence, provenance, valid time, and uncertainty remain visible in the source text.',
    code: 'server IS NOT compromised @ 90%',
    language: 'cave',
  },
  {
    number: '02',
    title: 'Preserve revision history',
    text: 'The SQLite store is append-only. Current beliefs and earlier states can be reconstructed without replacing the original records.',
    code: 'cave query "?x WORKS-AT ?where" --at 1960',
    language: 'shell',
  },
  {
    number: '03',
    title: 'Query relationships',
    text: 'CAVE-Q supports inverse relations, transitive paths, aliases, confidence filters, and contradiction resolution over the stored graph.',
    code: '?ancestor PARENT-OF+ me',
    language: 'cave-q',
  },
]

export const Home = ({ navigate }: { navigate: (path: string) => void }) => {
  const [copied, setCopied] = useState(false)
  const copyInstall = async () => {
    await navigator.clipboard.writeText('pnpm add @cavelang/cli')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <Badge variant="secondary">CAVE language and runtime</Badge>
          <h1>A plain-text knowledge representation with an append-only SQLite store.</h1>
          <p>
            CAVE records statements as atomic claims, retains revisions, and queries relationships with CAVE-Q.
            The source format remains readable and editable without the runtime.
          </p>
          <div className="hero-actions">
            <Button size="lg" onClick={() => navigate('playground')}>Run the playground</Button>
            <Button size="lg" variant="outline" onClick={() => navigate('docs/overview')}>Read the documentation</Button>
          </div>
          <button className="install-command" onClick={copyInstall} aria-label="Copy install command">
            <span>$</span> pnpm add @cavelang/cli <b>{copied ? 'copied' : 'copy'}</b>
          </button>
        </div>
        <Card className="hero-console" aria-label="CAVE code example">
          <div className="console-bar">
            <span>family.cave</span>
            <small>plain text</small>
          </div>
          <pre><CaveCode code={example} lineNumbers /></pre>
          <div className="query-result">
            <span>QUERY</span>
            <code>?ancestor PARENT-OF+ me</code>
            <div>4 matches</div>
          </div>
        </Card>
      </section>

      <section className="proof-strip" aria-label="Project attributes">
        <span>PLAIN TEXT</span><i />
        <span>SQLITE</span><i />
        <span>APPEND-ONLY</span><i />
        <span>TEMPORAL</span><i />
        <span>CC0</span>
      </section>

      <section className="manifesto">
        <div className="section-label">DATA MODEL</div>
        <div>
          <h2>Claims are stored as primary records.</h2>
          <p>
            Each claim remains available as source text and as a structured SQLite record.
            Derived graph edges and current beliefs can be rebuilt from the append-only history.
          </p>
        </div>
      </section>

      <section className="capabilities">
        {capabilities.map(item => (
          <Card key={item.number} className="capability-card">
            <span>{item.number}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <code>{item.language === 'cave' ? <CaveCode code={item.code} /> : item.code}</code>
          </Card>
        ))}
      </section>

      <section className="loop-section">
        <div className="section-label">RUNTIME</div>
        <div className="loop-copy">
          <h2>Runtime pipeline</h2>
          <p>The runtime parses claims, stores history, resolves current beliefs, executes graph queries, and retains provenance for returned results.</p>
          <Button variant="link" onClick={() => navigate('docs/implementation')}>Read the implementation notes →</Button>
        </div>
        <Card className="loop-diagram" aria-label="Parse, store, resolve, query, audit">
          {['Parse', 'Store', 'Resolve', 'Query', 'Audit'].map((label, index) => (
            <div key={label}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
              {index < 4 && <i>→</i>}
            </div>
          ))}
        </Card>
      </section>

      <Card className="cta">
        <div>
          <Badge variant="outline">SQLite WebAssembly</Badge>
          <h2>Browser playground</h2>
        </div>
        <p>Edit a sample dataset, rebuild the in-memory store, and execute CAVE-Q without sending data to a server.</p>
        <Button size="lg" onClick={() => navigate('playground')}>Open playground</Button>
      </Card>
    </main>
  )
}
