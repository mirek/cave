# @cavelang/mcp

MCP claim results intentionally remain canonical CAVE text, not database rows
or an unversioned JSON object. This is the agent-facing compatibility contract:
`cave_query`, `cave_about`, `cave_neighbors`, `cave_search`, and `cave_export`
return CAVE lines, while MCP's JSON-RPC envelope follows the negotiated
protocol version. Clients needing structured durable records should use the
library `cave.claim/v1` / `cave.query-match/v1` APIs.

The CAVE engine as an **MCP server**: `cave mcp --db knowledge.db` serves
the Model Context Protocol on stdio, so any MCP client (Claude Code,
Claude Desktop, …) can read and write a CAVE knowledge database directly.

```jsonc
// client configuration
{
  "mcpServers": {
    "cave": { "command": "cave", "args": ["mcp", "--db", "knowledge.db"] }
  }
}
```

The server's `instructions` carry the spec §22 compact card, and `cave_help`
serves longer version-matched workflow guidance on demand. This keeps the
server self-describing even when a client does not place initialization
instructions in the model's initial context.

## Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `cave_help` | optional `topic` (`overview`, `write`, `find`, `revise`, `safety`) | version-matched operating guidance; reads no user data |
| `cave_add` | `text`, `strict` | append CAVE text (extraction output); lenient, `strict` opt-in |
| `cave_query` | `pattern`, `all`, `aliases`, `asOf`, `at`, `resolve`, `limit`, `cursor` | Bounded CAVE-Q pages (§12): `?x USES jwt`, `WHERE conf >= 0.7`, `EXTENDS+`, inverse verbs; `aliases` (§13.6), `asOf` (§12.3), `at` valid time (§32.4), and `resolve` (§26 winners only) opt-ins. `limit` defaults to 100 (maximum 1,000); a `next cursor:` line continues the frozen first-page snapshot through `cursor`. Changed historical rows or lineage return a tool error; restart without the cursor. |
| `cave_fuse` | one of `pattern`, `about`, `text`; optional `aliases`, `asOf` | Bayesian fusion of numeric estimates (§10.1) — named computation over a CAVE-Q `pattern`, an entity's current claims (`about`), or literal `text` |
| `cave_search` | `query`, `raw`, `limit` | FTS5 over subjects, verbs, objects, attribute names, values, comments, and raw lines (tags and contexts included) — for unknown wording or spelling; literal phrase by default, `raw` passes MATCH syntax through; newest first with comments, including superseded and retracted rows; use `cave_query` to check current beliefs. `limit` defaults to 100 (maximum 1,000) and a trailing `more matches beyond <n>` line reports a cap |
| `cave_about` | `entity`, `aliases`, `resolve` | current claims about an entity, both directions, canonical lines; `aliases` / `resolve` opt-ins |
| `cave_neighbors` | `entity`, `aliases`, `resolve` | named forward + inverse edges (§13.3) for graph walking; `aliases` / `resolve` opt-ins |
| `cave_reconstruct` | `seeds`, `maxSteps`, `maxClaims` | cave-loop active reconstruction from seed cues (§18) — pull everything related to a symptom before reasoning |
| `cave_derive` | `dryRun`, `full`, `aliases`, `minConf`, `maxPasses` | fire the stored rules (§24) — named computation |
| `cave_export` | `current`, `maxSensitivity` | sensitivity-scoped canonical text (default `internal`; `maxSensitivity: restricted` for complete portable history; `current` for beliefs only) |
| `cave_lint` | `text` | validate CAVE text without storing |
| `act_<name>` | current action declaration's parameter schema | one generated governed-write tool per current action declaration (§25.5); hooks stay out of band |

Read flags also require actual booleans: query `all`/`aliases`/`resolve`, fusion
`aliases`, search `raw`, entity `aliases`/`resolve`, and export `current`. Omission
means false. Strings, null and other non-booleans produce tool errors instead
of silently changing history scope, alias resolution, search syntax or export
mode. Fusion validates its flag even when no estimates match.

Each `cave_about` call reads aliases, current or resolved claims, and canonical
claim metadata within one deferred database snapshot. Each `cave_neighbors`
call likewise keeps its forward and reverse traversals in the same snapshot.
Concurrent updates become visible on the next call; a single reply cannot mix
both sides of an update. These reads preserve an enclosing caller transaction,
including when invalid arguments produce a tool error.

