# @cavelang/view

The human read surface (spec §30): `cave serve` puts **one static,
self-contained HTML page** over a CAVE store — the graph as something
you can *look at*, not just query. No build step, no framework, no
external resource of any kind: the page renders offline and the
server's CSP denies every non-self source.

```sh
cave serve --db k.db
# serving k.db at http://127.0.0.1:2283/ (read-only, ctrl-c to stop)
```

## The views (spec §30.2)

Every view renders semantics defined elsewhere in the spec — the
surface never reinterprets them:

- **dashboard** — the §20.2 coverage tiles and the frontier: shape
  violations, review candidates (conf 0.3–0.7), stale beliefs, alias
  disagreements — plus topics and the latest appends;
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
  so §24.5 support cycles terminate;
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
by default; `--host` widens deliberately (it shares the whole store,
read-only). Recording knowledge stays with `cave add`, the MCP tools
and the kinetic layer.

## Programmatic

```ts
import { serve, overview, entity, history, lineage } from '@cavelang/view'

const handle = await serve(store, { port: 0, label: 'k.db' })
// handle.url → http://127.0.0.1:<port>/
await handle.close()

// the view models are plain functions over a store, no server needed
const dash = overview(store)
const gateway = entity(store, 'api-gateway', { aliases: true })
```

Endpoints: `/api/overview`, `/api/entity?name=`, `/api/topic?name=`,
`/api/history?key=`, `/api/lineage?id=`, `/api/search?q=` (`&aliases=1`
where the §13.6 closure applies).

Part of the [CAVE monorepo](../..); the specification lives in the
repository's `.claude/skills/` directory (spec §30 in
`cave-storage-query`).
