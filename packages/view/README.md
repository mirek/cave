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

Programmatic viewer and report APIs require a recognized `maxSensitivity`:
`public`, `internal`, `confidential` or `restricted`. Only omission selects the
default `internal` ceiling. Invalid values, including `null`, fail before
database reads or projections, so configuration errors cannot masquerade as
empty results.

A running HTTP server keeps the ceiling chosen at startup; request query parameters cannot
widen it. Start a server with the intended ceiling to serve a different audience.
Entity, topic, overview, history and lineage reads for narrower audiences
reuse an immutable, indexed projection for each source store and sensitivity
ceiling instead of copying visible rows on every request. A local append or a
commit from another database connection invalidates the affected projection
before the next read; changing the ceiling selects a separate projection.
If source commits repeatedly invalidate a rebuild, four attempts are allowed
before the read fails with `source changed continuously`. Each discarded
candidate is closed; the read does not fall back to a stale cached projection.
Retry after writes settle to build from the updated source with the same
sensitivity ceiling.
An unpublished projection is closed if the final source-revision check fails
or requests a retry. If copying or the final revision check fails and closing
the unpublished database also fails, both errors are preserved with the original
failure first and as cause. Such a candidate is never published. The previous
cached projection remains owned by the cache,
and a later successful read can replace it normally.
Once a fresh projection is published, failure while closing the retired
projection is reported before the read callback runs. The fresh projection
stays cached: a retry uses the updated visible data without rebuilding or
retrying the retired projection's cleanup callbacks. Source closure still
closes the replacement.
Programmatic search captures its sensitivity ceiling once so claim selection
and linked-evidence counts use the same audience even when options have getters.
Entity views likewise capture the sensitivity ceiling, alias setting and activity
limit before reading, so facts, relationships and activity share one configuration.
Each new call captures the caller's current settings again.
Entity fact selection uses the store's recursive alias closure with one bound
name, so large alias groups do not exceed SQLite's parameter limit. A
33,000-alias regression checks remote facts, unrelated-name exclusion and the
single-name view. The response still includes the complete alias group and
relationships; this does not impose a result-size or memory budget.
Topic membership reads also capture their alias setting before projection work,
so adapter callbacks cannot change the scope of an in-progress response.
The entity activity limit must be a non-negative safe integer (default 30).
Zero hides the activity rows while retaining the total and other entity sections.
Invalid limits are rejected before database reads, without numeric coercion.
Search also holds one read snapshot across match selection and evidence counts
at every sensitivity ceiling. A concurrent commit appears in the next response;
it cannot update only the counts in the current response. Invalid queries release
the snapshot, and searches inside caller transactions preserve outer rollback.
The programmatic `serve` entrypoint validates its ceiling before creating the
HTTP server. An unrecognized value throws `TypeError`; correcting the option
allows the same store to be served normally.
Restricted dashboard, entity, topic, history, lineage and report reads use one SQLite
read snapshot for the complete response, so a concurrent commit cannot mix
counts and rows from different database states. These reads work on read-only
connections, release their savepoint even on failure, and nest inside caller
transactions without committing them. A subsequent response sees later commits.
If both the read callback and savepoint release fail, an `AggregateError`
preserves the callback error as its cause and first entry and the release error
as its second entry. The aggregate message includes both underlying diagnostics;
unprintable thrown values use `[unprintable thrown value]` without replacing
the originals. The same formatting applies to paired construction, publication
and disposable-projection cleanup failures. A release-only failure is propagated directly; cleanup is
not retried automatically. A cleanup error does not by itself prove the
connection remains usable; resolve its cause before retrying.
Narrow-audience reads inside a transaction use a disposable projection for each synchronous
callback, so outer or savepoint rollbacks cannot leave cached rows or vocabulary
behind. Adapters without transaction-state inspection also use this uncached
path. A nested read savepoint keeps claim and citation-edge copying in one
snapshot even when the caller has no transaction; the next response sees later
peer commits. These temporary projections close after the callback, even on failure,
and are not included in the cache statistics. Diagnostic statistics are detached
snapshots, including before a cache exists and after it is cleared; modifying
one returned object cannot change later statistics for any store.
If both the callback and projection
close fail, the same error-ordering contract applies: callback error first and
as cause, close error second. A close-only failure is propagated directly.
Cleanup hooks may fail even when the projection database closes successfully;
the shared cleanup helper preserves both diagnostic failures without repeating
close. Ordinary committed native reads
continue to reuse their indexed projections.
Closing the source with `store.close()` also closes all cached projections
through the store cleanup hook. A throwing projection cleanup callback does not
prevent the remaining projections or the source database from closing; cleanup
errors are reported after those attempts. Multiple projection-close failures
retain their original values in order and include each diagnostic in the
aggregate message, with a safe placeholder for unprintable values. Explicit
cache eviction forgets those projections before closing them, allowing a later
read to build a fresh projection when the source remains usable. Closing an HTTP handle leaves the caller-owned
source store open; its owner remains responsible for closing that store.
Projections copy the stored actor, source, run and domain provenance entries
for included claims exactly, including the absence of entries. They do not
infer replacement attribution from compatibility contexts. Hidden claims and
their provenance stay outside the projection. Provenance-only edits invalidate
the cached copy through the same source revision check.

