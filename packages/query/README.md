# @cavelang/query

CAVE-Q — the graph-pattern query layer (spec §12), compiled to SQL over an
open `@cavelang/store`.

Current-belief selection, transaction boundaries, and alias closure come from
the store's public `QuerySql` primitives; CAVE-Q adds pattern joins, filters,
resolution, transitive traversal, and result binding without redefining those
shared semantics.

Structured `match()` calls capture the declared slot, payload, context, tag and
filter fields before numeric detection or compilation. Fields at each pattern
position are read once into ordinary data, including inherited or non-enumerable properties, so
changing getters cannot select a different term at a later stage. Text queries
use their freshly parsed pattern directly.
Query and match options are captured once before historical vocabulary lookup,
SQL compilation and post-filtering. The same `asOf` boundary and row limit apply
throughout the operation even when supplied through changing getters.
Each query or structured match reads vocabulary and candidate claims within one
deferred SQLite snapshot, including source priorities with `resolve: true`.
A peer commit cannot combine old vocabulary or priorities with new claims in one result;
the next query sees the committed state. The snapshot nests inside caller-owned
transactions and sees their staged claims without committing them. Read and
snapshot-release failures preserve both errors and the original read cause.
`queryRecords()` captures its options before opening the read savepoint, so
adapter callbacks cannot replace its limit or historical boundary. It extends
the snapshot through claim/provenance record projection,
including transitive support rows. Concurrent appends or direct metadata changes
cannot mix selected rows with newer tags or provenance; the next call sees the
committed changes. A projection failure releases the read savepoint and retains
the thrown value without committing a caller-owned transaction. If releasing
that snapshot also throws, an `AggregateError` retains the projection failure
first in `errors` and as `cause`, followed by the release failure. Diagnostic
formatting tolerates thrown values that cannot be converted to text. After a
successful release, correcting the projection failure allows the same query to
retry inside the caller transaction; the caller still controls commit or rollback.
Lineage edges
are not embedded in these records. Calling `Record.of()` separately on previously
selected matches does not extend the original query snapshot; separate page
windows retain their pagination revision checks. Supported legacy provenance
backfill occurs during schema migration before the store is returned; read-only
opens reject an unmigrated schema. Reopening a current-schema database preserves
explicit empty provenance, and sync treats a present provenance table as
authoritative rather than filling its empty sets from claim contexts.
Empty provenance arrays are valid; empty-string entries are malformed.
If record projection encounters a malformed entry, correcting the stored evidence
allows a retry within the same caller transaction. Both the failed and successful
read leave the caller in control of committing or rolling back its staged claims.

Text queries reject unpaired UTF-16 surrogates with their one-based source line
before parsing. Structured patterns passed to `match` are checked before SQL
compilation as well, including slots, contexts, tags and filters. This prevents
SQLite's UTF-8 conversion from turning malformed input into a match for `�`.
Valid Unicode (including emoji), embedded NUL, and an explicitly authored `�`
remain queryable; failed reads leave stored history unchanged.

`query()`/`match()` expose storage rows for in-process reasoning engines. For
public JSON and durable integrations, use `queryRecords()`: every result is a
`cave.query-match/v1` carrying bindings plus optional `cave.claim/v1` claim or
transitive support records. `Record.of` captures the match's bindings, evidence
rows and interpolation fields once before projecting evidence. Later caller
mutation, including during evidence projection, cannot substitute those captured
values. These fields must contain structured-cloneable data.
Construction and decoding share the binding-map and interpolation checks below;
construction rejects malformed metadata or holes/non-object entries in supporting
rows before projecting any evidence.
Object inputs to `Record.decode` are captured before
metadata validation and their nested data is owned by the decoded result;
changing getters or later caller mutation cannot replace validated bindings or
interpolation values. Binding maps must still have a plain or null prototype.
Like claim-record decoding, object input must contain structured-cloneable data.
`Record.decode` verifies the version and all
nested claim records, including consistency of their scalar, trajectory and
uncertainty projections with raw value text. The same checks apply to direct
claim evidence and each supporting record. Optional interpolation metadata must contain a finite
numeric `num`, string `text`, and a string `unit` when supplied; malformed
metadata is rejected for both object and JSON input.
Bindings must be a plain object of string values (a null-prototype map is also
accepted). Boxed strings, dates, maps, sets, and class instances are rejected
rather than accepted with a different or lossy JSON representation.
Interpolation `num` retains the computed numeric precision, while `text` and
value-slot bindings use the trajectory formatter's four significant digits.
For example, a computed `549.995 req/s` is displayed and bound as `550 req/s`;
the record preserves `at.num: 549.995`. If display rounding would overflow,
the formatter keeps the finite unrounded value instead. Decoding preserves
the intentional rounding difference instead of requiring exact numeric equality
with `text`.
Supporting evidence must be a dense array of valid claim records. Array holes,
`undefined` and `null` entries are rejected; an empty support array is valid.
Object input is read by array index, matching JSON array contents; a custom
iterator cannot hide invalid entries or discard supporting evidence.

