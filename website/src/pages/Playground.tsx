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
  readonly at?: string
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
    description: 'Compare stronger causal claims with an earlier suspicion by changing the confidence filter.',
    source: loop,
    query: '?thing CAUSE ?effect\nWHERE conf >= 70%',
  },
  {
    id: 'timeline', label: 'Changing headcount',
    description: 'A trajectory from 100 to 400 people. Change Valid at to explore its value over time.',
    source: 'acme HAS headcount: 100 -> 400 people @2025..2027',
    query: 'acme HAS headcount: ?people', at: '2026',
  },
]

export const Playground = () => {
  const runtimeRef = useRef<PlaygroundRuntime | undefined>(undefined)
  const hasDatabase = useRef(false)
  const [datasetId, setDatasetId] = useState(datasets[0]!.id)
  const [source, setSource] = useState(datasets[0]!.source)
  const [queryText, setQueryText] = useState(datasets[0]!.query)
  const [validAt, setValidAt] = useState(datasets[0]!.at ?? '')
  const [output, setOutput] = useState('Starting SQLite WebAssembly…')
  const [copyState, setCopyState] = useState<{ text: string, phase: 'copying' | 'copied' | 'failed' }>()
  const copying = useRef(false)
  const resultElement = useRef<HTMLPreElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'stopped'>('loading')
  const [claimCount, setClaimCount] = useState(0)
  const [operation, setOperation] = useState<'query' | 'append' | undefined>()
  const pendingOperation = useRef<'query' | 'append' | undefined>(undefined)
  const rebuildButton = useRef<HTMLButtonElement>(null)
  const focusRebuild = useRef(false)
  const openingDataset = useRef(false)
  const [appliedSource, setAppliedSource] = useState<string | undefined>(undefined)
  const hasUnappliedEdits = status === 'ready' && source !== appliedSource

  useEffect(() => {
    if (focusRebuild.current && operation === undefined) {
      focusRebuild.current = false
      rebuildButton.current?.focus()
    }
  }, [operation])

  const createRuntime = () => {
    const runtime = new PlaygroundRuntime(error => {
      if (runtimeRef.current !== runtime) return
      hasDatabase.current = false
      setStatus('error')
      setOutput(`${error.message}\n\nRebuild the database to restart the runtime using your current claims.`)
    })
    return runtime
  }

  const openDataset = async (dataset: Dataset, runtime = runtimeRef.current) => {
    setStatus('loading')
    setOutput('Loading SQLite WebAssembly…')
    try {
      if (runtime === undefined || runtime.isClosed) {
        hasDatabase.current = false
        runtime = createRuntime()
        runtimeRef.current = runtime
      }
      const result = await runtime.open(dataset.source, `playground/${dataset.id}`)
      if (runtimeRef.current !== runtime) return
      hasDatabase.current = true
      setClaimCount(result.currentBeliefs)
      setAppliedSource(dataset.source)
      setStatus('ready')
      setOutput(`Ready. Loaded ${result.claims} claims and ${result.edges} edges into an in-memory SQLite database.`)
    } catch (error) {
      if (runtimeRef.current !== runtime) return
      setStatus(hasDatabase.current ? 'ready' : 'error')
      const message = error instanceof Error ? error.message : String(error)
      setOutput(hasDatabase.current ? `${message}\n\nRebuild failed. The last working database is unchanged; correct the claims and rebuild, or query the previous data.` : `${message}\n\nRebuild the database to retry using your current claims.`)
    }
  }

  useEffect(() => {
    hasDatabase.current = false
    void openDataset(datasets[0]!)
    return () => {
      const current = runtimeRef.current
      runtimeRef.current = undefined
      current?.close()
    }
  }, [])

  const selectDataset = (id: string) => {
    if (status === 'loading' || pendingOperation.current !== undefined || openingDataset.current) return
    openingDataset.current = true
    const dataset = datasets.find(item => item.id === id) ?? datasets[0]!
    setDatasetId(dataset.id)
    setSource(dataset.source)
    setQueryText(dataset.query)
    setValidAt(dataset.at ?? '')
    void openDataset(dataset).finally(() => { openingDataset.current = false })
  }

  const rebuild = async () => {
    if (status === 'loading' || pendingOperation.current !== undefined || openingDataset.current) return
    openingDataset.current = true
    const dataset = { ...datasets.find(item => item.id === datasetId)!, source }
    try { await openDataset(dataset) }
    finally { openingDataset.current = false }
  }

  const downloadClaims = () => {
    if (/[\uD800-\uDFFF]/u.test(source)) {
      setOutput('Cannot download claims containing an unpaired Unicode surrogate. Correct the claims and try again.')
      return
    }
    let url: string | undefined
    let link: HTMLAnchorElement | undefined
    try {
      url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }))
      link = document.createElement('a')
      link.href = url
      link.download = `${datasetId}.cave`
      document.body.append(link)
      link.click()
      setOutput(`Download requested for ${datasetId}.cave. Your claims remain in the editor.`)
    } catch {
      setOutput('Could not start the download. Your claims are unchanged; try again or copy them from the editor.')
    } finally {
      link?.remove()
      // Let the browser begin the download before releasing its backing data.
      if (url !== undefined) {
        const downloadUrl = url
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 0)
      }
    }
  }

  const append = () => {
    const runtime = runtimeRef.current
    if (runtime === undefined || status !== 'ready' || pendingOperation.current !== undefined) return
    pendingOperation.current = 'append'
    setOperation('append')
    setOutput('Appending claims…')
    void runtime.append(source).then(result => {
      if (runtimeRef.current !== runtime) return
      setClaimCount(result.currentBeliefs)
      setAppliedSource(source)
      setOutput(`Appended ${result.claims} claims and ${result.edges} edges. The store now contains ${result.currentBeliefs} current beliefs.`)
    }).catch(error => {
      if (runtimeRef.current === runtime && !runtime.isClosed) setOutput(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (runtimeRef.current !== runtime) return
      pendingOperation.current = undefined
      setOperation(undefined)
    })
  }

  const stopQuery = () => {
    const runtime = runtimeRef.current
    if (runtime === undefined || pendingOperation.current !== 'query') return
    focusRebuild.current = true
    runtime.close()
    hasDatabase.current = false
    setStatus('stopped')
    setOutput('Query stopped. The in-memory database was closed. Rebuild the database using your current claims to run another query.')
  }

  const copyResult = async () => {
    if (copying.current || status === 'loading' || pendingOperation.current !== undefined) return
    copying.current = true
    const text = output
    setCopyState({ text, phase: 'copying' })
    try {
      await navigator.clipboard.writeText(text)
      setCopyState({ text, phase: 'copied' })
    } catch {
      setCopyState({ text, phase: 'failed' })
    } finally {
      copying.current = false
    }
  }

  const selectResult = () => {
    const element = resultElement.current
    if (!element) return
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const runQuery = () => {
    const runtime = runtimeRef.current
    if (runtime === undefined || status !== 'ready' || pendingOperation.current !== undefined) return
    pendingOperation.current = 'query'
    setOperation('query')
    setOutput('Running query…')
    const at = validAt.trim() || undefined
    const pattern = queryText
    const timing = at === undefined ? 'Valid time: unfiltered' : `Valid at: ${at}`
    const context = `Query: ${pattern}\n${timing}`
    void runtime.query(pattern, at).then(result => {
      if (runtimeRef.current !== runtime) return
      const matches = result.matches === 0 ? result.output : `${result.matches} match${result.matches === 1 ? '' : 'es'}\n\n${result.output}`
      setOutput(`${context}\n\n${matches}`)
    }).catch(error => {
      if (runtimeRef.current === runtime && !runtime.isClosed) {
        const message = error instanceof Error ? error.message : String(error)
        setOutput(`${context}\n\nError: ${message}`)
      }
    }).finally(() => {
      if (runtimeRef.current !== runtime) return
      pendingOperation.current = undefined
      setOperation(undefined)
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
          <select value={datasetId} aria-disabled={status === 'loading' || operation !== undefined} aria-busy={status === 'loading'} onChange={event => selectDataset(event.target.value)}>
            {datasets.map(dataset => <option key={dataset.id} value={dataset.id} disabled={status === 'loading' || operation !== undefined}>{dataset.label}</option>)}
          </select>
        </label>
        <p>{datasets.find(item => item.id === datasetId)?.description}</p>
        <div className={`runtime-status ${status}`}><i /> {status === 'loading' ? 'Starting runtime' : status === 'ready' ? `${claimCount} current beliefs` : status === 'stopped' ? 'Query stopped' : 'Runtime error'}</div>
      </Card>

      <Card className="workbench">
        <div className="workbench-panel editor-panel">
          <header><div><span>01</span><strong>Claims</strong></div><small>dataset.cave</small></header>
          <CaveEditor value={source} onChange={event => setSource(event.target.value)} ariaLabel="CAVE claims" />
          <p id="claims-rebuild-help" className="unapplied-claims">Rebuild replaces the database with the editor contents. Claims absent from the editor are removed.</p>
          <p id="claims-append-help" className="unapplied-claims">Append again adds these claims while keeping existing data.</p>
          <footer>
            <Button ref={rebuildButton} size="sm" onClick={() => void rebuild()} aria-describedby="claims-rebuild-help" disabled={operation !== undefined} aria-disabled={status === 'loading' || operation !== undefined} aria-busy={status === 'loading'}>Rebuild database</Button>
            <Button size="sm" variant="outline" onClick={append} aria-describedby="claims-append-help" disabled={status !== 'ready'} aria-disabled={status !== 'ready' || operation !== undefined} aria-busy={operation === 'append'}>Append again</Button>
            <Button size="sm" variant="outline" onClick={downloadClaims}>Download claims</Button>
          </footer>
        </div>

        <div className="workbench-stack">
          <div className="workbench-panel query-panel">
            <header><div><span>02</span><strong>CAVE-Q</strong></div><small>graph pattern</small></header>
            <div className="query-input"><span aria-hidden="true">?</span><textarea rows={5} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" aria-label="CAVE query" aria-describedby={`query-keyboard-help${hasUnappliedEdits ? ' unapplied-claims' : ''}`} value={queryText} onChange={event => setQueryText(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                runQuery()
              }
            }} /></div>
            <p id="query-keyboard-help" className="unapplied-claims">Enter runs the query. Shift+Enter adds a line for filters or comments.</p>
            <p id="unapplied-claims" role="status" className="unapplied-claims" hidden={!hasUnappliedEdits}>Unapplied edits. Queries use the last working database. Rebuild or append to apply your claims.</p>
            <label className="query-time">Valid at (optional)
              <input spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" value={validAt} placeholder="e.g. 2026 or 2026-06-15" aria-describedby="query-time-help" onChange={event => setValidAt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) runQuery() }} />
            </label>
            <p id="query-time-help" className="unapplied-claims">A date or timestamp to filter time contexts and interpolate trajectories. Leave blank for all valid times.</p>
            <p id="query-stop-help" className="unapplied-claims" hidden={operation !== 'query'}>Stop query closes the database, including appended history. Your editor text is kept for rebuilding.</p>
            <footer>
              <Button size="sm" onClick={runQuery} disabled={status !== 'ready'} aria-disabled={status !== 'ready' || operation !== undefined} aria-busy={operation === 'query'}>Run query</Button>
              <Button size="sm" variant="outline" onClick={stopQuery} disabled={operation !== 'query'} aria-describedby={operation === 'query' ? 'query-stop-help' : undefined}>Stop query</Button>
            </footer>
          </div>

          <div className="workbench-panel output-panel">
            <header><div><span>03</span><strong id="playground-result-label">Result</strong></div><Button size="sm" variant="outline" onClick={() => void copyResult()} aria-disabled={copyState?.phase === 'copying' || status === 'loading' || operation !== undefined} aria-busy={copyState?.phase === 'copying'}>Copy result</Button></header>
            <p className="result-copy-status" role="status">{copyState?.text === output && (copyState.phase === 'copying' ? 'Copying result…' : copyState.phase === 'copied' ? 'Result copied.' : 'Copy unavailable. Select the result text to copy it manually.')}</p>
            {copyState?.text === output && copyState.phase === 'failed' && <Button size="sm" variant="outline" onClick={selectResult}>Select result text</Button>}
            <pre ref={resultElement} role="status" aria-labelledby="playground-result-label" aria-live="polite" aria-atomic="true" tabIndex={0}>{output}</pre>
          </div>
        </div>
      </Card>

      <div className="playground-note">
        <strong>Browser runtime</strong>
        <p>The database is ephemeral and isolated to this tab. Download claims saves the current editor text, including unapplied edits, as a .cave file. Filesystem ingest, shell hooks, and the HTTP server remain CLI features.</p>
        <a href="#/docs/cli">CLI reference →</a>
      </div>
    </main>
  )
}
