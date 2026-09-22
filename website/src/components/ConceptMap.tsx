import { useId, useState, type ReactNode } from 'react'
import { Card } from './ui/card.tsx'

// Homepage concept map: claim anatomy plus four small diagrams. The two
// scrubbers are named after the CLI flags they stand for (--as-of, --at).

type Point = readonly [number, number]

const anatomy = [
  { text: 'lot/huila-26', label: 'subject', inKey: true },
  { text: 'HAS', label: 'verb', inKey: true },
  { text: 'price:', label: 'attribute', inKey: true },
  { text: '7.80 USD/kg', label: 'value + unit', inKey: false },
  { text: '@src:la-cima', label: 'context', inKey: true },
  { text: '@ 90%', label: 'confidence', inKey: false },
  { text: '; quoted in June', label: 'comment', inKey: false },
]

const Token = ({ text, label, inKey }: (typeof anatomy)[number]) => (
  <span className={inKey ? 'cm-token cm-token-key' : 'cm-token'}>
    <code>{text}</code>
    <small>{label}</small>
  </span>
)

const Anatomy = () => (
  <Card className="cm-anatomy">
    <h3>A claim is one line</h3>
    <p className="cm-line" aria-label={anatomy.map(token => token.text).join(' ')}>
      {anatomy.map(token => <Token key={token.label} {...token} />)}
    </p>
    <div className="cm-legend">
      <span><i className="cm-swatch cm-swatch-key" />Claim key: the question the line answers</span>
      <span><i className="cm-swatch" />The answer, how sure, and why</span>
    </div>
    <p className="cm-note">
      A relation has no attribute: <code>la-cima SUPPLIES lot/huila-26</code>. Two lines with the same key
      answer the same question, so the newer one supersedes the older without erasing it.
    </p>
  </Card>
)

// SVG primitives

const Label = ({ at: [x, y], children, className = 'cm-t', anchor = 'start' }: {
  at: Point
  children: ReactNode
  className?: string
  anchor?: 'start' | 'middle' | 'end'
}) => <text x={x} y={y} className={className} textAnchor={anchor}>{children}</text>

const Dot = ({ at: [x, y], hollow = false }: { at: Point; hollow?: boolean }) => (
  <circle cx={x} cy={y} r={5} className={hollow ? 'cm-dot cm-dot-old' : 'cm-dot'} />
)

const Line = ({ from: [x1, y1], to: [x2, y2], className = 'cm-stroke' }: {
  from: Point
  to: Point
  className?: string
}) => <line x1={x1} y1={y1} x2={x2} y2={y2} className={className} />

const Axis = ({ y, ticks, caption }: { y: number; ticks: readonly (readonly [number, string])[]; caption: string }) => (
  <g>
    <Line from={[20, y]} to={[340, y]} className="cm-axis" />
    {ticks.map(([x, text]) => (
      <g key={text}>
        <Line from={[x, y - 3]} to={[x, y + 3]} className="cm-axis" />
        <Label at={[x, y + 16]} anchor="middle" className="cm-t cm-t-mute">{text}</Label>
      </g>
    ))}
    <Label at={[340, y + 34]} anchor="end" className="cm-t cm-t-mute">{caption}</Label>
  </g>
)

const ArrowMarker = ({ id }: { id: string }) => (
  <defs>
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" className="cm-arrowhead" />
    </marker>
  </defs>
)

const Figure = ({ title, label, caption, control, children }: {
  title: string
  label: string
  caption: ReactNode
  control?: ReactNode
  children: ReactNode
}) => (
  <Card className="cm-figure">
    <h3>{title}</h3>
    <svg viewBox="0 0 360 214" role="img" aria-label={label}>{children}</svg>
    {control}
    <p>{caption}</p>
  </Card>
)

const Scrubber = ({ flag, value, min, max, valueText, readout, onChange }: {
  flag: string
  value: number
  min: number
  max: number
  valueText: string
  readout: string
  onChange: (value: number) => void
}) => {
  const id = useId()
  return (
    <div className="cm-scrubber">
      <label htmlFor={id}><code>{flag} {valueText}</code></label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={valueText}
        onChange={event => onChange(Number(event.currentTarget.value))}
      />
      <output htmlFor={id} aria-live="polite">{readout}</output>
    </div>
  )
}

// Belief only grows: learning-time axis, read --as-of a day offset.

type BeliefRow = { on: string; value: string; retracts?: boolean }
type Series = { key: string; y: number; rows: readonly BeliefRow[] }
type RowState = 'held' | 'old' | 'future'