For interactive or remote reads, `page()` returns a bounded
`cave.query-page/v1` envelope. The first request freezes the maximum visible
transaction; pass its opaque `next` cursor back with the same pattern,
options, and limit to continue. Later local appends are excluded, while a new
first page sees them. Alias resolution uses that same frozen boundary: a later
alias retraction from another connection does not change direct or transitive
continuation results. A fresh first page sees the retraction and new claims.
Later value revisions and retractions also leave an existing continuation's
claims unchanged, including exact-number filtered pages. Reusing the same cursor
with the same options returns the same page while that historical snapshot stays
valid; reading a cursor does not consume it.
If sync adds older rows or lineage touching the cutoff,
continuation fails with a restart instruction instead of repeating or skipping
results. The default page size is 100 and
the maximum is 1,000. Defaults apply only when the limit is omitted or
undefined; explicit null is invalid on both first and continuation requests.
Correcting an invalid limit allows reuse of the original cursor. `query()` and `queryRecords()` remain unbounded for
in-process callers that explicitly want the complete result. When supplying a
SQL `limit`, use a positive safe integer; its `offset` must be a non-negative
safe integer. An omitted or undefined offset defaults to zero; explicit null
is invalid when a limit is supplied. Values beyond `Number.MAX_SAFE_INTEGER` are rejected before SQL
binding, avoiding rounded bounds and adapter-dependent errors.

Result bindings are ordinary objects with an own property for each bound
variable. Names such as `__proto__`, `constructor` and `toString` retain their
values, including in transitive results and JSON serialization.

```ts
import { open } from '@cavelang/store'
import { page, query } from '@cavelang/query'

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

const first = page(store, '?x USES jwt', { limit: 50 })
const second = first.next === undefined ? undefined :
  page(store, '?x USES jwt', { limit: 50, cursor: first.next })
```

## Pattern language (§12.1)

- `?name` variables bind subject, verb, object or attribute value;
  a variable repeated in two positions forces equality (`?x NEEDS ?x`).
  A bare `?` is invalid: supply a name, or use `_` for a wildcard.
  Programmatic `match` patterns also require a non-empty variable `name`.
- `_` is a wildcard.
- `attr: ?v` matches attribute claims.
- `@ctx` and `#tag[:value]` on the pattern line filter contexts/tags
  (flat `#tag` matches flat tags only, mirroring `store.byTag`).
  Every requested context and tag must be present. Lists of up to 16 items use
  direct indexed predicates; larger lists use one bound JSON array each. This
  bounds SQL expression depth and parameter count from metadata lists while
  retaining the direct lookup path for ordinary queries. Native SQLite and the
  playground's SQLite WASM have regressions
  with 1,500 contexts and 1,500 tags, including missing-item rejection; Unicode
  and embedded NUL suffixes retain exact matching. This does not impose a general
  query-size budget.
- `VERB NOT` matches negated claims; patterns without `NOT` match
  positive ones — direction is always explicit.
- **Inverse verbs** are valid: `?x PART-OF monorepo` compiles to
  `verb = 'CONTAINS' AND subject = 'monorepo'` with `?x` binding on the
  object side — the same physical query as the forward pattern.
- **Lifecycle spellings** are interchangeable after their declaration:
  with `WORKS-AT RENAMED-TO EMPLOYED-BY`, patterns using either name compile
  to the stable `WORKS-AT` storage verb. `asOf` reconstructs the registry at
  the same boundary, so the replacement is unknown before its declaration.