`cave_reconstruct` runs the `@cavelang/loop` heuristic policy over the SQLite
store through the §18 store contract (`sqliteStore`) — the same multi-hop
recovery as the demo, against persistent knowledge. An MCP client is
itself the model, so it can drive selection by hand via `cave_neighbors`;
the packaged LLM-driven policy lives in `cave reconstruct --agent`.
Reconstruction requires a nonempty, dense `seeds` array of nonempty strings.
Supplied `maxSteps` and `maxClaims` must be nonnegative safe integers; zero is
valid and stops before expansion. Omit a budget to use its default. Mixed seed
lists, string/null budgets and non-finite or fractional budgets return tool
errors before graph traversal, preserving the session for a corrected request.
The stdio regression checks the advertised schema, malformed JSON arguments,
zero-budget behavior and a successful retry through the same SDK connection.
The synchronous MCP reconstruction holds one deferred read snapshot across all
cue expansions and final claim rendering. A concurrent graph update becomes
visible on the next call, rather than changing the branch halfway through one
result. This snapshot guarantee applies to the MCP tool; it does not establish
snapshot isolation for the separate asynchronous agent-driven loop.

Programmatic server scopes require a boolean `readOnly` value. Omission or
false preserves the selected permissions; true removes record and action tools.
Malformed values such as `"true"` or null fail setup rather than leaving writes
enabled. Static tool selection, generated action selection and server creation
use the same validation. Supplied `permissions` and `tools` must be dense arrays
of strings; null does not select defaults. Omit a list to leave it unrestricted.
An empty list serves no tools and is rejected during server setup. Static and
generated-action scope helpers reject unknown permission and static-tool names
consistently, even beside valid names. An `act_` name may refer to a future
declaration and becomes available when that action is declared. Server and tool
surface creation capture `readOnly`, `permissions` and `tools` once, copying the
list values. Later edits to caller-owned options cannot widen or narrow that
connection. Create a new server/surface to change scope; permitted action
declarations still appear dynamically within its captured scope.
Source and hook configuration remain lazy: each tool call reads each option once,
uses that value for the call, and reads fresh settings on the next call. A failed
configuration lookup returns a tool error before execution and can be corrected
without reconnecting.
A supplied source must be `false` or a nonempty context token without the `src:`
prefix, using the same token rules as CLI `--src`. Null, non-string values,
whitespace and line terminators return a tool error before execution. Omission
uses the connected agent source; `false` disables stamping.

## Named computation

`cave_fuse` and `cave_derive` expose the engine's
computation by name, so agents delegate math instead of doing arithmetic
in tokens. `cave_fuse` runs §10.1 precision-weighted fusion over
independent estimates of **one quantity** — one claim key modulo `@src:`
contexts (§26.1's group identity, widened by the alias closure under
`aliases`), one unit — selected three ways: a CAVE-Q `pattern`
(`openai HAS revenue: ?v`), an entity name (`about: revenue`, the only
reach into metric `IS` series, whose values CAVE-Q variables never
bind), or literal `text`. Literal estimates are parsed with the store's
vocabulary; they neither select stored estimates nor append claims. With
`aliases: true`, quantity grouping uses the store's alias graph for all three
selectors, including literal text. It reports the
contributing estimates, the posterior as a writable CAVE value
(`19.97B USD/yr +/- 508.5M USD/yr (2σ)`) and the exact mean/sigma.
Estimate selection, claim projection and alias-based quantity grouping share one
deferred database snapshot. A concurrent alias change takes effect on the next
fusion call, so one result cannot mix estimates selected before the change with
grouping performed afterward. The read also nests inside a caller-owned
transaction without committing its writes.
Exactly one selector may be supplied. A malformed extra selector is rejected
instead of being discarded in favor of a valid one. A supplied `asOf` must be a
nonempty string and composes only with `pattern`; invalid types do not silently
fall back to current beliefs. Selections that span several quantities or mix
incompatible units fail loudly.
For `pattern` with `asOf` and `aliases: true`, both estimate selection and
quantity grouping use the alias graph at that cutoff. Later alias additions or
retractions do not change whether those historical estimates form one quantity.
Within each fusion call, names in the same alias component reuse its chosen
representative. This avoids repeating graph traversal for estimates sharing
aliases; the cache ends with the read snapshot, so subsequent calls observe
new merges, retractions and requested historical cutoffs.

