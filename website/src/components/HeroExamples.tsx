import { useRef, useState, type KeyboardEvent } from 'react'
import { heroExamples } from '../hero-examples.ts'
import { CaveCode } from './CaveCode.tsx'
import { ScrollableCode } from './ScrollableCode.tsx'
import { Card } from './ui/card.tsx'

/**
 * Homepage example carousel. The active tab's progress bar is a CSS
 * animation; its end advances the slide, so pausing is just
 * `animation-play-state` and reduced motion (no animation) means no autoplay.
 * Hovering or focusing inside pauses; choosing a tab stops rotation for good.
 */
export const HeroExamples = () => {
  const [index, setIndex] = useState(0)
  const [stopped, setStopped] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const example = heroExamples[index]!
  const paused = stopped || hovered || focused

  const choose = (next: number, focus = false) => {
    const wrapped = (next + heroExamples.length) % heroExamples.length
    setStopped(true)
    setIndex(wrapped)
    if (focus) tabs.current[wrapped]?.focus()
  }

  const onTabKey = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: heroExamples.length - 1 }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    choose(next, true)
  }

  return (
    <Card
      className={`hero-console${paused ? ' paused' : ''}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="CAVE examples"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
    >
      <div className="console-tabs" role="tablist" aria-label="Examples" onKeyDown={onTabKey}>
        {heroExamples.map((item, at) => (
          <button
            key={item.key}
            ref={element => { tabs.current[at] = element }}
            id={`hero-tab-${item.key}`}
            role="tab"
            type="button"
            aria-selected={at === index}
            aria-controls="hero-example-panel"
            tabIndex={at === index ? 0 : -1}
            onClick={() => choose(at)}
          >
            <span>{String(at + 1).padStart(2, '0')}</span>{item.tab}
            {at === index && !stopped && (
              <i className="console-progress" aria-hidden="true" onAnimationEnd={() => setIndex((index + 1) % heroExamples.length)} />
            )}
          </button>
        ))}
      </div>
      <div id="hero-example-panel" role="tabpanel" aria-labelledby={`hero-tab-${example.key}`} className="console-panel" key={example.key}>
        <div className="console-bar">
          <span>{example.file}</span>
          <small>{example.derive ? 'cave derive' : 'cave add'}</small>
        </div>
        <ScrollableCode><CaveCode code={example.code} lineNumbers /></ScrollableCode>
        <div className="query-result">
          {example.runs.map((run, at) => (
            <div className="query-run" key={at}>
              <span>QUERY</span>
              <code>{run.pattern}{run.flags && <b> {run.flags.join(' ')}</b>}</code>
              <div className="query-output">{run.output.map((line, at) => <span key={at}>{line}</span>)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="console-caption" aria-live={paused ? 'polite' : 'off'}>
        <p><strong>{example.title}</strong> {example.blurb}</p>
        <div className="console-nav">
          <button type="button" aria-label="Previous example" onClick={() => choose(index - 1)}>←</button>
          <button type="button" aria-label="Next example" onClick={() => choose(index + 1)}>→</button>
        </div>
      </div>
    </Card>
  )
}