- `VERB+` is transitive (one or more hops), compiled to a recursive CTE
  over current, positive, non-retracted edges. Reachable endpoint pairs are
  deduplicated as the recursion runs, so cycles terminate at a finite fixed
  point and paths are not silently truncated at a hop limit.
  A concrete subject seeds forward recursion; when only the object is
  concrete, recursion runs backwards from it. Fully unbound patterns retain
  the complete all-pairs closure. Supporting edge ids propagate through the
  same seeded direction when `{ support: true }` is requested.
  Transitive works through inverses too (`packages/api PART-OF+ ?c` walks
  `CONTAINS` upward from the object side).

## Filters (§12.2)

Filter diagnostics use one-based line numbers from the original query text.
Blank and full-line comment lines count toward the location even though they
are ignored when parsing; LF and CRLF inputs use the same numbering.
Numeric confidence thresholds must be finite; `NaN`, infinities, and exponent
overflow are parse errors. Finite thresholds outside the stored confidence range
remain valid comparisons, such as `WHERE conf > 1` matching no claims.

Up to 16 `WHERE` filters compile to direct predicates. Longer lists group
operands by predicate shape into bound JSON arrays, keeping SQL expression
depth and parameter count bounded by the supported filter forms. Every filter
must still hold, including comparisons against missing numeric values or units,
which reject the row. Native SQLite and SQLite WASM regressions exercise 33,000
filters, mixed requirements, metadata and numeric/transaction comparisons.
The full query and operand arrays remain in memory; this is not a general
query-size or execution-time budget.

```
WHERE conf >= 0.8        (also accepts 80%)
WHERE tag = security     (bare key matches any value; topic:auth is exact)
WHERE context = production
WHERE value > 1000 req/s (numeric column; unit equality when given)
WHERE tx > 2026-01-01    (date-like values are whole UTC periods)
WHERE tx <= 2026-01-01T12:00:00 (offset-less timestamps mean UTC)
```

`tx` filters compile a date-like value to its UTC period in UUIDv7 space:
`=` means "recorded in that period", `<=` includes the boundary period that
`<` excludes, and `>` starts after it. A timestamp value covers one second.
An explicit `Z` or numeric offset is honored; a timestamp without either is
UTC, so `2026-01-01T12:00:00` equals `2026-01-01T12:00:00Z` on every host.
Transaction periods before the UUID epoch (1970-01-01T00:00:00Z) are empty;
`asOf` and `tx` comparisons accept those dates without attempting a negative
UUID timestamp. Periods crossing the epoch retain their nonnegative portion.
Valid-time `at` remains independent and can select claims about earlier dates.

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
- Transitive recursion has no CAVE hop limit and never returns a silently
  partial closure. It reaches a fixed point after at most the finite set of
  endpoint pairs (quadratic in the number of participating entities); if the
  SQLite runtime cannot complete that work, the query fails instead of
  presenting a truncated result as complete.
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
  Values, attribute names and verbs are not entities. Verbs resolve through
  their separate `RENAMED-TO` lifecycle registry (§5.8).
- **`{ asOf }` resolves beliefs as of a past moment** (§12.3): only rows
  recorded up to the boundary participate, then resolution proceeds as
  usual — so a claim retracted later is still believed at the boundary,
  and one first recorded later is unknown. The boundary is a date-like value
  (whole UTC period included), a timestamp (whole second included), or a
  transaction id (that append included). The alias closure and transitive
  hops reconstruct at the same instant; `{ all: true }` composes as
  full-history-up-to-the-boundary.
  Qualifier parents obey the same boundary as declarations: later `WHEN`,
  `VIA`, or `BECAUSE` parents cannot remove vocabulary from an earlier query.
- **`{ at }` anchors valid time** (§32.4): timeless claims always remain
  visible; date-like contexts and ranges must cover the selected instant; and
  a trajectory value such as `200 -> 900 PLN/mo @1950..1974` is returned with
  its exact interpolated value. It composes with `asOf`: transaction time
  selects what was believed, while valid time selects when that belief applies.
  Finite trajectory endpoints remain finite during interpolation even when
  their difference would overflow, and endpoint instants retain endpoint values.
  Multiple range contexts, including a closed range combined with an open
  range, leave the trajectory textual. Valid-time coverage still uses the
  normal union of time contexts.
