# @cavelang/view

The human read surface (spec §30, §31): `cave serve` puts **one static,
self-contained HTML page** over a CAVE store — the graph as something
you can *look at*, not just query — and `cave report` renders **cited
markdown deliverables** from CAVE-Q templates. No build step, no
framework, no external resource of any kind: the page renders offline
and the server's CSP denies every non-self source.

Both surfaces apply the spec §9.7 ceiling (`public < internal < confidential <
restricted`) and default to `internal`; unlabeled claims are `internal`, while
malformed and unknown labels fail closed as `restricted`. Use
`--max-sensitivity <level>` (or `maxSensitivity` programmatically) to select a
different audience. Filtering happens before view semantics: dashboard counts,
aliases, history, search and lineage cannot disclose hidden rows indirectly,
and lineage edges survive only when both endpoints are visible.

```sh
cave serve --db k.db
# serving k.db at http://127.0.0.1:2283/ (sensitivity <= internal, read-only, ctrl-c to stop)

cave report --db k.db weekly.md > report.md
```

## The views (spec §30.2)

Every view renders semantics defined elsewhere in the spec — the
surface never reinterprets them:

- **dashboard** — the §20.2 coverage tiles and the frontier: shape
  violations, review candidates (conf 0.3–0.7), stale beliefs, alias
  disagreements — plus topics and the latest appends. Shape violations retain
  observed counts and units, so `#cardinality:one` and `#unit:<unit>` failures
  render as actionable mismatches rather than generic missing fields;
- **entity 360** — everything currently believed about one name:
  types, object-less facts, both relation directions (inverse names
  from the registry, §13.3), topics, the §13.6 alias closure on a
  toggle, and the raw activity feed underneath;
- **topic browse** — `CONTAINS` members (§11.2), each a link onward;
- **belief history** — the §9.1 series of any claim key as a timeline,
  confidence bars included; the last row is current belief, retraction
  and supersession visible instead of destroyed;
- **lineage** — the §13.2 edge table walked both ways from any row:
  *cites* answers "why is this believed" (`BECAUSE` premises, `VIA`
  rules, `WHEN` conditions), *cited by* answers "what depends on it";
  a row reached twice re-states without children (§28.4's convention),
  so §24.5 support cycles terminate; the walk is depth-capped and a
  node whose further edges the cap cut off is marked `truncated` — an
  incomplete explanation never renders as complete;
- **search** — the store's FTS5 over subjects, objects, values,
  comments and raw lines.

Claims render from *structured* row data (columns plus side tables),
never by re-parsing text — no second grammar exists to drift out of
sync — and every entity name, claim key and row id links onward, so
the whole store is reachable by clicking.

## Read-only, local (spec §30.3)

Only GET/HEAD are answered (anything else is 405), no endpoint writes,
and every request reads the live store — a running `cave automate`
loop's appends show on the next refresh. The server binds `127.0.0.1`
by default; `--host` widens deliberately (it shares the selected sensitivity
view, read-only). Sensitivity is routing metadata, not authentication or
encryption; a widened server still belongs behind an appropriate access layer.
Recording knowledge stays with `cave add`, the MCP tools
and the kinetic layer.

## Reports — cited deliverables (spec §31)

`cave report` turns a markdown template into a document whose every
stated fact traces back to the claim that supports it. Two live
constructs; everything else passes through verbatim:

````markdown
Revenue reached `cave-q: acme HAS revenue: ?v` this quarter.

## Service ownership

```cave-q
?svc HAS owner: ?who
- **?svc** is owned by ?who [^?]
```
````

A fenced `cave-q` block holds a CAVE-Q pattern (plus optional `WHERE`
lines) and a fragment rendered once per solution, `?var` bindings
substituted — without a fragment each solution renders as a cited
bullet. An inline `` `cave-q: …` `` splice — a code span of any
delimiter length, so `` ``cave-q: … `code` …`` `` works when the
pattern carries a backtick literal — takes exactly one variable
and one solution (several matches are a *problem*, and `--resolve` picks
the §26 winner — the fix when sources contest a fact). Every rendered
row cites: `[^cN]` markers land at the fragment's `[^?]` placeholder
(appended when absent), and the definitions — canonical line, tx date,
claim key — collect at the end of the document, so a reader can pull the
belief history behind any sentence. `--aliases`, `--as-of`, and `--at` compose
exactly as on `cave query`; `--at` filters valid-time claims and interpolates
trajectories while `--as-of` independently freezes transaction time. The
template stays under version control and
the report re-renders from current belief on demand.

## Programmatic

```ts
import { serve, report, overview, entity, history, lineage } from '@cavelang/view'

const handle = await serve(store, { port: 0, label: 'k.db', maxSensitivity: 'public' })
// handle.url → http://127.0.0.1:<port>/
await handle.close()

// the view models are plain functions over a store, no server needed
const dash = overview(store)
const gateway = entity(store, 'api-gateway', { aliases: true })
const { markdown, problems } = report(store, template, {
  maxSensitivity: 'confidential',
  resolve: true,
  asOf: '2026-01-15',
  at: '1962'
})
```

Endpoints: `/api/overview`, `/api/entity?name=`, `/api/topic?name=`,
`/api/history?key=`, `/api/lineage?id=`, `/api/search?q=` (`&aliases=1`
where the §13.6 closure applies).

Part of the [CAVE monorepo](../..); the specification lives in the
repository's `.claude/skills/` directory (spec §30 and §31 in
`cave-storage-query`).