The isolated `node --disable-warning=ExperimentalWarning
scripts/fusion-grouping-bench.mjs` fixture measures 100 estimates linked through
100 alias edges. On Node 26.8.1/macOS arm64, five timed calls had a median of
58.5 ms before this reuse and 4.4 ms afterward, with identical output hashes.
[Raw samples and source hashes](../../benchmarks/fusion-grouping-review.json)
retain the comparison. Setup and assertions are outside timing; this measures
one shared-component fixture, not a general bound on fusion time or memory.
Numeric validation and representability failures from the fusion library are
reported as tool errors; non-finite posteriors are never returned as estimates.
The writable posterior normally uses four significant digits and magnitude
multipliers. If that rounding would overflow when the multiplier is applied,
it uses the unrounded decimal value instead, preserving finite boundary means.
Supplied `cave_query` options `asOf`, `at` and `cursor` must be nonempty strings.
Malformed values produce a tool error; they are never discarded to run an
unanchored query or restart pagination. Omit an option to leave it unset.
Programmatic `cave_query`, `cave_fuse`, `cave_search`, `cave_reconstruct` and
`cave_export` calls read each declared argument once and retain its value for
validation and execution. This includes query pagination and time labels,
fusion selectors, search limits, reconstruction seeds/budgets and export
sensitivity. Getter-backed arguments cannot replace a malformed first value
before validation or change it between validation and rendering; unrecognized
argument properties are not evaluated. Reconstruction also copies the seed
array before traversal.
`cave_query` validates each projected claim's transaction identity and
provenance before returning its page. Corrupt stored evidence produces one
`isError: true` tool reply without partial matches or a continuation cursor.
The failed read leaves claim history and metadata unchanged. After the stored
data is repaired, a new query succeeds in the same MCP session; reconnecting is
unnecessary. Stdio regressions exercise both mismatched transaction IDs and
malformed provenance through the SDK transport.
`cave_export` also returns one `isError: true` tool result, without partial
CAVE text, when a historical key used to remap a current relationship disagrees
with the stored claim. The error identifies the historical row. Repairing that
key allows the same session to export again, including when the server runs
with `--read-only` and an external writer performs the repair. This check covers
historical endpoints mapped onto selected current claims; it does not certify
omitted history. Use `cave doctor` for broader stored-integrity diagnostics.
`cave_search` rejects NUL-bearing query text in both literal and raw modes with
an `isError: true` tool result, without returning truncated-query matches. This
is not a JSON-RPC protocol failure: the same session remains usable for a
corrected search.
Unpaired UTF-16 surrogates in stored claim text, CAVE-Q patterns, search text or
`cave_about` or neighbor lookup arguments likewise produce tool errors.
`cave_about` validates entity text regardless of its alias or resolution flags,
so malformed names cannot masquerade as an ordinary empty result. Fusion's `about`
selector uses the same entity validation with or without aliases, including when
the store has no matching estimates.
Reconstruction validates every seed for unpaired surrogates before graph
traversal, including when a zero-step budget would otherwise avoid lookup. A bad
later seed rejects the request without expanding earlier valid seeds. The stdio regression
sends both surrogate halves as JSON escapes through one live session, verifies
that invalid additions leave no partial claims, and then queries explicit
replacement characters, accented text and emoji successfully.
Write-tool flags require actual booleans: `cave_add.strict` and
`cave_derive.dryRun`, `full` and `aliases`. Omitted flags default to false.
Strings such as `"true"` or `"false"`, null and other non-boolean values produce
a tool error before any claims or derivation watermarks are appended. This
prevents a malformed preview flag from silently becoming a durable write.
`cave_derive` fires the store's in-band rules
(§24) with the same options as `cave derive` — declare rules through
`cave_add`, preview with `dryRun`, and re-runs stay idempotent and
watermark-incremental — so the declare → fire loop never leaves the
protocol.
`minConf` must be finite and in 0..1; `maxPasses` must be a positive safe
integer. Invalid limits return tool errors without changing derived claims
or watermarks.
Pass exhaustion returns a normal tool report whose final line starts
`derived (incomplete)`, retaining the dry-run marker for previews. It does not
set `isError`: earlier additions can remain committed, while incomplete support
reconciliation rolls back and watermarks stay unchanged. Read the completion
marker and retry with a higher `maxPasses` before treating support as settled.
The same session remains usable for querying retained history and retrying.