- **`{ resolve: true }` matches resolved winners only** (§26): coexisting
  series about one fact — §9.5 actor stamps, content sources, opposite
  polarity — collapse to the row the resolution policy picks (precedence
  class, reliability-weighted confidence, tx), so a positive pattern
  whose fact resolved to a negated winner matches nothing and transitive
  hops walk only winning edges. Composes with `aliases` (groups widen
  through the closure) and `asOf` (candidates and the in-band policy
  declarations reconstruct at the boundary); incompatible with
  `{ all: true }`, which asks for the unresolved history.
- **Pagination is deterministic and transaction-snapshot stable.** SQL applies
  `LIMIT`/`OFFSET` after the query's stable transaction or endpoint ordering,
  and every continuation pins `asOf` to the first page's maximum transaction.
  Cursors are scoped to the exact pattern, options, and page size. Each page
  reads the declared option fields once, including inherited or non-enumerable
  values, so snapshot selection, execution and cursor identity use the same
  values even when supplied through getters. Query syntax
  and option compatibility are validated even when the store or requested
  historical snapshot is empty. Valid-time
  coverage and exact numeric approximation checks run after row selection, so
  those pages read candidate batches capped at the scan budget. An internal
  row-position index preserves each match's original offset through both
  post-filters. A full page resumes immediately after its last returned match,
  leaving later fetched candidates for the next call. A heavily filtered page can therefore
  contain fewer than its requested limit (including zero) while still carrying
  `next`; following it continues from the bounded scan frontier.
  Each page materializes its selected records within a read snapshot, including
  all numeric/valid-time candidate batches and their tag/provenance projection.
  Metadata changed by a peer during projection appears on the next call.
  Projection failure releases the page snapshot without committing a caller
  transaction; if release also throws, the aggregate retains the projection
  failure first and as its cause.
  Each page checks an append-only revision before and after its reads: row count
  and local rowid tail below the cutoff, plus edge count and tail for lineage
  touching either side of that historical row set. Changes reject the page
  with `pagination snapshot changed; restart from the first page`. Wholly
  future rows and edges remain compatible. Revision tokens do not detect direct
  metadata edits between separate page calls. The cursor is database-local;
  its internal encoding is version 2 (the public page envelope remains v1).
  Older or malformed tokens also require a restart. Rejecting a malformed token
  does not mutate the store or invalidate an otherwise valid continuation.
  This contract relies on
  immutable stored claims and side metadata; arbitrary raw SQL rewrites are
  outside the append-only pagination contract.

Live connections refresh vocabulary after another SQLite connection commits.
`store.registry()`, query compilation, and inverse reads therefore see new
verb and lifecycle declarations without reopening or writing. The read path
works on read-only connections and reuses its registry cache while SQLite's
data-version counter is unchanged. Raw SQL writes on the same connection still
require `reloadRegistry`; precompiled SQL retains their supplied vocabulary.

## Tests

```
pnpm --filter @cavelang/query test
pnpm --filter @cavelang/query bench:transitive
```

Every §12.1 example pattern and every §12.2 filter runs against a live
in-memory store, including inverse and transitive-inverse cases,
current-vs-history semantics, negated patterns, long paths across the former
32-hop boundary, cycle-safe closure, the §13.6 alias
closure (term widening, transitive hops across aliases, unmerge by
retraction, value/attribute exemption), §12.3 as-of resolution
(tx/date/timestamp boundaries, later retraction, as-of alias closure
and transitive edges) and §26 winners-only matching (ingest re-runs vs
human corrections, polarity suppression, reliability steering,
resolved transitive paths, composition with aliases and as-of).
Valid-time coverage, bitemporal composition, and trajectory interpolation are
covered by the temporal query tests.

The deterministic transitive benchmark emits NDJSON timings and result counts
for a chain, a branching tree, and a cycle, comparing a source-seeded query
with the corresponding unbound all-pairs workload. Plan tests additionally
assert forward/reverse seed shape and SQLite object-index use.

## Pagination benchmark

`pnpm bench:pagination` measures first-page valid-time and exact-number queries
against 1,000 and 10,000 claims, with a page limit of 100 and all candidates
passing the post-filter. A selective valid-time fixture uses a one-result page
with 99 expired candidates before each matching claim. First-page measurements
report five samples and their median. Each fixture also follows every cursor
in three full traversals, reporting page and match counts plus the median.
Node, SQLite and platform versions accompany the output. Completeness, ordering,
constant snapshot and termination checks run outside the timing interval.
The store is populated before timing, so these are repeated in-process reads,
not CLI startup measurements or fixed CI latency gates.