Search instead applies sensitivity directly to its source query within a read
snapshot; it does not build a scoped projection.

`node scripts/view-projection-bench.mjs` measures complete public entity views
with six explicit provenance entries per claim. A darwin-arm64 checkpoint with
identity checks and exact provenance copying enabled measured:

| Claims | Cold (ms), Node 24 / 26 | Cached median (ms), Node 24 / 26 | After provenance edit (ms), Node 24 / 26 |
|---:|---:|---:|---:|
| 100 | 12.68 / 12.16 | 2.03 / 2.04 | 11.26 / 11.95 |
| 1,000 | 92.21 / 86.29 | 14.56 / 13.89 | 86.68 / 90.23 |

[Raw samples and source hashes](../../benchmarks/view-projection-fidelity-review.json)
record Node 24.21.0 and 26.8.1 in sequential isolated runs. Cold and invalidated
times are single observations; cached times are medians of five calls. Every
view matches the source baseline, explicit provenance is checked outside timing,
and cache counts establish one initial build and one rebuild after a
provenance-only edit. Setup, assertions, HTTP and browser rendering are excluded.
This is a current checkpoint, not a measurement of the fixes' incremental cost,
and does not establish performance for disk-backed or connected graphs.

Projection construction now prepares its context and tag queries once per copy,
while each row retains the same metadata reads and decoding checks. A separate
five-process-per-runtime comparison measured cold entity-view construction:

| Claims | Node 24 before → after (ms) | Node 26 before → after (ms) |
|---:|---:|---:|
| 100 | 12.73 → 11.78 | 12.25 → 11.50 |
| 1,000 | 89.60 → 81.68 | 86.16 → 79.94 |

[Full comparison samples](../../benchmarks/view-projection-statements-review.json)
retain the unchanged benchmark's output/provenance assertions. For 1,000 claims,
provenance-invalidated medians fell from 86.82 to 81.52 ms on Node 24 and from
87.13 to 79.71 ms on Node 26. Cached medians stayed approximately 14–15 ms.
Runs were sequential and alone, with baseline processes first; the fixed order
and small sample count limit causal precision. The preceding table describes
the version before statement reuse. These are complete in-memory entity reads,
not HTTP/browser latency or a general performance bound.



Claim JSON also parses every §9.8 source context into `sources` entries with
the decoded source, inclusive line range, display location, and an `href` for
valid HTTP(S) sources. An unspanned source URL retains an existing fragment such
as `#section` in its link. If the source has both its own fragment and a separate
line span, it remains unlinked because those anchors cannot share one fragment.
The page makes references with an `href` into links; cited report footnotes
append the same locations, so browser and document provenance agree.
HTTP(S)-prefixed sources with an invalid URL authority or port remain plain
code-span citations instead of broken links. Their stored provenance and line
locations are preserved.
Links preserve existing URL percent escapes, including encoded path separators
and query values, and retain literal IPv6 host brackets. Raw spaces, Unicode
and brackets outside the host remain encoded; invalid authorities stay unlinked.
Report links escape Markdown punctuation in display labels and entity-like text
in destinations, preserving the source locator as literal text and the original
link target when a Markdown renderer reads the report.
Decoded control characters, including the C1 range U+0080–U+009F, in report source labels are shown as visible
escapes (`\n`, `\r`, `\t`, or `\uXXXX`) so a source name cannot split a
footnote or link label. Stored source identities and encoded link destinations
remain unchanged; this also applies to local sources displayed as code spans.

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
  confidence bars included; the last row is the latest visible event. A zero
  confidence event marks the series as retracted in the selected audience.
  History reflects that audience's projection and makes no claim about hidden
  revisions; retraction and supersession remain visible instead of destroyed;