Current action declarations generate `act_<name>` tools dynamically on every
`tools/list`. Each required parameter advertises string, number or boolean
input, matching the action engine's scalar formatting; extra argument names are
disallowed. Null, arrays and objects do not satisfy action parameters. Finite
numbers retain plain-decimal CAVE spelling, and booleans bind as `true`/`false`.
They validate parameters and preconditions, append effects with
lineage through the same §25 action engine, and therefore count as writing
tools. `cave mcp --hooks hooks.json` (or `$CAVE_HOOKS`) supplies the reviewed
out-of-band command templates named by those actions; executable commands are
never read from claims. Hook files must contain valid UTF-8 JSON objects with
nonblank names and string commands. Names and commands must contain well-formed
Unicode, matching action, automation, and doctor checks. Invalid configuration
exits with code 2 before opening the database or starting the protocol, so a
corrected file can be retried without any startup writes.
Hook failure is reported after the committed claims
remain durable, with `isError: true`, the committed-effect summary and the hook
diagnostic. This includes hook lookup or command-type
errors from programmatic configuration before the hook fires. Repeating an
already-applied action reports `not fired (nothing changed)` without retrying
the external operation, even after its configuration is corrected.

## Serving scope

The full surface includes four explicit permission classes: `read` retrieves
stored data, `evaluate` performs ephemeral computation, `record` appends
durable data, and `action` may execute governed effects. `--permissions
<list>` serves only the named classes.

`--read-only` is the compatibility shorthand that keeps `read` and `evaluate`
but drops `record` and `action`; `cave_fuse` therefore survives while
`cave_add`, `cave_derive`, and generated actions disappear. `--tools <list>`
serves only named tools. Every scope composes by intersection:

```
cave mcp --db k.db --read-only
cave mcp --db k.db --permissions read,evaluate
cave mcp --db k.db --permissions record --tools cave_add
cave mcp --db k.db --permissions action --tools act_mark-deployed
cave mcp --db k.db --tools cave_query,cave_about,cave_search
```

Tools outside the scope are absent from `tools/list` and
indistinguishable from nonexistent in `tools/call`; the server
`instructions` mention only served tools, and a surface with no writing
tool declares itself read-only. A scope that names an unknown tool, or
serves nothing, fails at startup — before the database is opened. The
exception is `act_<name>`: generated action tools exist only while the
action is declared and are read from the store on every `tools/list`, so a
scope naming one starts, serving an empty list until the action is declared
(a misspelt action name is an empty list, not a startup error). Read and
evaluation tools carry the MCP `readOnlyHint` annotation, so clients can treat
them accordingly (e.g. auto-approve).

## Actor provenance

`cave_add` stamps `@src:agent/<client-name>` on appended claims that carry
no `@src:` context (spec §9.5), naming the client from the legacy `initialize`
handshake or modern per-request envelope (`@src:agent` without either; a
written `@src:` always wins). `--src <context>` replaces the stamp — useful
for pipelines, e.g. `--src pipeline/nightly` — and `--no-src` disables
stamping. Explicit source tokens reject whitespace and line terminators before
the database is opened or protocol input is read.

## Protocol