On macOS arm64 with Node 26.5.0 and SQLite 3.53.3, batching changed the median
first-page times as follows:

| Rows | Valid-time before / after | Exact-number before / after |
|---|---|---|
| 1,000 | 116.54 / 4.71 ms | 116.49 / 4.20 ms |
| 10,000 | 1,079.97 / 24.39 ms | 1,093.66 / 25.06 ms |

The scan budget and continuation semantics stay unchanged. The selective
one-result fixture initially measured 113.75 ms at 1,000 rows and 1,068.77 ms at
10,000 rows. Tracking original row positions now permits larger candidate reads
even for that small match limit; medians fell to 2.87 ms and 22.95 ms respectively.
The internal position index is allocated only for filtered page reads and never
appears in query records or continuation tokens.

A historical-vocabulary cache was trialled and removed before this change
because its 10,000-row selective median remained about 1.07 seconds. Reducing
repeated SQL reads provided the measurable improvement. Results are not fixed
latency guarantees.

With the row-position implementation, three-sample full-traversal medians on the
same runtime were:

| Claims | Pages | Valid-time (all matches) | Exact-number (all matches) | Selective valid-time |
|---|---|---|---|---|
| 1,000 | 10 | 47.53 ms / 1,000 matches | 44.75 ms / 1,000 matches | 30.75 ms / 10 matches |
| 10,000 | 100 | 2,887.18 ms / 10,000 matches | 2,889.77 ms / 10,000 matches | 2,739.98 ms / 100 matches |

Traversal timing includes following cursors and retaining page results; assertions
run afterward. The fixture uses immutable in-memory data and does not model
concurrent ingestion, HTTP transport or a streaming consumer's memory use.
Increasing the fixture tenfold increased total traversal time much more than
tenfold. First-page latency therefore does not establish full-scan scalability;
repeated snapshot checks and offset-based SQL remain costs to assess for larger
workloads.

### Current-runtime pagination baseline

Sequential reruns of the unchanged fixtures on macOS arm64 with SQLite 3.53.4
retain first-page and full-traversal samples in
[`benchmarks/pagination-current-review.json`](../../benchmarks/pagination-current-review.json).
At 10,000 claims, the medians were:

| Query | Node 24.21.0 first page / traversal | Node 26.8.1 first page / traversal |
|---|---|---|
| Valid-time | 25.33 ms / 3.146 s | 25.50 ms / 3.109 s |
| Exact-number | 25.25 ms / 3.210 s | 25.09 ms / 3.114 s |
| Selective valid-time | 22.18 ms / 2.772 s | 22.13 ms / 2.746 s |

These are current baselines, not before/after optimization measurements. Each
first-page median uses five samples and each traversal median uses three; the
benchmark has no separate untimed warmup. All ordering, completeness, snapshot
and termination assertions passed. Full traversal still costs substantially more
than a first page. Before changing cursor semantics or introducing caches,
measure time spent in SQL windows, snapshot revision checks and record projection
separately. Any optimization must retain rejection of historical arrivals and
new lineage touching the snapshot, while accepting wholly future appends.

### Pagination cost attribution

Run `node --disable-warning=ExperimentalWarning scripts/pagination-profile.mjs`
alone for diagnostic attribution. Each 1,000/10,000-row fixture traverses once
without instrumentation, then once with synchronous method timers. It compares
complete results and checks order, termination, the fixed snapshot and unchanged
history outside timing. These are single diagnostic runs in a fixed order, not
latency medians or an estimate of instrumentation overhead. Original store methods
retain their own database, so their internal SQL is charged to vocabulary or
projection rather than counted again in the SQL categories. Unassigned time
includes other JavaScript work and instrumentation overhead.

[Raw profiles](../../benchmarks/pagination-profile-review.json) include runtime
versions, source hashes, method counts, category times and the plain traversals.
At 10,000 claims on macOS arm64 / SQLite 3.53.4:

| Query | Node 24.21.0 SQL windows / total | Node 26.8.1 SQL windows / total |
|---|---|---|
| Valid-time | 2.698 / 3.128 s | 2.663 / 3.085 s |
| Exact-number | 2.794 / 3.209 s | 2.700 / 3.093 s |
| Selective valid-time | 2.675 / 2.783 s | 2.664 / 2.779 s |

