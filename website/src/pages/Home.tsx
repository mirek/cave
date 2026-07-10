import { useState } from 'react'

const example = `PARENT-OF IS verb
PARENT-OF REVERSE CHILD-OF

helena PARENT-OF jan
jan PARENT-OF maria @src:archive @ 95%
maria PARENT-OF anna
anna PARENT-OF me`

const capabilities = [
  {
    number: '01',
    title: 'Write what you know',
    text: 'One atomic claim per line. Confidence, provenance, time, uncertainty, and relationships remain readable plain text.',
    code: 'server IS NOT compromised @ 90%',
  },
  {
    number: '02',
    title: 'Keep every belief',
    text: 'Append-only SQLite preserves how knowledge changes. Reconstruct what was believed at any transaction or valid-time boundary.',
    code: 'cave query "?x WORKS-AT ?where" --at 1960',
  },
  {
    number: '03',
    title: 'Ask the graph',
    text: 'CAVE-Q handles inverse relations, transitive paths, aliases, uncertainty filters, and contradiction resolution.',
    code: '?ancestor PARENT-OF+ me',
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
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <div className="kicker"><i /> Knowledge infrastructure, without the infrastructure</div>
          <h1>Knowledge,<br /><em>made durable.</em></h1>
          <p>
            A compact language and local-first engine for knowledge that stays human-readable,
            accumulates safely, and answers real questions.
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => navigate('playground')}>Open playground <span>↗</span></button>
            <button className="button secondary" onClick={() => navigate('docs/overview')}>Read the docs <span>→</span></button>
          </div>
          <button className="install-command" onClick={copyInstall} aria-label="Copy install command">
            <span>$</span> pnpm add @cavelang/cli <b>{copied ? 'copied' : 'copy'}</b>
          </button>
        </div>
        <div className="hero-console" aria-label="CAVE code example">
          <div className="console-bar">
            <div><i /><i /><i /></div>
            <span>family.cave</span>
            <small>plain text</small>
          </div>
          <pre>{example.split('\n').map((line, index) => (
            <span className="code-line" key={`${line}-${index}`}><i>{String(index + 1).padStart(2, '0')}</i>{line || ' '}</span>
          ))}</pre>
          <div className="query-result">
            <span>QUERY</span>
            <code>?ancestor PARENT-OF+ me</code>
            <div><i /> 4 paths resolved in <b>0.8 ms</b></div>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Project attributes">
        <span>PLAIN TEXT</span><i />
        <span>SQLITE NATIVE</span><i />
        <span>LOCAL FIRST</span><i />
        <span>LLM READY</span><i />
        <span>CC0</span>
      </section>

      <section className="manifesto">
        <div className="section-label">THE PREMISE</div>
        <div>
          <h2>Your knowledge should<br />outlive its <em>tools.</em></h2>
          <p>
            CAVE stores facts as small, composable claims—not opaque embeddings or a platform-specific graph.
            The source is text. The database is one file. The history is never overwritten.
          </p>
        </div>
      </section>

      <section className="capabilities">
        {capabilities.map(item => (
          <article key={item.number}>
            <span>{item.number}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <code>{item.code}</code>
          </article>
        ))}
      </section>

      <section className="loop-section">
        <div className="section-label">ONE COMPLETE LOOP</div>
        <div className="loop-copy">
          <h2>From signal to<br /><em>accountable action.</em></h2>
          <p>Ingest sources, model beliefs, derive conclusions, execute governed actions, and preserve why each result exists.</p>
          <button className="text-link" onClick={() => navigate('docs/implementation')}>Explore the architecture <span>→</span></button>
        </div>
        <div className="loop-diagram" aria-label="Sense, model, conclude, act, trust">
          {['Sense', 'Model', 'Conclude', 'Act', 'Trust'].map((label, index) => (
            <div key={label} className={index === 1 ? 'active' : ''}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
              {index < 4 && <i>→</i>}
            </div>
          ))}
        </div>
      </section>

      <section className="cta">
        <div>
          <span>RUNS ENTIRELY IN YOUR BROWSER</span>
          <h2>Enter the cave.</h2>
        </div>
        <p>Load a dataset, append claims, and run CAVE-Q against a real SQLite database compiled to WebAssembly.</p>
        <button className="button primary dark" onClick={() => navigate('playground')}>Try it now <span>↗</span></button>
      </section>
    </main>
  )
}
