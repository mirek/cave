import { useEffect, useRef, useState } from 'react'
import family from '../../../examples/family-history/notes.cave?raw'
import incident from '../../../examples/incident/incident.cave?raw'
import loop from '../../../examples/loop-eval/postmortem.cave?raw'
import { CaveEditor } from '../components/CaveEditor.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card } from '../components/ui/card.tsx'
import { PlaygroundRuntime } from '../playground/client.ts'

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

export const Playground = () => {
  const runtimeRef = useRef<PlaygroundRuntime | undefined>(undefined)
  const [datasetId, setDatasetId] = useState(datasets[0]!.id)
  const [source, setSource] = useState(datasets[0]!.source)
  const [queryText, setQueryText] = useState(datasets[0]!.query)
  const [output, setOutput] = useState('Starting SQLite WebAssembly…')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claimCount, setClaimCount] = useState(0)

  const openDataset = async (dataset: Dataset, runtime = runtimeRef.current) => {
    if (runtime === undefined) return
    setStatus('loading')
    setOutput('Loading SQLite WebAssembly…')
    try {
      const result = await runtime.open(dataset.source, `playground/${dataset.id}`)
      if (runtimeRef.current !== runtime) return
      setClaimCount(result.currentBeliefs)
      setStatus('ready')
      setOutput(`Ready. Loaded ${result.claims} claims and ${result.edges} edges into an in-memory SQLite database.`)
    } catch (error) {
      if (runtimeRef.current !== runtime) return
      setStatus('error')
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    const runtime = new PlaygroundRuntime()
    runtimeRef.current = runtime
    void openDataset(datasets[0]!, runtime)
    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = undefined
      runtime.close()
    }
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
    const runtime = runtimeRef.current
    if (runtime === undefined) return
    void runtime.append(source).then(result => {
      if (runtimeRef.current !== runtime) return
      setClaimCount(result.currentBeliefs)
      setOutput(`Appended ${result.claims} claims and ${result.edges} edges. The store now contains ${result.currentBeliefs} current beliefs.`)
    }).catch(error => {
      if (runtimeRef.current === runtime) setOutput(error instanceof Error ? error.message : String(error))
    })
  }

  const runQuery = () => {
    const runtime = runtimeRef.current
    if (runtime === undefined) return
    void runtime.query(queryText).then(result => {
      if (runtimeRef.current !== runtime) return
      setOutput(result.matches === 0 ? result.output : `${result.matches} match${result.matches === 1 ? '' : 'es'}\n\n${result.output}`)
    }).catch(error => {
      if (runtimeRef.current === runtime) setOutput(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <main className="playground">
      <section className="playground-intro">
        <div>
          <Badge variant="secondary">Local browser runtime</Badge>
          <h1>CAVE playground</h1>
        </div>
        <p>
          This page runs the CAVE parser, canonicalizer, store, and query engine against SQLite compiled to WebAssembly.
          Edit the claims, rebuild the database, and run a graph query. Data remains in this browser tab.
        </p>
      </section>

      <Card className="playground-toolbar">
        <label>
          <span>Sample dataset</span>
          <select value={datasetId} onChange={event => selectDataset(event.target.value)}>
            {datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.label}</option>)}
          </select>
        </label>
        <p>{datasets.find(item => item.id === datasetId)?.description}</p>
        <div className={`runtime-status ${status}`}><i /> {status === 'loading' ? 'Starting runtime' : status === 'ready' ? `${claimCount} current beliefs` : 'Runtime error'}</div>
      </Card>

      <Card className="workbench">
        <div className="workbench-panel editor-panel">
          <header><div><span>01</span><strong>Claims</strong></div><small>dataset.cave</small></header>
          <CaveEditor value={source} onChange={event => setSource(event.target.value)} ariaLabel="CAVE claims" />
          <footer>
            <Button size="sm" onClick={() => void rebuild()} disabled={status === 'loading'}>Rebuild database</Button>
            <Button size="sm" variant="outline" onClick={append} disabled={status !== 'ready'}>Append again</Button>
          </footer>
        </div>

        <div className="workbench-stack">
          <div className="workbench-panel query-panel">
            <header><div><span>02</span><strong>CAVE-Q</strong></div><small>graph pattern</small></header>
            <div className="query-input"><span>?</span><input value={queryText} onChange={event => setQueryText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') runQuery() }} /></div>
            <footer><Button size="sm" onClick={runQuery} disabled={status !== 'ready'}>Run query</Button></footer>
          </div>

          <div className="workbench-panel output-panel">
            <header><div><span>03</span><strong>Result</strong></div><small>SQLite WASM</small></header>
            <pre>{output}</pre>
          </div>
        </div>
      </Card>

      <div className="playground-note">
        <strong>Browser runtime</strong>
        <p>The database is ephemeral and isolated to this tab. Filesystem ingest, shell hooks, and the HTTP server remain CLI features.</p>
        <a href="#/docs/cli">CLI reference →</a>
      </div>
    </main>
  )
}