SQL windows dominated these pre-optimization profiles. Snapshot revision checks take under 43 ms
per traversal and historical vocabulary under 9 ms; caching either is therefore
unlikely to remove most of this fixture's cost. This motivated the bounded tuple-membership optimization below, retaining the
existing snapshot checks. Compare any
candidate on revised claim histories as well as one-row-per-key fixtures: a
faster query must not revive a superseded or retracted belief. The profile does
not identify which part of SQLite execution dominates or establish a general
query-performance guarantee.

### Current-belief SQL comparison

`node scripts/current-query-bench.mjs` compares the production grouped latest-row
join with a read-only experimental correlated `MAX(tx)` lookup. Both use 10,000
historical rows and issue 100 SQL requests of 100 rows. With 10,000 current keys,
the requests traverse 100 pages; with 100 current keys, they repeat the single
current page. Three samples, execution plans and runtime versions are reported.
Row identities must agree across both alternatives; assertions run after timing.
This isolates SQL selection and does not include semantic record construction,
valid-time filtering or pagination revision checks.

On the runtime above, medians were:

| Current keys | Grouped production SQL | Correlated alternative |
|---|---|---|
| 10,000 | 844.81 ms | 517.86 ms |
| 100 | 381.47 ms | 518.86 ms |

The alternative improves the all-distinct fixture but regresses the fixture with
many revisions per key, so it is not used as a blanket replacement. Both plans
still sort results for transaction ordering. Future query-plan changes should
cover both history distributions and preserve historical boundaries and latest
row semantics before replacing the shared store fragment.


### Late full-row fetch trial

`node --disable-warning=ExperimentalWarning scripts/pagination-row-width-bench.mjs`
compares full-row sorting with selecting ordered page IDs first and fetching
complete rows afterward. Both keep the same grouped latest-belief selection and
historical boundary. Each fixture has 10,000 historical rows and issues 100
requests of 100 rows, traversing distinct keys or repeatedly reading one page
of heavily revised keys. Three timed samples alternate variant order, with full
row equality and page-size assertions outside timing; there is no separate
warmup. [Raw results and plans](../../benchmarks/pagination-row-width-review.json)
retain SQL and runtime metadata.

On macOS arm64 with SQLite 3.53.4, medians were:

| Current keys | Node 24.21.0 full / late fetch | Node 26.8.1 full / late fetch |
|---|---|---|
| 10,000 | 1078.14 / 945.02 ms | 1056.83 / 880.51 ms |
| 100 | 405.61 / 421.93 ms | 404.55 / 403.53 ms |

The distinct-key fixture improves by about 12–17%, but the revised-key fixture
is about 4% slower on Node 24 and nearly unchanged on Node 26. This is not enough
evidence for a blanket production replacement. The trial remains read-only
experimental SQL; it does not change query execution or cursor formats. It also
omits record projection, valid-time post-filtering and snapshot revision checks,
so its timings are not end-to-end page latencies. Further trials should target
repeated selection work without sacrificing revised-history behavior.

### Current-row join plan trial

`node --disable-warning=ExperimentalWarning scripts/current-join-bench.mjs`
retains both transaction and claim-key equality checks, but adds unary plus to
the outer claim-key expression. The experiment uses the same two history
fixtures and three alternating-order samples as the row-width trial above.
Complete returned rows must agree. On Node 24.21.0 and 26.8.1 with SQLite 3.53.4,
the query plan remained unchanged: SQLite still looked up grouped latest rows
through an automatic claim-key index. This did not establish a speedup.

`--plans-only` inspects a second variant with unary plus on both claim-key
expressions without timing or executing it. It loses the automatic lookup and
scans the grouped rows repeatedly. A Node 24 timing attempt was interrupted
with SIGINT after becoming substantially slower; no completed timing is claimed
for that attempt. [Raw completed samples and plans](../../benchmarks/current-join-review.json)
retain the evidence from both runtimes. Neither experiment changes production
SQL. Do not simply drop the claim-key check: the SQL schema indexes transaction
IDs but does not declare them unique, and structural schema validation does not
validate every stored row's identity. A read-plan optimization must preserve the
existing join semantics instead of assuming stronger physical constraints.

### Bounded tuple-membership selection

