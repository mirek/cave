import { useState } from 'react'
import { CaveCode } from '../components/CaveCode.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card } from '../components/ui/card.tsx'

const example = `; a small monorepo: which package uses which
web USES ui
web USES api-client
ui USES core
api-client USES core
docs USES ui

core HAS version: 1.4.0
core HAS maintainer: bob @src:standup @ 60%`

const steps = [
  {
    number: '01',
    title: 'Write a claim',
    text: 'Three tokens: subject, UPPERCASE verb, object. Names are lowercase; a source, a confidence, or a comment is optional.',
    code: 'web USES ui',
    language: 'cave',
  },
  {
    number: '02',
    title: 'Ask across the graph',
    text: 'Read a relation backwards, or follow it for as many hops as it takes — over the same stored rows, no second copy.',
    code: "cave query '?p USES+ core'",
    language: 'shell',
  },
  {
    number: '03',
    title: 'Say how sure, and why',
    text: 'Sources and confidence are part of the claim. Contradictions coexist; a belief changes by appending, so the history stays.',
    code: 'core HAS maintainer: bob @src:standup @ 60%',
    language: 'cave',
  },
  {
    number: '04',
    title: 'Derive what nobody wrote',
    text: 'A rule is premises => conclusion. Derived claims carry their confidence and point back at the premises they rest on.',
    code: '?adv AFFECTS ?dep, ?pkg USES+ ?dep => ?pkg EXPOSED-TO ?adv',
    language: 'rule',
  },
  {
    number: '05',
    title: 'Let machines write it',
    text: 'CSV and JSON map through a template, deterministically. An LLM reads your documents and records claims with line-level sources.',
    code: "cave ingest 'news/*.md' --agent 'claude -p'",
    language: 'shell',
  },
  {
    number: '06',
    title: 'React and report',
    text: 'Automations fire on new claims, actions gate the writes, and a report cites the exact claim behind every sentence.',
    code: 'cave automate --once && cave report brief.md',
    language: 'shell',
  },
]

export const Home = ({ navigate }: { navigate: (path: string) => void }) => {
  const [copied, setCopied] = useState(false)
  const installCommand = 'pnpm i -g @cavelang/cli\ncopilot mcp add cave -- cave mcp --db "$HOME/cave.db"'
  const copyInstall = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <Badge variant="secondary">Start with one line</Badge>
          <h1>Write down what you know, one claim per line. Ask questions across all of it.</h1>
          <p>
            CAVE is a plain-text language for claims and a tool that keeps them in one local store, never overwrites them,
            and answers questions over the whole graph — chains, inverses, confidence, history, and why.
          </p>
          <div className="hero-actions">
            <Button size="lg" onClick={() => navigate('docs/overview')}>Start the tutorial</Button>
            <Button size="lg" variant="outline" onClick={() => navigate('playground')}>Try the playground</Button>
          </div>
          <button className="install-command" onClick={copyInstall} aria-label="Copy install command">
            <span>$</span> <code>{installCommand}</code> <b>{copied ? 'copied' : 'copy'}</b>
          </button>
        </div>
        <Card className="hero-console" aria-label="CAVE code example">
          <div className="console-bar">
            <span>packages.cave</span>
            <small>plain text</small>
          </div>
          <pre><CaveCode code={example} lineNumbers /></pre>
          <div className="query-result">
            <span>QUERY</span>
            <code>?p USES+ core</code>
            <div>4 matches</div>
          </div>
        </Card>
      </section>

      <section className="proof-strip" aria-label="Project attributes">
        <span>PLAIN TEXT</span><i />
        <span>LOCAL-FIRST</span><i />
        <span>APPEND-ONLY</span><i />
        <span>TEMPORAL</span><i />
        <span>CC0</span>
      </section>

      <section className="manifesto">
        <div className="section-label">HOW IT'S TAUGHT</div>
        <div>
          <h2>One idea per step.</h2>
          <p>
            The tutorial starts from a single claim and adds one capability at a time — inverse reads, chains,
            attributes, your own verbs, structured imports, confidence and sources, rules, shapes, cited reports —
            on a monorepo you could type in a minute. A second part turns a market watchlist into a store that
            reads the news and reacts. Every output shown is from an actual run.
          </p>
        </div>
      </section>

      <section className="capabilities">
        {steps.map(item => (
          <Card key={item.number} className="capability-card">
            <span>{item.number}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <code>{item.language === 'cave' ? <CaveCode code={item.code} /> : item.code}</code>
          </Card>
        ))}
      </section>

      <section className="loop-section">
        <div className="section-label">TWO TUTORIALS</div>
        <div className="loop-copy">
          <h2>A monorepo, then a market.</h2>
          <p>
            Part I builds a package graph you can query for blast radius, owners, and advisories that travel up
            the dependency chain. Part II models companies and the themes that move them, lets an LLM read the
            news, derives who is under pressure, and pages for a review when it matters.
          </p>
          <Button variant="link" onClick={() => navigate('docs/overview')}>Start the tutorial →</Button>
        </div>
        <Card className="loop-diagram" aria-label="Write, query, believe, derive, act">
          {['Write', 'Query', 'Believe', 'Derive', 'Act'].map((label, index) => (
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
          <Badge variant="outline">Nothing leaves the browser</Badge>
          <h2>Browser playground</h2>
        </div>
        <p>Edit a sample dataset, rebuild the in-memory store, and execute CAVE-Q without sending data to a server.</p>
        <Button size="lg" onClick={() => navigate('playground')}>Open playground</Button>
      </Card>
    </main>
  )
}