const series: readonly Series[] = [
  {
    key: 'lot/huila-26 HAS price @src:la-cima',
    y: 58,
    rows: [{ on: '2026-06-10', value: '7.80' }, { on: '2026-08-14', value: '8.20' }],
  },
  {
    key: 'la-cima SUPPLIES lot/santa-ana-26',
    y: 138,
    rows: [{ on: '2026-06-10', value: '100%' }, { on: '2026-09-08', value: '@ 0%', retracts: true }],
  },
]

const axisStart = Date.UTC(2026, 5, 1)
const dayMs = 86_400_000
const dayToIso = (offset: number) => new Date(axisStart + offset * dayMs).toISOString().slice(0, 10)
const learnedX = (iso: string) => 40 + ((Date.parse(iso) - axisStart) / dayMs) * (300 / 122)
const latestOn = <T extends { on: string }>(rows: readonly T[], iso: string) => rows.filter(row => row.on <= iso).at(-1)
const rowState = <T extends { on: string }>(row: T, held: T | undefined, iso: string): RowState =>
  row === held ? 'held' : row.on <= iso ? 'old' : 'future'

const beliefAt = (s: Series, iso: string) => {
  const row = latestOn(s.rows, iso)
  return row === undefined ? 'not yet written' : row.retracts ? 'retracted' : row.value
}

const SeriesTrack = ({ s, iso }: { s: Series; iso: string }) => {
  const held = latestOn(s.rows, iso)
  const cursor = Math.min(learnedX(iso), 340)
  return (
    <g>
      <Label at={[20, s.y - 32]} className="cm-t cm-t-code">{s.key}</Label>
      <Line from={[learnedX(s.rows[0].on), s.y]} to={[340, s.y]} className="cm-stroke cm-stroke-old" />
      {held && <Line from={[learnedX(held.on), s.y]} to={[cursor, s.y]} className="cm-stroke cm-stroke-strong" />}
      {s.rows.map(row => {
        const x = learnedX(row.on)
        const state = rowState(row, held, iso)
        return (
          <g key={row.on} className={state === 'future' ? 'cm-future' : undefined}>
            <Dot at={[x, s.y]} hollow={state !== 'held' || row.retracts === true} />
            {row.retracts && <Line from={[x - 5, s.y + 5]} to={[x + 5, s.y - 5]} className="cm-stroke cm-stroke-strong" />}
            <Label at={[x, s.y + 22]} anchor="middle" className={state === 'held' ? 'cm-t cm-t-strong' : 'cm-t cm-t-mute'}>
              {row.value}
            </Label>
          </g>
        )
      })}
    </g>
  )
}

const BeliefFigure = ({ offset, onOffset }: { offset: number; onOffset: (offset: number) => void }) => {
  const iso = dayToIso(offset)
  const x = learnedX(iso)
  const [price, supply] = series.map(s => beliefAt(s, iso))
  return (
    <Figure
      title="Belief only grows"
      label={`Two belief series on a learning-time axis, read as of ${iso}. Price: ${price}. Supply: ${supply}.`}
      control={
        <Scrubber
          flag="--as-of"
          value={offset}
          min={0}
          max={121}
          valueText={iso}
          onChange={onOffset}
          readout={`${iso}: price ${price}, supply ${supply}`}
        />
      }
      caption={<>
        Every change is an append. The newest row per key is current belief; <code>@&nbsp;0%</code> retracts;
        rows written later are ignored when you read <code>--as-of</code> an earlier moment.
      </>}
    >
      {series.map(s => <SeriesTrack key={s.key} s={s} iso={iso} />)}
      <Line from={[x, 36]} to={[x, 96]} className="cm-stroke cm-stroke-dash" />
      <Line from={[x, 118]} to={[x, 176]} className="cm-stroke cm-stroke-dash" />
      <Axis y={176} ticks={[[77.5, 'Jun'], [152.5, 'Jul'], [227.5, 'Aug'], [302.5, 'Sep']]} caption="when the store learned it →" />
    </Figure>
  )
}

// Sources keep their own voice: two contradicting scores, resolved on demand.

const voices = [
  { value: '84', src: '@src:cupping/june', reliability: 0.6, y: 64, wins: false },
  { value: '86.5', src: '@src:q-grader/ana', reliability: 0.95, y: 132, wins: true },
]