Bounded, unresolved direct queries now select current rows using membership in
`(claim_key, MAX(tx))` pairs. Both identity columns and the complete historical
source remain part of selection, so filtering a page cannot revive an older or
retracted belief. Unbounded, resolved and transitive plans retain their existing
selection strategy. Snapshot revision checks, ordering, scan budgets and cursor
formats are unchanged.

`node --disable-warning=ExperimentalWarning scripts/current-membership-bench.mjs`
compares the former join and tuple membership on the same distinct/revised-key
SQL fixtures used above, with three alternating-order samples and full-row
comparison outside timing. Membership improves both distributions on Node 24.21.0
and 26.8.1. Sequential end-to-end reruns of `scripts/pagination-bench.mjs` also
pass every traversal assertion. At 10,000 claims on macOS arm64 / SQLite 3.53.4:

| Traversal | Node 24.21.0 before → after | Node 26.8.1 before → after |
|---|---|---|
| Valid-time | 3.146 → 2.561 s | 3.109 → 2.587 s |
| Exact-number | 3.210 → 2.541 s | 3.114 → 2.611 s |
| Selective valid-time | 2.772 → 2.239 s | 2.746 → 2.239 s |

[Raw controls and before/after samples](../../benchmarks/pagination-membership-review.json)
retain the three-sample traversal and five-sample first-page measurements.
These gains apply to the recorded in-memory workloads, not every query or
adapter. Regression tests compare bounded and unbounded results across historical
boundaries, numeric filters, retractions and reactivation; existing tests retain
alias, pagination revision, resolved and transitive coverage. Full traversal
still repeats selection and offset work, so this is not a general scan-cost bound.

## Query read-snapshot trial

Run `node --disable-warning=ExperimentalWarning scripts/query-snapshot-bench.mjs`
alone. It queries `?item IS service` with `limit: 1` over 100 and 1,000 current
claims, in memory and through a read-only WAL connection, both outside and inside
a caller read transaction. Each result is a median of five batches of 20 calls,
after one warm-up call. Setup, transaction entry/exit and result assertions are
outside the timing. Resolved queries are included as a control: they already
used snapshots before ordinary matching gained the same consistency guarantee.

On macOS arm64, the following ordinary-query medians compare the preceding
resolved-only snapshot path with snapshots around all matching. The baseline was
measured by temporarily restoring the previous conditional path; the script
itself always measures the checked-out implementation and has no unsafe mode.

| Claims | Database | Caller transaction | Node 24 before → after | Node 26 before → after |
|---|---|---|---|---|
| 100 | memory | no | 0.172 → 0.174 ms | 0.173 → 0.180 ms |
| 100 | memory | yes | 0.167 → 0.167 ms | 0.172 → 0.165 ms |
| 100 | wal-read-only | no | 0.168 → 0.167 ms | 0.173 → 0.167 ms |
| 100 | wal-read-only | yes | 0.167 → 0.169 ms | 0.160 → 0.161 ms |
| 1,000 | memory | no | 1.058 → 1.043 ms | 1.045 → 1.042 ms |
| 1,000 | memory | yes | 1.061 → 1.042 ms | 1.062 → 1.048 ms |
| 1,000 | wal-read-only | no | 1.041 → 1.061 ms | 1.080 → 1.063 ms |
| 1,000 | wal-read-only | yes | 1.051 → 1.062 ms | 1.090 → 1.042 ms |

Runtime versions were Node 24.16.0 and 26.5.0. Resolved control medians ranged
from 1.080–1.139 ms at 100 claims and 5.758–6.410 ms at 1,000 claims across both
runs. The small before/after differences do not isolate a reliable savepoint
cost or establish a speedup. Baseline runs preceded final runs, so cache and
execution-order effects remain possible. These fixtures do not bound large-graph
costs, contention, transitive queries, or WASM performance. Snapshot correctness
is established by the separate concurrent-writer regressions, not these timings.


## Structured-record projection trial

Run `node --disable-warning=ExperimentalWarning scripts/query-record-bench.mjs`
alone. It returns 100 or 1,000 records for `?item IS service`, with either no
metadata or three contexts, three tags and source provenance. Memory and read-only
WAL stores are exercised outside and inside a caller read transaction. Each
median uses five batches of three calls after one warm-up. Setup, transaction
entry/exit, full record decoding and result equality checks are untimed.
Raw reports include Node launch arguments and selected source-file SHA-256 hashes
captured before the workloads. Launch arguments identify an enabled `--import`
baseline loader. Hashes describe the on-disk inputs, including the loader files;
the guarded loaders describe their in-memory transformations. This is selected
source provenance, not a complete dependency or machine-environment fingerprint.

