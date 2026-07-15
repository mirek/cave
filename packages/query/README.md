# @cavelang/query

CAVE-Q — the graph-pattern query layer (spec §12), compiled to SQL over an
open `@cavelang/store`.

```ts
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'

const store = open('knowledge.db')
query(store, '?x USES jwt')
// → [{ bindings: { x: 'auth/middleware' }, row: { … } }, …]

query(store, `?cause CAUSE app/crash
  WHERE conf >= 0.7`)

query(store, '?x PART-OF monorepo')     // inverse verb → same physical query
query(store, 'terrier EXTENDS+ animal') // transitive

query(store, '?x USES postgres', { aliases: true }) // + rows about aliased names (§13.6)
query(store, 'server IS compromised', { asOf: '2026-01-15' }) // belief state at a past moment (§12.3)
query(store, 'mill/wage IS', { at: '1962' }) // valid-time filtering + trajectory interpolation (§32.4)
query(store, 'service HAS owner: ?who', { resolve: true }) // §26 winners only — one row per contested fact
```

## Pattern language (§12.1)

- `?name` variables bind subject, verb, object or attribute value;
  a variable repeated in two positions forces equality (`?x NEEDS ?x`).
- `_` is a wildcard.
- `attr: ?v` matches attribute claims.
- `@ctx` and `#tag[:value]` on the pattern line filter contexts/tags
  (flat `#tag` matches flat tags only, mirroring `store.byTag`).
- `VERB NOT` matches negated claims; patterns without `NOT` match
  positive ones — direction is always explicit.
- **Inverse verbs** are valid: `?x PART-OF monorepo` compiles to
  `verb = 'CONTAINS' AND subject = 'monorepo'` with `?x` binding on the
  object side — the same physical query as the forward pattern.
- `VERB+` is transitive (one or more hops), compiled to a recursive CTE
  over current, positive, non-retracted edges, depth-capped at 32.
  Transitive works through inverses too (`packages/api PART-OF+ ?c` walks
  `CONTAINS` upward from the object side).

## Filters (§12.2)

```
WHERE conf >= 0.8        (also accepts 80%)
WHERE tag = security     (bare key matches any value; topic:auth is exact)
WHERE context = production
WHERE value > 1000 req/s (numeric column; unit equality when given)
WHERE tx > 2026-01-01    (dates are whole-day UTC intervals)
```

`tx` filters compile a date to the interval `[day-start, next-day-start)`
in UUIDv7 space: `=` means "recorded that day", `<=` includes the boundary
day that `<` excludes, and `>` starts the day after. A timestamp value
covers one second.

## Semantics

- Queries run over **current beliefs** (latest tx per claim key, §9.1) by
  default, and skip retracted (`@ 0%`) ones — a retracted claim has no
  current support (§9.3), and `VERB` must agree with `VERB+` on a one-hop
  path. An explicit `WHERE conf …` filter or `{ all: true }` opts back in.
- Object-position variables bind relational rows only (`object IS NOT
  NULL`) — `?x ?verb ?y` enumerates the relation graph, not attributes. A
  *bound* date/number object additionally matches metric rows
  (`latency IS 30ms` the pattern finds `latency IS 30ms` the claim).
- A repeated variable forces equality in transitive patterns too:
  `?x EXTENDS+ ?x` finds nodes on cycles, not every reachable pair.
- Transitive patterns support endpoint slots only; tag/context/WHERE
  filters on them are rejected rather than silently ignored.
- **`{ support: true }` attaches supporting edge rows to transitive
  matches**: `match.rows` lists the visible positive edges of the verb
  on some path between the matched endpoints (`match.row` stays absent;
  alias links widen the paths under `aliases` but are not edges
  themselves). Off by default — the support join costs more than pair
  enumeration. `@cavelang/automate` opts in so a trigger solution's
  event test can see which edge rows it stands on (spec §29.2).
- **`{ aliases: true }` resolves entity terms through the alias closure**
  (§13.6): current positive `ALIAS` claims as undirected edges. Matching
  widens — bound terms match aliased spellings, repeated variables compare
  alias-equal, transitive hops cross alias links — while bindings and rows
  keep stored names untouched (union-of-rows, never silent merging). The
  closure always reads current beliefs, even under `{ all: true }`.
  Values, attribute names and verbs are not entities and never resolve.
- **`{ asOf }` resolves beliefs as of a past moment** (§12.3): only rows
  recorded up to the boundary participate, then resolution proceeds as
  usual — so a claim retracted later is still believed at the boundary,
  and one first recorded later is unknown. The boundary is a date (whole
  UTC day included), a timestamp (whole second included), or a
  transaction id (that append included). The alias closure and transitive
  hops reconstruct at the same instant; `{ all: true }` composes as
  full-history-up-to-the-boundary.
- **`{ at }` anchors valid time** (§32.4): timeless claims always remain
  visible; date-like contexts and ranges must cover the selected instant; and
  a trajectory value such as `200 -> 900 PLN/mo @1950..1974` is returned with
  its exact interpolated value. It composes with `asOf`: transaction time
  selects what was believed, while valid time selects when that belief applies.
- **`{ resolve: true }` matches resolved winners only** (§26): coexisting
  series about one fact — §9.5 actor stamps, content sources, opposite
  polarity — collapse to the row the resolution policy picks (precedence
  class, reliability-weighted confidence, tx), so a positive pattern
  whose fact resolved to a negated winner matches nothing and transitive
  hops walk only winning edges. Composes with `aliases` (groups widen
  through the closure) and `asOf` (candidates and the in-band policy
  declarations reconstruct at the boundary); incompatible with
  `{ all: true }`, which asks for the unresolved history.

## Tests

```
pnpm --filter @cavelang/query test
```

Every §12.1 example pattern and every §12.2 filter runs against a live
in-memory store, including inverse and transitive-inverse cases,
current-vs-history semantics, negated patterns, the §13.6 alias
closure (term widening, transitive hops across aliases, unmerge by
retraction, value/attribute exemption), §12.3 as-of resolution
(tx/date/timestamp boundaries, later retraction, as-of alias closure
and transitive edges) and §26 winners-only matching (ingest re-runs vs
human corrections, polarity suppression, reliability steering,
resolved transitive paths, composition with aliases and as-of).
Valid-time coverage, bitemporal composition, and trajectory interpolation are
covered by the temporal query tests.