const Voice = ({ value, src, reliability, y, wins }: (typeof voices)[number]) => (
  <g>
    <Label at={[20, y]} className={wins ? 'cm-t cm-t-big' : 'cm-t cm-t-big cm-t-mute'}>{value}</Label>
    <Label at={[92, y - 9]} className="cm-t cm-t-code">{src}</Label>
    <rect x={92} y={y + 2} width={100 * reliability} height={7} rx={1.5} className={wins ? 'cm-bar' : 'cm-bar cm-bar-old'} />
    <Label at={[92, y + 25]} className="cm-t cm-t-mute">{`100% × ${Math.round(reliability * 100)}% reliable`}</Label>
    <path
      d={`M190 ${y + 5} C 225 ${y + 5}, 225 98, 252 98`}
      className={wins ? 'cm-stroke cm-stroke-strong' : 'cm-stroke cm-stroke-old'}
      fill="none"
    />
  </g>
)

const SourcesFigure = () => (
  <Figure
    title="Sources keep their own voice"
    label="Two sources score the same lot, 84 and 86.5. Both are kept. Resolve weighs confidence times source reliability and picks 86.5."
    caption={<>
      A different source is a different series, so contradictions coexist. <code>--resolve</code> picks a winner
      by precedence, then confidence × reliability, then recency.
    </>}
  >
    <Label at={[20, 22]} className="cm-t cm-t-code">lot/huila-26 HAS score: ?</Label>
    {voices.map(voice => <Voice key={voice.src} {...voice} />)}
    <rect x={252} y={84} width={62} height={28} rx={5} className="cm-box" />
    <Label at={[283, 102]} anchor="middle" className="cm-t cm-t-code">resolve</Label>
    <Line from={[314, 98]} to={[326, 98]} className="cm-stroke cm-stroke-strong" />
    <Label at={[330, 103]} className="cm-t cm-t-strong">86.5</Label>
    <Label at={[20, 200]} className="cm-t cm-t-mute">The default read keeps every voice.</Label>
  </Figure>
)

// A trajectory is a value that moves: valid-time axis, read --at a month,
// composed with the --as-of offset from the belief figure.

type Estimate = { on: string; from: number; to: number }

const estimates: readonly Estimate[] = [
  { on: '2026-07-01', from: 7.8, to: 8.4 },
  { on: '2026-09-01', from: 7.8, to: 8.6 },
]

const yearX = (year: number) => 40 + (year - 2025) * 100
const priceY = (price: number) => 158 - ((price - 7.6) / 1.2) * 128
const plot = (year: number, price: number): Point => [yearX(year), priceY(price)]
const fixed = (value: number) => value.toFixed(2)
const monthLabel = (month: number) => `${2025 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`

// Interpolates across 2026..2027 and holds the end value through 2028.
const valueAt = ({ from, to }: Estimate, year: number) =>
  year < 2026 || year >= 2028 ? undefined : from + (to - from) * Math.min(year - 2026, 1)

const timelessPrice = (iso: string) => {
  const row = latestOn(series[0].rows, iso)
  return row === undefined ? undefined : Number(row.value)
}

const EstimatePath = ({ estimate, state }: { estimate: Estimate; state: RowState }) => (
  <g className={state === 'future' ? 'cm-future' : undefined}>
    <polyline
      points={[plot(2026, estimate.from), plot(2027, estimate.to), plot(2028, estimate.to)].map(p => p.join(',')).join(' ')}
      className={state === 'held' ? 'cm-stroke cm-stroke-strong' : 'cm-stroke cm-stroke-old cm-stroke-dash'}
      fill="none"
    />
    <Label at={[yearX(2027) + 6, priceY(estimate.to) - 8]} className={state === 'held' ? 'cm-t cm-t-code' : 'cm-t cm-t-code cm-t-mute'}>
      {`${fixed(estimate.from)} -> ${fixed(estimate.to)}`}
    </Label>
  </g>
)