The server uses the official
[`@modelcontextprotocol/server` v2 SDK](https://github.com/modelcontextprotocol/typescript-sdk).
Its `serveStdio` entry owns protocol detection and serves both the modern
`2026-07-28` era and initialize-based 2025/2024 clients; legacy fallback stays
enabled. The SDK also owns framing, protocol lifecycle, version negotiation,
request validation, ping, and JSON-RPC errors. CAVE coordinates stream shutdown
and supplies the scoped `tools/list`
and `tools/call` handlers, including dynamic action tools and actor provenance.

Tool failures return `isError` results so the model can correct a call. Stdout
is protocol-only; the startup banner goes to stderr. `createServer` returns the
SDK's low-level `Server` for programmatic embedding, while CAVE's tool surface
remains separately testable without a transport.

## Startup and shutdown

Diagnostic formatting preserves unusual thrown values: an object without a
string representation or an error whose message throws is described as
`[unprintable thrown value]`. Combined failures retain the original values in
`AggregateError.errors` and the primary failure as `cause`. Tool-error replies
and transport shutdown use the same nonthrowing formatter.

`runMcp` owns the store it opens and closes it when serving finishes or startup
fails, including a synchronous exception while writing the startup banner.
It waits for serving to settle before attempting store close once. A lone
operation or close failure retains its identity. If both fail, the returned
promise rejects with an `AggregateError` containing the operation first and as
`cause`, then the close error; its message includes both. These errors are not
written to protocol stdout. The attempt does not guarantee resource release
when native close itself fails.
An already-aborted signal returns quietly with code 0 before argument handling,
database creation or protocol input. The runner captures its signal once and
passes it unchanged to `serve`, preserving cancellation during the announcement
when the caller changes its context or supplies a changing getter.

The programmatic `serve(store, input, output, options)` borrows the supplied
store and streams. It captures `options.signal` once for cancellation checks,
subscription and cleanup. Its returned promise follows these boundaries:

| Event or initial state | Serving behavior |
|---|---|
| Signal already aborted | Resolve without transport setup or input subscription. |
| Input already ended or closed; output already finished or closed | Resolve without transport setup. |
| Normal input EOF | Finish replies to accepted requests, then close the transport and resolve. |
| Input closes before normal EOF | Close the transport without waiting for pending replies. |
| Output finishes or closes | Close the transport without waiting for pending replies or a separate input event. A `finish` event suffices even when the stream does not emit `close`. |
| Signal aborts while serving | Close the transport without waiting for pending replies. |
| Input or output emits an error | Close the transport, then reject with the original stream error. |
| SDK transport closes after an input-buffer error | Reject with that error without waiting for EOF or cancellation. |

The SDK limits its incoming buffer to 10 MiB. Exceeding that limit closes the
session and rejects with the original size-limit diagnostic, even if the client
keeps stdin open. Previously committed data remains available. Reduce buffered
input and start a fresh session; ordinary protocol errors that leave the
transport open retain the recovery behavior described below.

Input buffered before `serve` starts is processed normally if its end event has
not yet fired. Raw protocol input must be valid UTF-8. A streaming validator
rejects malformed bytes before SDK decoding can substitute replacement text;
an incomplete character at EOF also rejects. This closes the session and makes
`cave mcp` exit with code 1 and a UTF-8 diagnostic. Previously committed writes
are not rolled back: a successful `cave_add` reply remains committed if a later
message has invalid bytes. Correct the input and start a fresh session. Valid Unicode
may span input chunks, and explicitly encoded replacement characters remain
ordinary data. Callers supplying already-decoded streams are responsible for
the decoding that happened before `serve` received them.

Malformed newline-delimited frames containing valid UTF-8 (invalid JSON, non-message
JSON values or invalid request IDs) are discarded by the SDK's framing layer;
they do not receive a JSON-RPC reply. Subsequent valid requests in the same
buffer still receive their replies before normal EOF closes the session.
Clients should distinguish this from an accepted request receiving a protocol
error reply. EOF draining includes protocol error replies: an unsupported
revision, invalid metadata or unknown method can be followed by a valid
discovery request, and both receive replies before shutdown.

Transport cleanup removes its stream listeners and the captured abort listener,
and pauses input when no other data listener uses it. It does not destroy
caller-owned streams or close the supplied store. Multiple shutdown events
share transport closure; output failure or cancellation can interrupt EOF
reply draining.

The SDK reports some cleanup failures through its out-of-band error callback
while its close promise resolves. CAVE collects those reports during requested
shutdown and rejects instead of treating cleanup as successful. One failure
retains its identity; multiple cleanup failures form an `AggregateError`.
After an unexpected transport closure, CAVE also waits for the initialized
server's teardown. If both input buffering and server cleanup fail, the rejection
retains both errors, with the input failure as its cause; earlier committed
writes remain intact.
If a stream error initiated shutdown, it remains first and as `cause`, followed
by the reported cleanup errors. Re-reporting that same stream error does not
add it twice. Errors include all messages and never become unsolicited protocol
stdout. Ordinary protocol diagnostics outside shutdown retain their existing
SDK behavior. Failed cleanup is an attempt, not proof of resource release.

## Tests

```
pnpm --filter @cavelang/mcp test
```

Transport-free tests cover every CAVE tool and permission path. End-to-end
tests exercise the SDK's modern discovery, current Copilot initialization,
legacy initialization, and tool calls over stdio.