- **lineage** — the §13.2 edge table walked both ways from any row:
  *cites* answers "why is this believed" (`BECAUSE` premises, `VIA`
  rules, `WHEN` conditions), *cited by* answers "what depends on it";
  a row reached twice re-states without children (§28.4's convention),
  so §24.5 support cycles terminate; the walk is depth-capped and a
  node whose further edges the cap cut off is marked `truncated` — an
  incomplete explanation never renders as complete. Claim views are cached by
  row ID within one lineage request, so shared evidence reuses context, tag and
  edge-count reads while retaining every repeated branch. Later requests build
  fresh views; depth and repeat behavior are unchanged;
- **search** — the store's FTS5 over subjects, objects, values,
  comments and raw lines. The search box names its phrase-matching behavior.
  Matches include superseded revisions and retractions, each with its own row
  ID and confidence; search results are historical evidence, not a list of
  current beliefs. Revisions share a claim key that links to their belief history.
  The search page explains this historical scope and directs readers to claim
  history to follow changes.
  HTTP results contain at most the newest 100 matching rows; when 100 are shown,
  the page explains that more may exist and suggests refining the phrase.

Claims render from *structured* row data (columns plus side tables),
never by re-parsing text — no second grammar exists to drift out of
sync — and every entity name, claim key and row id links onward, so
the whole store is reachable by clicking.
`ClaimView.sigmaLevel` preserves a non-default uncertainty level, displayed
beside the delta as `(3σ)`, for example. An omitted level means the semantic
default of 2, matching the store's claim mapping; authored lines retain their
original spelling. Entity, history and other claim views share this renderer.

Run `node scripts/view-search-bench.mjs` alone from the repository root to
measure complete search view construction with numeric or 2,048-character text
payloads. It checks result counts and values, excludes seeding and assertions
from timing, and records one warmup plus five samples per case. On darwin-arm64,
the validated search medians were:

| Rows | Payload | Node 24.21.0 (ms) | Node 26.8.1 (ms) |
|---:|---|---:|---:|
| 100 | Numeric | 4.27 | 4.14 |
| 1,000 | Numeric | 40.38 | 41.29 |
| 100 | Long text | 4.07 | 4.00 |
| 1,000 | Long text | 49.58 | 49.95 |

[Raw comparison](../../benchmarks/view-search-validation-review.json) includes
sequential runs with only primary-field validation temporarily disabled. Those
1,000-row numeric medians were 34.78/38.73 ms, while the long-text baseline was
slower than the validated run. The mixed direction and fixed run order do not
establish a precise incremental validation cost. These are in-memory search,
metadata and view-construction measurements, not HTTP or browser latency, and
do not cover larger stores or every payload shape. Validation remains enabled.

Claim batches now prepare their four metadata queries once per batch, while
keeping primary-field validation and the existing read snapshot. Statements are
local to the call; each row still reads its own contexts, tags and evidence counts.
A separate before/after run, with validation enabled throughout, measured:

| Rows | Payload | Node 24 before → after (ms) | Node 26 before → after (ms) |
|---:|---|---:|---:|
| 100 | Numeric | 4.21 → 1.18 | 4.08 → 1.06 |
| 1,000 | Numeric | 39.85 → 8.93 | 38.29 → 8.49 |
| 100 | Long text | 3.85 → 1.13 | 3.92 → 1.10 |
| 1,000 | Long text | 61.26 → 20.05 | 57.81 → 18.91 |

[Batch comparison samples](../../benchmarks/view-search-batch-review.json) retain
both runs on Node 24.21.0/26.8.1. The same workload and measurement limitations
apply; these fixtures do not measure heavily connected claims or large metadata
collections. The earlier validation-cost table records the preceding implementation.

The benchmark's version 2 also covers populated claims: three contexts, three
tags, and five incoming plus five outgoing `BECAUSE` edges per claim in a ring.
It checks exact per-row metadata and evidence counts after each timed call,
including a distinct origin context and label for every claim. For 1,000 rows:

| Payload | Metadata | Node 24.21.0 (ms) | Node 26.8.1 (ms) |
|---|---|---:|---:|
| Numeric | Empty | 8.37 | 8.09 |
| Numeric | Populated | 17.89 | 16.90 |
| Long text | Empty | 25.03 | 21.22 |
| Long text | Populated | 35.98 | 25.88 |

[Metadata workload samples](../../benchmarks/view-search-metadata-review.json)
include both 100- and 1,000-row cases. Runs use the current batch mapper with
validation enabled; setup, assertions, HTTP and browser rendering are excluded.
The fixed-order ring fixture does not establish performance for higher-degree
graphs, mixed sensitivity levels, parsed source citations or disk-backed stores.

A separate paired measurement isolates the five authored-value/cache consistency
checks using the same fixtures. The benchmark-only
[baseline loader](../../benchmarks/view-search-cache-baseline.mjs) omits those
checks without editing runtime files; run it with
`node --import ./benchmarks/view-search-cache-baseline.mjs scripts/view-search-bench.mjs`
from the repository root, then run the benchmark without the import option.
Run these alone and sequentially. For 1,000 rows, medians without → with checks:

| Payload | Metadata | Node 24.21.0 (ms) | Node 26.8.1 (ms) |
|---|---|---:|---:|
| Numeric | Empty | 8.70 → 9.14 | 8.06 → 8.80 |
| Numeric | Populated | 18.33 → 18.25 | 17.33 → 17.12 |
| Long text | Empty | 20.83 → 19.32 | 18.43 → 21.80 |
| Long text | Populated | 32.15 → 28.56 | 26.71 → 28.14 |

[All samples and method](../../benchmarks/view-search-cache-validation-review.json)
include both fixture sizes and the runtime source checksum. Mixed differences
across runtimes and payloads do not establish a general overhead percentage or
speedup. These measurements exclude doctor's full-history scan and HTTP/browser
work. No further optimization is justified by this comparison alone.

The lineage page distinguishes recorded evidence from current support: a later
premise revision does not rewrite a historical claim's edges. Rule support is
re-evaluated against current beliefs independently of that recorded lineage.
Confidence labels use one decimal place, but values that would round to the
endpoints display `<0.1%` or `>99.9%`. Only exact zero displays the retraction
label `@ 0%`; a value below one cannot display `100%`. The same convention
applies to history-bar tooltips and average confidence. API confidence numbers,
bar widths and stored values retain their original precision.

## Read-only, local (spec §30.3)

Only GET/HEAD are answered (anything else is 405), no endpoint writes,
and every request reflects the live store — a running `cave automate`
loop's appends invalidate the cached audience projection and show on the next
refresh. The server binds `127.0.0.1`
by default; `--host` widens deliberately (it shares the selected sensitivity
view, read-only). Sensitivity is routing metadata, not authentication or
encryption; a widened server still belongs behind an appropriate access layer.
An empty or whitespace-only host is rejected before listener creation, rather
than being treated as Node's unspecified address. Programmatic hosts must be
strings; omit the option to use loopback, or supply an explicit bind address.
The CLI validates blank `--host` values before opening the database, so an
unavailable store cannot hide the invalid-option diagnostic.
Blank `--port` values are also rejected before database access; use explicit
`--port 0` to request a free port, or omit it to use the default port.
Recording knowledge stays with `cave add`, the MCP tools
and the kinetic layer.

The alias toggle's saved preference is optional. If browser storage cannot be
read, aliases start off; if it cannot be written, toggling still applies for the
current page session. Storage failures do not prevent the view from loading.

Links, search inputs, checkboxes and buttons use the theme accent for a
visible keyboard focus outline; focused links also gain an underline. The
source-link browser checks cover wrapped links in light and dark themes at
320 and 1280 px.

Following a link within a view moves focus to the destination heading after it
loads, so keyboard navigation can continue through the new content. The
heading is revealed below the measured sticky header, including when long
claim text makes it taller than the viewport. If the user
moves focus to search while the request is pending, completion preserves that
focus and draft. Destination headings do not enter the ordinary Tab order.
Failed link navigation focuses the displayed error under the same conditions;
errors do not take focus away from a search field the user has already entered.
Error views include a keyboard-accessible Retry view button. It reloads the
current route with the current alias setting without adding a history entry.
After retry, focus moves from the removed button to the error or recovered
view heading; overview recovery uses its first section heading. Focus moved to
search while loading remains there.
Request errors retain the HTTP status when the response is HTML, unreadable JSON,
or lacks a string error message. Structured API error messages remain visible.
Unreadable successful responses are reported as JSON read failures with their
status, and the same retry action remains available.

Page labels are HTML-escaped and substituted once. Dollar replacement tokens
and text resembling internal template markers remain literal label text; they
cannot duplicate page markup or be rewritten as the version or sensitivity.

Browser titles identify the loaded view and retain the database label, so
entity, search and history tabs can be distinguished. Loading and error titles
reflect pending or failed navigation; a successful retry restores the view title.

The first keyboard stop is a “Skip to content” link, visible while focused.
It bypasses the header, focuses the current main view and leaves the route and
loaded data unchanged. The next Tab continues through the content links.

The search field is named “Search claims” for assistive technology, advertises
its Enter shortcut and requests a Search key on virtual keyboards. Plain Enter starts
a search after input-method composition finishes; confirming a composed word
does not navigate away while text is still being entered. Empty searches leave
the current view in place.

GET and HEAD share status and cache-protection headers; HEAD sends no body.
Request URLs that cannot be parsed receive HTTP 400 with a JSON error; later
valid requests continue normally. Query strings must contain valid percent
escapes and UTF-8 sequences: malformed encoding is rejected before URL parameter
decoding can replace bytes and search for different text. Explicitly encoded
replacement characters, accented text, emoji and literal percent signs remain
valid; values are decoded only once. GET and HEAD apply the same validation.
A client disconnect during response delivery
does not close the source store or prevent later requests. Response construction
is synchronous; disconnect recovery does not interrupt SQL work already running.
HTTP search treats `q` as a literal full-text phrase, not raw FTS syntax.
For example, `api OR cache` searches for that sequence of terms; it does not
combine separate searches for `api` and `cache`. Quotes and punctuation are
handled by the store's literal search path and tokenizer. A query with no
matching terms returns an empty JSON array with HTTP 200.
Search query text containing NUL (including URL-encoded `%00`) receives HTTP 400
before database search, because SQLite full-text parsing can truncate that text.
GET returns the JSON diagnostic; HEAD returns the same status and headers without
a body. Later valid searches remain available.
An already-aborted signal passed to `runServe` returns quietly with code 0
before argument handling, database access, or binding an HTTP port.
`runServe` captures that signal once and retains it through the shutdown wait,
including cancellation during the startup announcement or changes to the
caller's context object.

On CLI cancellation, `cave serve` stops accepting connections, closes remaining
HTTP connections (including clients with unfinished request headers), waits for
server shutdown, then closes its store. Responses still in transit may end early.
A server error after binding also initiates command shutdown without requiring
an external abort. The command retains error diagnostics, closes the HTTP
listener and its store, and removes its abort/error listeners. This includes
errors raised while announcing startup. A corrected invocation can bind again.
Database cleanup still runs if HTTP shutdown reports an error. A synchronous
startup-announcement exception also enters listener and database cleanup.
Connection termination and awaiting listener shutdown are independent cleanup
steps: a connection-cleanup exception does not skip the wait or close the store
early. A lone failure retains its original identity; simultaneous failures form
an `AggregateError` ordered as command/startup, initiating listener close,
connection termination, listener-close completion, then store close, with the
first failure as `cause` and all messages included. Diagnostic formatting uses
`[unprintable thrown value]` when a message getter or string conversion throws;
the original failures remain in the aggregate in the same order. Every owned cleanup step is
attempted, but native close failures do not establish that resources were
released.
The library's `handle.close()` instead uses graceful HTTP server shutdown and
leaves ownership of the supplied store with its caller.
Store failures during a request return HTTP 500 with a JSON error message.
JSON serialization finishes before response headers are committed. A value
that JSON cannot encode, such as a BigInt returned by an adapter, therefore
also produces the ordinary HTTP 500 diagnostic instead of escaping the request
handler. GET and HEAD retain their normal error headers; HEAD has no body.
Repairing the adapter permits subsequent requests on the same server to succeed.
Structured claim views require a canonical UUIDv7 row ID equal to its transaction
value and a stored claim key matching the decoded claim and contexts. These
checks also apply at the restricted ceiling, where reads use the source store
directly. Invalid identity returns a row-specific error before misleading dates
or history links can be displayed; repair restores the affected views.
Claim views validate primary stored fields through the store's row decoder
before shaping their JSON, including search results. Conflicting payloads and
invalid negation/importance/approximation flags therefore fail instead of being silently
coerced or partially displayed. A scoped search over unaffected rows can still
succeed, and repairing malformed rows permits the failed views to load again.
Tag keys must be strings and tag values must be strings or SQL NULL (a flat tag).
SQLite binary values in either column fail with a row-specific diagnostic that
does not echo the corrupted value, rather than becoming objects in claim JSON.
These checks cover direct restricted reads and search as well as projected
views; tags on excluded claims do not prevent a lower-sensitivity view from
loading. Failed reads leave storage unchanged, and repairing the tag restores
GET and HEAD requests on the same server.
Cached value/delta numbers, units and approximation must also agree with authored
text. Mismatches fail with a field diagnostic that omits the corrupted value;
GET and HEAD checks cover entity, history, lineage and search recovery after repair.
The server's sensitivity ceiling is applied before this validation: malformed
restricted rows leave public overview, topic, search and entity responses
unchanged when those rows are excluded from the view.
If the thrown value cannot be formatted (for example, an object without a
string representation or a throwing error-message getter), the message is
`[unprintable thrown value]`; diagnostic formatting does not escape the request
handler. HEAD retains the status and headers without a body, and a later
request can succeed when the underlying store is usable again.

Responses use `Cache-Control: no-store`, including errors. The browser only
renders responses for the latest navigation, so slow earlier requests cannot
replace the selected view. Malformed URL fragments display an error, and normal
navigation remains available to recover.
The main view is marked busy while loading. A separate status region announces
loading and completion, and request or fragment errors use an alert. Status
updates follow the same navigation guard as content, so stale requests cannot
clear the current view's busy state or announce an obsolete result.
At narrow widths the search field shrinks to keep the aliases control on-screen.
Long entity names, topic labels, claim values and store paths wrap within the
page instead of forcing horizontal page scrolling.
Submitting the current search again refreshes it against the live store without
adding a history entry or moving focus out of the search field. Enter during
input composition and blank searches remain ignored. Modified Enter keys
(Control, Command/Meta, Alt or Shift) do not submit or change the current route,
matching the documentation filter's plain-Enter shortcut.
Search navigation fills the input before starting its request. A delayed
response updates the results for that submitted query without replacing a new
draft typed while the request was pending.
Refreshing the same search through the aliases control or Retry view also keeps
the draft. Navigating to a different search, including Back or Forward, restores
that route's submitted query to the field.

## Reports — cited deliverables (spec §31)

`cave report` turns a Markdown template into a document with claim citations
for facts produced by its queries.

```sh
cave report --db knowledge.db template.md --out report.md
```

Without `--out`, rendered Markdown goes to stdout. With `--out`, stdout names
the destination and citation count; the document goes to that file. Check the
exit status as well as the output: a saved document can contain template
diagnostics rather than a fully resolved report.

| Outcome | Exit status | Document with `--out` | stderr |
|---|---|---|---|
| Template renders without problems | 0 | Replaced with the rendered report | Empty |
| Invalid CLI time option (`--at` or `--as-of`) | 1 | Unchanged | Option validation error |
| Template problems, such as an ambiguous inline match | 1 | Replaced with diagnostic Markdown | Problems with template line numbers |
| Output write, flush, file-close or rename fails | 1 | Previous destination remains intact | File-operation error |
| Temporary-directory cleanup fails after publication | 1 | Completed report remains published | Cleanup diagnostic |
| Store close fails after publication | 1 | Completed report remains published | Store-close diagnostic |

File output is written and flushed to a temporary file before replacement, so
an interrupted write does not publish a truncated report. Template problems
are different: the completed diagnostic document is intentionally published
for inspection. Correct the reported template or data problem and rerun before
using that document as a finished deliverable. See the [CLI output contract](../cli/README.md)
for permissions, symlinks and shell-redirection behavior. A failure while closing
the store after publication does not undo the completed report. The command
retains its publication message on stdout and reports the cleanup failure on
stderr; status 1 alone does not mean the output file stayed unchanged.
Temporary-directory cleanup can also fail after replacement. The report remains
published in that case, but the failure occurs before the command produces its
stdout publication message.

The CLI validates `--at` and `--as-of` before reading the template or opening
the store, including for static templates. Invalid options never publish a
document. Report query errors whose message cannot be formatted use
`[unprintable thrown value]` and retain the affected template line. Each failed
query occurrence still produces its own problem; formatting does not abort
rendering or manufacture citations. A later render can recover when its
underlying query succeeds.

Report citations and sensitivity projections also require a canonical lowercase
UUIDv7 row ID with an identical transaction value. Invalid or mismatched
transaction identity aborts with the row ID before a misleading date can be
rendered or a copied row can silently replace that metadata. Repair permits retry.

Report citations reject a stored claim key that disagrees with the canonical
claim and its contexts, identifying the affected row instead of emitting a
misleading history reference. Sensitivity projections validate the keys of all
included rows before copying them; they cannot silently reconstruct a different
identity. Excluded sensitive rows remain outside that check. Repairing the key
allows a fresh report to succeed. These stored-integrity failures abort rendering.

The library's `report()` retains query-local diagnostics: invalid
query options are reported at each live query that uses them. Programmatic
`aliases` and `resolve` settings must be booleans; omission defaults to false.
Malformed mode settings, including `null`, throw before store reads or rendering
rather than producing a report with silently disabled modes.

Templates have two live constructs; everything else passes through verbatim:

````markdown
Revenue reached `cave-q: acme HAS revenue: ?v` this quarter.

## Service ownership

```cave-q
?svc HAS owner: ?who
- **?svc** is owned by ?who [^?]
```
````

A fenced `cave-q` block holds a CAVE-Q pattern (plus optional `WHERE`
lines, with spaces or tabs after `WHERE`) and a fragment rendered once per solution, `?var` bindings
substituted — without a fragment each solution renders as a cited
bullet. Substitution scans the template once: variable-like text and `[^?]`
inside stored bindings remain unchanged. Stored text that resembles an inline
`cave-q:` splice is also inserted without executing another query. Bindings are
not Markdown-escaped: emphasis, links and other Markdown in a value remain in
the output for the downstream Markdown renderer to interpret. Longest bound names win, and Unicode
letters, combining marks and numbers continue placeholder names, so a binding
for `?x` does not rewrite an unknown `?xé` or `?x東京` placeholder.
Query variables must have a name after `?`. A bare `?` reports an invalid query
instead of binding an empty name and replacing ordinary prose question marks.
A bare `WHERE` line is an invalid filter and produces a query problem instead
of rendering unfiltered rows. Use a blank line after the query to begin a
fragment whose prose starts with `WHERE`.
Citations identify stored rows used by queries. They do not validate surrounding
prose or automatically cite ordinary template text.
An inline `` `cave-q: …` `` splice — a code span of any
delimiter length, so `` ``cave-q: … `code` …`` `` works when the
pattern carries a backtick literal — takes exactly one variable
and one solution (several matches are a *problem*, and `--resolve` picks
the §26 winner — the fix when sources contest a fact). Every rendered
row cites: `[^cN]` markers land at the fragment's `[^?]` placeholder
(appended when absent), and the definitions — canonical line, tx date,
claim key — collect at the end of the document, so a reader can pull the
belief history behind any sentence. Transaction dates retain the complete UTC
ISO date, including the signed six-digit year for timestamps beyond year 9999.
Generated labels skip `cN` labels already
occurring in the original template (case-insensitively, including code examples),
so handwritten references and definitions retain their meaning. Canonical declarations containing
backtick literals use longer CommonMark code-span delimiters in both default
bullets and footnotes. Fully bound default bullets retain the stored claim's
leading and trailing spaces by padding code spans against Markdown's whitespace
trimming. Citation comments fold LF, CRLF and CR line endings into ` / ` so
each definition stays on one Markdown line; stored comments remain unchanged.
Citation-generation errors name the claim ID and retain the underlying failure
as their cause.
Report generation does not return a partially cited report. This is distinct from query syntax
or match problems, which appear in the returned report's problem list.
`--aliases`, `--as-of`, and `--at` compose
exactly as on `cave query`; `--at` filters valid-time claims and interpolates
trajectories while `--as-of` independently freezes transaction time. The
template stays under version control and
the report re-renders from current belief on demand.

Indented code examples remain literal, including tab-indented blocks and code
inside list or blockquote containers. Indented paragraph continuations can still
contain live inline splices. The report uses `mdast-util-from-markdown` to locate
code blocks and inline spans with its GFM footnote extensions, preserving the original template
lines rather than reserializing the Markdown tree. Only parsed top-level
`cave-q` fences execute query blocks. Fences inside lists, blockquotes and
footnotes remain literal examples, including short-indented list content.
Backtick fence info strings containing backticks are ordinary Markdown rather
than query-block openers. Closing fences accept spaces and tabs after the
delimiter; other whitespace does not close them. Unclosed query blocks still
render their solutions and report an unclosed-block problem.
Continued handwritten footnote paragraphs retain live inline splices;
code examples nested inside those footnotes remain literal, with spaces or tabs
used for indentation.
Raw HTML blocks, comments and inline tag attributes also remain literal: their
backticks and apparent query fences do not execute queries or add citations.
Splices in surrounding Markdown prose still run, including text between inline
HTML tags. HTML boundaries follow the Markdown parser (for example, a blank line
ends a raw `div` block); this preserves HTML source and does not sanitize it.
Escaped backticks, link-reference definitions and multiline code spans that quote
splice syntax remain literal. Live splices may span lines: Markdown line endings
become spaces in the query, and diagnostics refer to the opening delimiter's
line. Text outside each span remains in place, including adjacent splices and
container prefixes. Report output normalizes LF, CRLF and CR line endings to LF.

Report assembly and code-span delimiter selection iterate over lines,
footnote definitions and backtick runs, avoiding JavaScript's function-argument
limit for large fragments, citation lists and source locators. A 130,000-row
regression checks every generated citation marker against its footnote and claim.
Reports are still assembled in memory; this does not impose a memory budget.
Leading blank lines in query blocks and fragments are skipped with index scans,
avoiding repeated array compaction for generated templates with large blank
prefixes. Empty-block diagnostics retain their original template line numbers.
A local Node 26.5.0/macOS arm64 probe with 100,000 generated blank lines in an
empty query block took 1,021 ms before this change and 238 ms afterward, with the
same diagnostic location. These are individual end-to-end render measurements,
including Markdown parsing, rather than a general latency guarantee.
Within one render, consecutive queries with identical text reuse the last
successful result against that render's fixed store view and options. Only one
result is retained, rather than all distinct query results. New renders read
current data and their own options; query errors still report each occurrence's
source line.
Each render captures sensitivity, alias matching, resolution and both time
anchors once before reading the store. Getter-backed options cannot change the
settings between template queries or make a historical report cite current data.
For restricted reports, the read snapshot spans every template query and its
citation lookup. An external commit during rendering cannot update a later
section alone; a new render sees the committed values and their citations.

`pnpm bench:report` runs `scripts/report-bench.mjs` against the current parser.
It measures five sequential renders per case on one store and emits JSON with
runtime versions, UTF-8 byte counts and every timing sample. Literal/splice cases
verify unchanged examples, expected live values, one citation and no problems.
Blank-prefix cases exercise 1,000, 10,000, and 100,000 lines: an empty query block
must retain its invalid-query marker and exact diagnostic location, while a live
block with padded query and fragment prefixes must equal its compact rendering.
Those cases report `blankLinesPerPrefix`; literal/splice cases report `examples`.
Setup and result assertions are outside the timer. It is an informational
benchmark with correctness assertions, not a fixed latency gate or cold-start
measurement; run it without competing builds or tests.

The blank-prefix cases on Node 26.5.0/macOS arm64 produced these local medians
(milliseconds, five renders each):

| Case | 1,000 lines per prefix | 10,000 | 100,000 |
|---|---:|---:|---:|
| Empty query block | 2.2 | 20.2 | 211.5 |
| Live query and fragment prefixes | 3.7 | 39.0 | 442.7 |

A 2026-09-07 run on macOS arm64, Node 26.5.0 and SQLite 3.53.3 measured:

| Report case | 1,000 occurrences: bytes / median | 10,000 occurrences: bytes / median |
|---|---:|---:|
| Indented code | 33,036 / 6.31 ms | 330,036 / 47.87 ms |
| HTML comments | 38,036 / 4.86 ms | 380,036 / 50.25 ms |
| Multiline code spans | 57,036 / 41.27 ms | 570,036 / 344.83 ms |
| Repeated live query | 36,036 / 14.89 ms | 360,036 / 164.36 ms |

Each template ends with an additional live splice. The repeated-query case uses
one query text throughout. Before per-render result reuse, its medians were
64.81 and 610.48 ms; the repeated-query row records the subsequent optimized run.
These shapes have different costs, and repeated results do not predict performance
for arbitrary templates or many distinct live queries.

Earlier fresh-process source-entry CLI measurements, before the footnote
extensions and subsequent Markdown boundary fixes,
(`node packages/cli/src/main.ts --help`) used nine alternating runs per
variant: 165.7 ms median with the parser, 148.5 ms with a test-only module
resolution hook replacing it with a stub that throws if called. Help output
and successful exit were identical. The hook itself affects the comparison,
so the difference is an estimate of import cost, not an isolated parser timer.
The parser remains eagerly imported; this measurement alone does not justify
adding synchronous ESM loading machinery to the supported runtime matrix.
All ten existing `pnpm bench:performance` gates passed unchanged, but those
gates do not cover report parsing or CLI startup.

## Programmatic

`serve` resolves after binding its listener and rejects listener errors such as
`EADDRINUSE`. A failed start leaves the caller's store open and its history
unchanged; retry after releasing the port or choosing another one. The caller
also retains store ownership after `handle.close()`, which closes the server.
Concurrent or repeated calls to the same handle's `close()` share the first
shutdown promise, so independent cleanup paths can safely await it.
The startup rejection listener is removed once binding succeeds. Programmatic
callers handle later errors through `handle.server.on('error', listener)` and
own their shutdown policy; a settled startup promise cannot report those errors.
Closing the handle preserves caller-installed event listeners. The `runServe`
command installs its own runtime-error handler and performs cleanup automatically.
Only omission selects startup defaults for `port`, `host` and `maxSensitivity`;
explicit `null` is rejected before the server invokes `listen`.
The programmatic `port` must be an integer in 0..65535; zero asks for a free
port. Invalid types or ranges throw `TypeError` before server creation.

```ts
import { serve, report, overview, entity, history, lineage } from '@cavelang/cli/view'

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

Programmatic `overview` caps must be non-negative safe integers: `limit`
defaults to 100 items per frontier section, and `recent` defaults to 30 appends.
Zero omits that section's items while frontier totals remain available.
`staleDays` must be finite and non-negative. These options are captured once
and validated before store reads or sensitivity-projection work; a negative
recent cap cannot turn into an unlimited SQL query.
Only omission selects the default for these limits and the stale horizon;
explicit `null` is invalid. Search also validates its non-negative safe-integer
limit before opening a read snapshot. A zero search limit returns no matches.

Programmatic `entity` and `topic` calls accept only booleans for `aliases`;
omission defaults to false. Invalid values, including `null`, are rejected
before database reads or sensitivity projection work. Each call captures the
setting once and accepts a corrected setting on retry.

Endpoints: `/api/overview`, `/api/entity?name=`, `/api/topic?name=`,
`/api/history?key=`, `/api/lineage?id=`, `/api/search?q=` (`&aliases=1`
where the §13.6 closure applies).
Each endpoint’s required parameter must appear at most once. Repeated names,
keys, IDs or search queries return HTTP 400, even when their values agree.
The optional `aliases` parameter accepts `0` (off) or `1` (on), at most once;
omission leaves expansion off. Invalid or repeated values return HTTP 400 with
a JSON error for GET and the same status without a body for HEAD. A corrected
request can be retried on the same server.

Part of the [CAVE monorepo](../..); the specification lives in the
repository's `.claude/skills/` directory (spec §30 and §31 in
`cave-storage-query`).