const TrajectoryFigure = ({ asOf }: { asOf: number }) => {
  const [month, setMonth] = useState(18)
  const iso = dayToIso(asOf)
  const year = 2025 + month / 12
  const x = yearX(year)
  const at = monthLabel(month)
  const held = latestOn(estimates, iso)
  const timeless = timelessPrice(iso)
  const moving = held && valueAt(held, year)
  const parts = [
    timeless === undefined ? 'no price yet' : `${fixed(timeless)} timeless`,
    held === undefined ? 'no trajectory yet' : moving === undefined ? 'trajectory out of range' : `${fixed(moving)} on the trajectory`,
  ]
  const readout = `as of ${iso}, at ${at}: ${parts.join(', ')}`
  return (
    <Figure
      title="A trajectory is a value that moves"
      label={`Valid-time chart, ${readout}.`}
      control={<Scrubber flag="--at" value={month} min={0} max={35} valueText={at} onChange={setMonth} readout={readout} />}
      caption={<>
        <code>7.80 -&gt; 8.60 USD/kg @2026..2027</code> interpolates across its range and holds at the end value.{' '}
        <code>--at</code> picks when in the world; the <code>--as-of</code> slider above picks which estimate, and
        which timeless price, the store believed. The two compose.
      </>}
    >
      {timeless !== undefined && (
        <g>
          <Line from={plot(2025, timeless)} to={plot(2028, timeless)} className="cm-stroke cm-stroke-dot" />
          <Label at={[44, priceY(timeless) + 14]} className="cm-t cm-t-mute">{`${fixed(timeless)} timeless`}</Label>
        </g>
      )}
      {estimates.map(estimate => (
        <EstimatePath key={estimate.on} estimate={estimate} state={rowState(estimate, held, iso)} />
      ))}
      <Line from={[x, 26]} to={[x, 162]} className="cm-stroke cm-stroke-dash" />
      {timeless !== undefined && <Dot at={[x, priceY(timeless)]} hollow />}
      {moving !== undefined && (
        <g>
          <Dot at={[x, priceY(moving)]} />
          <Label
            at={x < 290 ? [x + 10, priceY(moving) + 14] : [x - 10, priceY(moving) + 14]}
            anchor={x < 290 ? 'start' : 'end'}
            className="cm-t cm-t-strong"
          >
            {fixed(moving)}
          </Label>
        </g>
      )}
      <Axis
        y={170}
        ticks={[2025, 2026, 2027, 2028].map(tick => [yearX(tick), String(tick)] as const)}
        caption="when it holds in the world →"
      />
    </Figure>
  )
}

// Rules derive what nobody wrote.

const nodes = [
  { name: 'coffee/morning-blend', at: [80, 44] as Point },
  { name: 'lot/huila-26', at: [180, 150] as Point },
  { name: 'la-cima', at: [290, 44] as Point },
]

const Node = ({ name, at: [x, y] }: (typeof nodes)[number]) => {
  const width = name.length * 7 + 18
  return (
    <g>
      <rect x={x - width / 2} y={y - 13} width={width} height={26} rx={13} className="cm-box" />
      <Label at={[x, y + 4]} anchor="middle" className="cm-t cm-t-code">{name}</Label>
    </g>
  )
}

const RulesFigure = () => (
  <Figure
    title="Rules derive what nobody wrote"
    label="The morning blend uses the Huila lot and la-cima supplies it, so a rule derives that the morning blend depends on la-cima. The derived edge points back to both premises."
    caption={<>
      <code>?c USES ?lot, ?s SUPPLIES ?lot =&gt; ?c DEPENDS-ON ?s</code>. The conclusion is stamped
      <code> @src:rule/…</code> with <code>BECAUSE</code> edges to its premises; lose a premise and it is retracted.
    </>}
  >
    <ArrowMarker id="cm-arrow" />
    <path d="M100 58 L162 136" className="cm-stroke cm-stroke-strong" markerEnd="url(#cm-arrow)" fill="none" />
    <Label at={[106, 108]} className="cm-t cm-t-verb">USES</Label>
    <path d="M272 58 L200 136" className="cm-stroke cm-stroke-strong" markerEnd="url(#cm-arrow)" fill="none" />
    <Label at={[244, 108]} className="cm-t cm-t-verb">SUPPLIES</Label>
    <path d="M164 44 L254 44" className="cm-stroke cm-stroke-dash" markerEnd="url(#cm-arrow)" fill="none" />
    <Label at={[209, 30]} anchor="middle" className="cm-t cm-t-verb">DEPENDS-ON</Label>
    <Label at={[209, 62]} anchor="middle" className="cm-t cm-t-mute">derived</Label>
    {nodes.map(node => <Node key={node.name} {...node} />)}
    <Label at={[20, 200]} className="cm-t cm-t-mute">Solid: written. Dashed: concluded.</Label>
  </Figure>
)

export const ConceptMap = () => {
  const [asOf, setAsOf] = useState(45)
  return (
    <section className="concept-map" aria-labelledby="concept-map-title">
      <div className="section-label">THE MODEL</div>
      <div className="cm-body">
        <h2 id="concept-map-title">Five ideas carry the rest.</h2>
        <p className="cm-intro">
          One line states one claim. Lines are never edited, so the store keeps two clocks: when it learned
          something, and when that thing is true in the world.
        </p>
        <Anatomy />
        <div className="cm-grid">
          <BeliefFigure offset={asOf} onOffset={setAsOf} />
          <SourcesFigure />
          <TrajectoryFigure asOf={asOf} />
          <RulesFigure />
        </div>
      </div>
    </section>
  )
}