The [paired measurements](../../benchmarks/query-record-validation-review.json)
compare the earlier reviewed implementation with a
[benchmark-only loader](../../benchmarks/query-record-baseline.mjs) that omits
record-construction identity/key guards and the outer projection snapshot. The
loader checks its source replacements and does not edit runtime files. The
historical loader is tied to the source hashes in that artifact and now rejects
the changed constructor. Use the capture comparison below for the current source.

For 1,000 returned records on macOS arm64, medians were:

| Metadata | Database | Caller transaction | Node 24.21.0 before → reviewed | Node 26.8.1 before → reviewed |
|---|---|---|---|---|
| none | memory | no | 14.77 → 16.60 ms | 15.02 → 16.67 ms |
| none | memory | yes | 13.37 → 15.24 ms | 14.95 → 15.79 ms |
| none | read-only WAL | no | 17.59 → 15.74 ms | 17.71 → 15.95 ms |
| none | read-only WAL | yes | 13.11 → 15.21 ms | 14.92 → 15.18 ms |
| populated | memory | no | 32.73 → 33.67 ms | 31.17 → 32.26 ms |
| populated | memory | yes | 32.49 → 33.19 ms | 30.95 → 32.21 ms |
| populated | read-only WAL | no | 38.69 → 33.12 ms | 36.41 → 37.28 ms |
| populated | read-only WAL | yes | 32.22 → 33.32 ms | 32.31 → 36.28 ms |

This combined comparison does not isolate the cost of a particular guard or
savepoint. Baselines preceded current runs, so cache and run-order effects can
explain some differences; faster cases do not establish a speedup. These results
do not justify weakening consistency checks. They do not bound large graphs,
transitive support, malformed-data handling, HTTP or browser performance. The
artifact retains all 100-record cases, raw samples and source hashes.

A [later capture trial](../../benchmarks/query-record-capture-review.json) measures
claim and provenance capture plus provenance validation with identity guards and
query snapshots retained on both paths. Its guarded
[baseline loader](../../benchmarks/query-record-capture-baseline.mjs) is enabled
with `--import ./benchmarks/query-record-capture-baseline.mjs`. The same 16 cases
and untimed correctness checks apply. Baseline and current runs were sequential
on Node 24, then Node 26, without concurrent builds or tests.

For 1,000 returned records, current median ranges across memory/WAL and caller
transaction settings were:

| Metadata | Node 24.21.0 | Node 26.8.1 |
|---|---|---|
| none | 21.07–23.27 ms | 20.98–21.35 ms |
| populated | 40.23–41.42 ms | 40.33–41.50 ms |

On Node 24, the capture boundary added roughly 6–9 ms in most 1,000-record cases.
One Node 26 baseline case was anomalously slow; its apparent improvement is not
interpreted as a speedup. An additional trial combining both captures into one
`structuredClone` call showed no consistent benefit and was not retained. All
samples and the trial's source hash are preserved in the artifact. These local
measurements support keeping the ownership guarantees, not a general latency
bound or an independently measured cost for each validation step.

The [query-match capture trial](../../benchmarks/query-match-capture-review.json)
isolates the later `Query.Record.of` capture and metadata validation boundary
while retaining nested claim/provenance capture and query snapshots. Its guarded
[baseline loader](../../benchmarks/query-match-baseline.mjs) uses
`--import ./benchmarks/query-match-baseline.mjs` with the same benchmark command.
Sequential before/current runs on Node 24 and then Node 26 passed all equality
and decode assertions. For 1,000 direct records, current median ranges were:

| Metadata | Node 24.21.0 | Node 26.8.1 |
|---|---|---|
| none | 22.15–24.38 ms | 22.81–24.29 ms |
| populated | 43.39–43.89 ms | 42.15–43.02 ms |

The observed increment was 0.3–3.4 ms per 1,000 records across these cases.
The artifact retains raw samples, commands and source hashes. These are direct,
non-interpolated matches; dense transitive support and interpolation need separate
measurements. One local paired trial does not establish a latency guarantee or
separate the cost of capture from metadata validation.
