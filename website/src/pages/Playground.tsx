import { useEffect, useRef, useState } from 'react'
import { query, type Match } from '@cavelang/query'
import { open, type Store } from '@cavelang/store'
import family from '../../../examples/family-history/notes.cave?raw'
import incident from '../../../examples/incident/incident.cave?raw'
import loop from '../../../examples/loop-eval/postmortem.cave?raw'
import { CaveEditor } from '../components/CaveEditor.tsx'
import { initializeSqlite } from '../playground/sqlite-shim.ts'

type Dataset = {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly source: string
  readonly query: string
}

const datasets: readonly Dataset[] = [
  {
    id: 'family',
    label: 'Family history',
    description: 'Inverse relations, confidence, sources, and a transitive ancestor query.',
    source: family,
    query: '?ancestor PARENT-OF+ me',
  },
  {
    id: 'incident',
    label: 'Incident report',
    description: 'Operational knowledge represented as atomic, attributable claims.',
    source: incident,
    query: '?service HAS bug: ?bug',
  },
  {
    id: 'postmortem',
    label: 'Postmortem graph',
    description: 'A compact graph used by CAVE reconstruction evaluations.',
    source: loop,
    query: '?thing CAUSE ?effect',
  },
]

const formatMatch = (match: Match, index: number): string => {
  const bindings = Object.entries(match.bindings)
  if (bindings.length === 0) return `${index + 1}. matched${match.row ? ` · ${match.row.raw_line}` : ''}`
  return `${index + 1}. ${bindings.map(([name, value]) => `?${name} = ${value}`).join(' · ')}`
}

export const Playground = () => {
  const storeRef = useRef<Store | undefined>(undefined)
  const [datasetId, setDatasetId] = useState(datasets[0]!.id)
  const [source, setSource] = useState(datasets[0]!.source)
  const [queryText, setQueryText] = useState(datasets[0]!.query)
  const [output, setOutput] = useState('Starting SQLite WebAssembly…')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claimCount, setClaimCount] = useState(0)

  const openDataset = async (dataset: Dataset) => {
    setStatus('loading')
    setOutput('Loading SQLite WebAssembly…')
    try {
      await initializeSqlite()
      storeRef.current?.close()
      const store = open(':memory:')
      storeRef.current = store
      const result = store.ingest(dataset.source, { strict: true, source: `playground/${dataset.id}` })
      const count = store.currentBeliefs().length
      setClaimCount(count)
      setStatus('ready')
      setOutput(`Ready. Loaded ${result.ids.length} claims and ${result.edges} edges into an in-memory SQLite database.`)
    } catch (error) {
      setStatus('error')
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    void openDataset(datasets[0]!)
    return () => storeRef.current?.close()
  }, [])

  const selectDataset = (id: string) => {
    const dataset = datasets.find(item => item.id === id) ?? datasets[0]!
    setDatasetId(dataset.id)
    setSource(dataset.source)
    setQueryText(dataset.query)
    void openDataset(dataset)
  }

  const rebuild = async () => {
    const dataset = { ...datasets.find(item => item.id === datasetId)!, source }
    await openDataset(dataset)
  }

  const append = () => {
    const store = storeRef.current
    if (store === undefined) return
    try {
      const result = store.ingest(source, { strict: true, source: 'playground/editor' })
      const count = store.currentBeliefs().length
      setClaimCount(count)
      setOutput(`Appended ${result.ids.length} claims and ${result.edges} edges. The store now contains ${count} current beliefs.`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  const runQuery = () => {
    const store = storeRef.current
    if (store === undefined) return
    try {
      const matches = query(store, queryText)
      setOutput(matches.length === 0 ? 'No matches.' : `${matches.length} match${matches.length === 1 ? '' : 'es'}\n\n${matches.map(formatMatch).join('\n')}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="playground">
      <section className="playground-intro">
        <div>
          <div className="kicker"><i /> No server. No account. No data leaves this tab.</div>
          <h1>The whole idea,<br /><em>running here.</em></h1>
        </div>
        <p>
          This is the production CAVE parser, canonicalizer, store, and query engine over SQLite compiled to WebAssembly.
          Edit the claims, rebuild the database, then ask it something that was never written down.
        </p>
      </section>

      <section className="playground-toolbar">
        <label>
          <span>Sample dataset</span>
          <select value={datasetId} onChange={event => selectDataset(event.target.value)}>
            {datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.label}</option>)}
          </select>
        </label>
        <p>{datasets.find(item => item.id === datasetId)?.description}</p>
        <div className={`runtime-status ${status}`}><i /> {status === 'loading' ? 'Starting runtime' : status === 'ready' ? `${claimCount} current beliefs` : 'Runtime error'}</div>
      </section>

      <section className="workbench">
        <div className="workbench-panel editor-panel">
          <header><div><span>01</span><strong>Claims</strong></div><small>dataset.cave</small></header>
          <CaveEditor value={source} onChange={event => setSource(event.target.value)} ariaLabel="CAVE claims" />
          <footer>
            <button onClick={() => void rebuild()} disabled={status === 'loading'}>Rebuild database</button>
            <button className="subtle" onClick={append} disabled={status !== 'ready'}>Append again</button>
          </footer>
        </div>

        <div className="workbench-stack">
          <div className="workbench-panel query-panel">
            <header><div><span>02</span><strong>CAVE-Q</strong></div><small>graph pattern</small></header>
            <div className="query-input"><span>?</span><input value={queryText} onChange={event => setQueryText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') runQuery() }} /></div>
            <footer><button onClick={runQuery} disabled={status !== 'ready'}>Run query <span>⌘ ↵</span></button></footer>
          </div>

          <div className="workbench-panel output-panel">
            <header><div><span>03</span><strong>Result</strong></div><small>SQLite WASM</small></header>
            <pre>{output}</pre>
          </div>
        </div>
      </section>

      <div className="playground-note">
        <strong>Browser edition</strong>
        <p>The database is ephemeral and isolated to this tab. Node-only surfaces such as filesystem ingest, shell hooks, and the HTTP server remain CLI features.</p>
        <a href="#/docs/cli">See the complete CLI →</a>
      </div>
    </main>
  )
}
