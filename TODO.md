# CAVE — TODO

The roadmap that used to live here (`ROADMAP.md`) is finished: all 19
numbered items shipped, 0.6.0 through 0.24.0, and the complete knowledge
loop — sense, model, conclude, act, trust, distribute — runs on one
machine. This file keeps what remains: the edges the roadmap left
deliberately unfinished, the open design decisions, and issues found by
a deep pass over the implementation at 0.24.1 (2026-07-10). Suspected
bugs with full write-ups live in [BUGS.md](BUGS.md); entries here
reference them where they overlap. The retired roadmap numbering
("ROADMAP item N", "open decision N" in package docs and comments) is
preserved in the appendix.

Severity: **high** (fix soon — wrong results, silent data loss, or a
release risk) · **med** (real but bounded) · **low** (polish).

## 1. Carried over from the roadmap

The capability edges that were partial or missing when the roadmap
closed, plus the two undecided design decisions. The ground rules
(§19.5) still apply: no new core syntax unless semantics demand it,
in-band declarations over config, executable things out-of-band,
append-only always, the agent outside the language — and each shipped
item is its own lockstep version bump.

1. **Value-shape expectations.** `EXPECTS` + `cave check` (spec §20)
   validate presence only; unit and cardinality expectations are
   missing — "everything `EXTENDS+ service` expects `owner`" is
   checkable, "expects exactly one `owner`" or "expects `latency` in ms"
   is not.
2. **Verb lifecycle** *(open decision 4)*. Renaming or deprecating a
   verb strands historical claims under the old name; entity `ALIAS`
   doesn't apply to verbs. Needs a `REVERSE`-style in-band convention
   (verb-alias declarations honored by the registry) and spec design.
3. **Redaction / forgetting** *(open decision 3)*. Ingesting external
   data will eventually capture a secret or PII, and retraction `@ 0%`
   leaves the text in `raw_line` and every export. Either commit to
   documented permanence, or spec `cave redact` as a declared,
   exceptional, history-rewriting operation that leaves a tombstone
   claim. Silence is the one wrong option.
4. **Sensitivity-aware export.** A lightweight `#sensitivity:`
   convention honored by export/serve filters.
5. **Source-span provenance.** `@src:` names a source at file level; a
   `@src:file#L10-L20` span convention is cheap and lets a claim answer
   "which sentence produced you".
6. **Typed client generation.** Generate typed TypeScript query helpers
   from the store's own schema claims (the schema is already in-band).
7. **Push/listener continuous ingestion.** `cave connect --watch`
   covers file tailing; push sources (sockets, webhooks) stay out of
   scope until something needs them.

Draft layer (§17), still gated on demand as the spec requires:
variables in the core grammar (§17.1 — CAVE-Q's `?x` layer is
implemented), reification `[S V O]` (§17.2), and temporal layer 3
`(t -> expr)` functions (§17.5 — layers 1–2 shipped as §32).

## 2. Known bugs (BUGS.md)

BUGS.md tracks thirty entries, named by short slug and kept sorted most
severe first. This pass independently re-verified the eight entries
below at 0.24.1; the remaining twenty-two — recorded in #27 from an
audit of all merged-PR reviews — landed in parallel and were not
re-verified here. Overlaps are cross-referenced in §3.

- **src-stamp-bypass** open — confirmed end-to-end for `connect`; #27
  widened the entry to rule conclusions and action effects
  (`insertResult` declines the mandatory stamp when an authored `src:`
  exists), and §3.1 adds the automate echo-filter escape — one systemic
  decision.
- **agent-shell-quoting** open — unquoted shell substitutions in
  `ingest`'s `runShellAgent` (`packages/ingest/src/run.ts`), with an
  unshared copy in `loop`'s `shellComplete` (`packages/loop/src/llm.ts`).
  Reach: the eval agent and judge, `cave reconstruct --agent`, the
  suggest-alias judge, automate prompt steps. By contrast act/automate
  *hooks* quote correctly (`shellQuote`, `packages/act/src/engine.ts`) —
  reuse that or switch to `{command, args}` arrays.
- **partial-ingest-digests** open — stdout-mode ingest records digests
  despite parse problems (`packages/ingest/src/run.ts`).
- **about-shows-retracted** open — MCP `cave_about` shows retracted
  (`conf = 0`) rows as current (`packages/mcp/src/tools.ts`); the same
  root behavior feeds eval's produced-facts scoring and
  `cave_reconstruct`'s `claimsAbout`.
- **connect-fetch-timeout** open — `connect` URL fetch has no
  timeout/headers and case-sensitive detection; the same detector
  mis-routes `HTTPS://… --watch` past the no-URLs guard onto the file
  path (`packages/connect/src/source.ts`, `main.ts`). No fetch injection
  point, so the URL path is untestable.
- **ci-releases-only** fixed — CI runs on pushes and PRs (#25); residual
  gaps in §3.4 below.
- **multi-process-tx-order** open, narrowed — the §28.2 receive rule
  covers sequential multi-process writes and merges; still real for two
  processes holding the same file open concurrently.
- **mcp-src-prefix** open — `cave mcp --src src:foo` yields nested
  `@src:src:foo` (`packages/mcp/src/main.ts`).

## 3. Found by analysis (0.24.1)

### 3.1 Correctness

- **high — the explicit-`@src:` escape is systemic** (src-stamp-bypass,
  widened by #27 to rules and act). A claim template that names its own `@src:`
  context skips the engine's lifecycle stamp (`stampSource` /
  `insertResult`, `packages/store/src/store.ts`), reproduced end-to-end
  in three engines: `connect` records escape retract-on-change and
  `--prune`; rule conclusions escape §24.5 well-founded support and
  `cave derive --retract` (`packages/rules/src/engine.ts`,
  `declare.ts` — retracting a premise leaves the conclusion current
  forever); and — the piece src-stamp-bypass doesn't yet cover —
  automate agent
  replies and action effects escape the echo filter
  (`packages/automate/src/engine.ts`): a reply matching its own trigger
  re-fires every pass, invoking the agent repeatedly, contradicting
  §29.3 and the "never wakes itself" claim. One decision covers all of
  it: reject `src:` in templates, force-stamp, or track lifecycle by
  lineage (`VIA`) instead of source context — then align spec
  §23.2/§24.3/§29.3.
- **med — zoneless timestamps parse as local time.** `--as-of`,
  `WHERE tx` and `--at` boundaries shift with the machine timezone for
  `2026-01-15T10:30:00`-style input: bare dates are forced UTC but
  `T`-timestamps fall to `Date.parse`'s local-time semantics
  (`txBounds`, `packages/query/src/compile.ts`; `parseInstant`,
  `packages/core/src/time.ts`). Treat zoneless as UTC or reject.
- **med — `emitClaim` renders unparseable lines for symbolic
  comparison conditions.** Only `>` maps to `EXCEEDS`; `<`, `>=`,
  `<=`, `=`, `!=` become the claim's *verb* — not a legal uppercase
  atom — so `cpu >= 90%` condition rows re-parse as errors wherever
  `emitClaim` output is consumed directly: the store's `raw_line`
  fallback and `cave report` citation footnotes
  (`packages/canonical/src/canonicalize.ts`, `emit.ts`). Give every
  operator a verb-form emission.
- **med — one failing URL aborts the whole ingest run.** `Web.select`
  fetches via `Promise.all` and `fetchDocument` throws on non-OK; no
  catch anywhere up the chain, so healthy file sources in the same run
  ingest nothing and the CLI dies with a stack trace
  (`packages/ingest/src/web.ts`, `main.ts`).
- **med — ingest digest bookkeeping fails silently for odd
  paths/URLs.** The provenance claim is built by string interpolation
  and its parse problems are discarded (`recordDigests`,
  `packages/ingest/src/files.ts`); a path with whitespace or a `;` in a
  URL never records, so the source is re-fetched and re-extracted (a
  paid LLM call) on every run. Build the claim programmatically like
  `provenanceKey` already does.
- **med — automate daemon can stall on pending events**
  (= watch-watermark-race, found independently by this pass). `cycle()`
  snapshots `seen = maxTxOf(store)` after settle — including on the
  catch path — so a row landing during settle (or a mid-cycle failure)
  leaves events pending until an unrelated later append
  (`packages/automate/src/main.ts`). Snapshot before settling and don't
  advance on error.
- **low — rules `maxPasses` truncation falsely retracts.** Hitting the
  pass cap still runs the retraction sweep, transiently retracting
  suspended derivations whose premises hold (deep chains under
  `--full`), then re-deriving next run — sound eventually, spurious
  `@ 0%` churn in belief history (`packages/rules/src/engine.ts`).
- **low — `connect --watch` attaches watchers after the initial
  pass**, missing edits during a long first pass, and drops events with
  a `null` filename (`packages/connect/src/main.ts`).
- **low — MCP scope edge serves zero tools silently.**
  `--read-only --tools act_<name>` starts and serves an empty
  `tools/list`, against the fail-loudly contract
  (`packages/mcp/src/tools.ts`, `server.ts`).
- **low — MCP `initialize` echoes any requested `protocolVersion`**,
  and JSON-RPC batch arrays are dropped without a response
  (`packages/mcp/src/server.ts`).
- **low — `cave report` citations break on backticks.** Rule/action
  declarations legitimately contain `` ` ``; single-backtick code spans
  in footnotes and default bullets produce broken markdown
  (`packages/view/src/report.ts`). Output-side sibling of
  inline-splice-backticks, which tracks the input side (the splice
  scanner hard-codes one-backtick delimiters).
- **low — async CLI commands crash with raw stack traces on bad
  flags** (`mcp`, `ingest`, `eval`, `serve`, `highlight`) while sync
  commands print the clean one-line error (`packages/cli/src/main.ts`).
- **low — `(0σ)` is accepted silently and the two σ implementations
  disagree.** `Claim.sigmaOf` returns `Infinity` where
  `Uncertainty.sigma` throws, and fusion silently zero-weights such
  estimates (`packages/parser/src/line.ts`,
  `packages/core/src/claim.ts`, `uncertainty.ts`). Diagnose at parse
  and keep one validated implementation.
- **low — `Value.isDateLike` accepts out-of-calendar shapes**
  (`2026-13`, `2026-02-30`, `2026-W15-99`) that `Time.parsePeriod`
  rejects — one string, two classifications: `x IS 2026-13` becomes a
  metric claim (`packages/core/src/value.ts`). Tighten `dateRe` or
  reuse `parsePeriod`.
- **low — alias value-disagreement can be mis-attributed.** A purely
  intra-name actor fork counts as a cross-name disagreement in
  `cave check` (`packages/shape/src/check.ts`); require an actual
  cross-name differing pair (§20.2's definition).
- **low — `fuseClaims` fuses mixed units silently.** The §10.1
  one-quantity/one-unit "fail loudly" guard lives only in the MCP
  surface; the library call fuses `18B USD/yr` with `30ms`
  (`packages/fusion/src/fuse.ts`).

### 3.2 Grammar drift (hand parser vs tree-sitter)

- **med — the grammar rejects what the parser accepts.** Negative
  numbers (`delta IS -5ms`, trajectory endpoint `-5 -> 5 C` — both
  asserted by core tests) and non-ASCII entities (`Zürich`) produce
  ERROR nodes in the single grammar behind `cave highlight` and the
  VSCode extension (number/entity tokens,
  `packages/tree-sitter-cave/grammar.js`). Allow a leading `-`, widen
  the entity class — or spec ASCII-only atoms in §16.
- **low — `highlights.scm` missed the 0.24.0 trajectory arrow.** `->`
  in `20B -> 40B USD/yr` has no capture, so it renders unstyled in the
  terminal and VSCode. Add `(value "->" @operator)`.
- **low — classification corners diverge.** Indented two-token
  all-verb lines (`LIKE BECOMES`) are claims (missing object) to the
  hand parser but valid continuations to the grammar, and the grammar's
  verb regex accepts trailing-hyphen `FOO-` which `verb.ts` rejects.
  Align, or document the divergence with corpus cases.

### 3.3 Performance (measured)

- **high — no `claim_id` index on `cave_context`/`cave_tag`.** §26
  resolution runs correlated context subqueries per current row:
  `resolvedBeliefs()`/`contested()` on a 10k-row store take ~33 s;
  adding the index drops it to 0.29 s (110×). Also hits
  `toClaim`/`exportText`, the `--at` context pass, and shape's
  `scopeOf` (`packages/store/src/schema.ts` — extra indexes don't
  contradict the spec-verbatim DDL).
- **high — `shape.evaluate()` is one full-store SQL per
  (instance, expectation).** 3,000 instances × 2 expectations on a
  12k-row store ≈ 72 s, and the §20.3 gate evaluates twice per gated
  append (`packages/shape/src/check.ts`, `gate.ts`). Make satisfaction
  set-based or materialize current beliefs once per evaluate.
- **med — transitive patterns compute the all-pairs closure first.**
  The `VERB+` recursive CTE is unrestricted; endpoint filters apply
  outside the recursion — a fully bound `a EXTENDS+ b` over 2,000 edges
  takes ~7.7 s vs 4 ms single-hop (`packages/query/src/compile.ts`).
  Seed the recursion from a bound endpoint like the alias closure
  already does.

### 3.4 CI, release and packaging

- **high — `scripts/smoke.sh` never runs in CI or publish.** It is the
  only check that the pack-time `publishConfig` exports/bin swap to
  `dist/` actually works; a tag pushed without `make release` publishes
  tarballs nobody pack-installed (`.github/workflows/*.yml`).
- **med — publish workflow guards.** Fires on any `v*.*.*` tag with no
  check that the commit is on `main` or that the tag matches the
  committed version (those checks live only in the Makefile), and
  force-stamps manifests from the tag name; a partial publish can't be
  re-run (`pnpm -r publish` hits E409 on the already-published half);
  CI tests Node 22 while publish runs Node 26 (type stripping differs
  across 22/24/26); the wasi-sdk download for the grammar WASM is
  uncached, so a third-party outage blocks releases
  (`.github/workflows/publish.yml`, `ci.yml`).
- **med — License.md ships in 2 of 20 packages.** Every manifest lists
  it in `files`, only publish.yml copies it in; `make publish` (the
  documented first-publish path) ships no license text, and the shipped
  license links `./Authors.md`, which no path packs.
- **med — smoke.sh gaps.** Never exercises `import`, `act`, `report`,
  `connect`, `mcp` (all offline-smokable), never imports a library
  package, and leaks the `cave serve` process when an assertion fails
  between spawn and kill (move the kill into the EXIT trap).
- **low — `tree-sitter.json` metadata version is stale** at 0.5.0
  against the lockstep version; the file ships in the tarball. Add it
  to the bump sweep or generate it in `prepack`.
- **low — `typecheck` is literally `build`.** Both scripts are
  `tsc -b` (composite projects always emit), so `make check` builds
  twice and the name implies a side-effect-free check that doesn't
  exist. Collapse or document.
- **low — the VS Code extension has no packaging path.** CI bundles it
  via the recursive test, but `vsce package` runs nowhere, no release
  channel exists, and the publish version stamp skips `editors/*`.
- **low — manifest and tooling polish.** No
  `keywords`/`homepage`/`bugs` in any published package;
  `make bootstrap` can install a pnpm that ignores the `packageManager`
  pin (and its corepack leg dies on Node ≥ 25); `clean` misses
  `editors/vscode/dist`; publish.yml actions are major-tag pinned
  despite holding npm-publish OIDC rights.

### 3.5 Docs drift

- **high — the README `cave act` walkthrough fails as documented.** The
  `?parent EXISTS` precondition matches nothing in the walkthrough
  store (CAVE-Q `EXISTS` needs an explicit existence claim), so the
  shown command exits 1 — the only README transcript that doesn't
  reproduce. Change the precondition (e.g. `?parent PARENT-OF _`) or
  add the missing append, and re-capture.
- **med — IMPLEMENTATION.md drift.** "No build step … `tsc --noEmit`
  typechecks" — in fact `tsc -b` emits `dist/` everywhere (composite +
  declaration, `outDir` set, prepack builds, publishConfig points at
  dist); the true story is run-from-src via type stripping in dev,
  emitting build for typecheck/publish (`packages/cli/README.md`
  repeats the claim). "External runtime dependency: `@prelude/parser`"
  omits `web-tree-sitter`, `@mozilla/readability`, `linkedom`.
  "Comparisons become `left EXCEEDS value`" is only true for `>`
  (§3.1's emitter bug).
- **med — the 0.24.0 temporal surface is missing from five READMEs.**
  `packages/query` (no `at`/§32/trajectories), `packages/core` (no
  `Time`/trajectory rows in the module table), `packages/cli` (query
  row lacks `--at`), `packages/mcp` (`cave_query` row lacks `at`),
  `packages/view` ("only `--aliases` and `--as-of` compose").
- **med — command-surface omissions.** `packages/cli/README.md` has no
  `report` row; `packages/mcp/README.md` omits the generated
  `act_<name>` tools, `--hooks`/`$CAVE_HOOKS`, and that `--read-only`
  drops action tools.
- **low — smaller README drift.** `packages/store/README.md` documents
  `exportText({current})` without the `tx` option the whole
  sync/branching story rests on; `packages/parser/README.md` claims
  `a USES b stray` gets a diagnostic (it silently parses as the
  multi-word object `b-stray`); `packages/core/README.md` scopes metric
  classification to `IS` while any verb's numeric/date payload becomes
  a metric.
- **low — help/description strings cite the retired numbering.**
  `cave --help` "(items 9, 10)", `cave eval --help` "(ROADMAP items 9
  and 10)", `@cavelang/eval`'s npm description — they resolve via the
  appendix below, or reword to spec references.

### 3.6 Test gaps

- **med** — `connect --watch` (debounce, watcher setup) and connect URL
  sources (needs fetch injection); the automate poll daemon
  (`runWatch`/`seen`); the explicit-`@src:` lifecycle behaviors of
  §3.1 — all unpinned, which is exactly why §3.1 regressed silently.
- **low** — no test re-parses `emitClaim` output for stored
  `>=`/`=`/`!=` condition claims (why the emitter bug survives); the
  tree-sitter corpus has no `UNLESS`/`VIA`/`BECAUSE` line, no
  nested-claim qualifier payload, no negative value; `@90%` without a
  space (silently context `"90%"`, confidence stays 1) is unpinned and
  arguably deserves a lint; MCP malformed-input paths (`-32700` parse
  error, `-32600` invalid request, batch arrays); serve HTML-escaping
  under hostile store text (correct at every render site today, but one
  missed `esc()` in a future view is a stored-XSS regression nothing
  would catch); FTS quote escaping in `store.search`;
  zoneless-timestamp boundaries; disagreement attribution; mixed-unit
  fusion.

## 4. Permanent non-goals

Multi-tenant access-control frameworks; organizations/workspaces/project
hierarchies; app builders and analytics suites; hosted services of any
kind; distributed compute engines; model catalogs (`--agent` shell
templates already externalize model choice); read-side audit logging;
Kubernetes anything. Staying small *is the product*: every capability
must remain runnable offline, on one machine, over one SQLite file, with
plain text as the escape hatch.

## Appendix — the retired roadmap

`ROADMAP.md` tracked 19 numbered items and 4 open design decisions.
References of the form "ROADMAP item N" / "open decision N" in package
READMEs, source comments and `--help` output resolve here:

| item | shipped | capability |
|---|---|---|
| 1 | 0.6.0 | alias closure (spec §13.6) |
| 2 | 0.7.0 | actor provenance (§9.5) |
| 3 | 0.8.0 | shape expectations + `cave check` (§20) |
| 4 | 0.9.0 | deterministic structured ingestion `cave connect` (§23) |
| 5 | 0.10.0 | MCP serving scope (`--read-only`, `--tools`) |
| 6 | 0.11.0 | as-of queries (§12.3) |
| 7 | 0.12.0 | rules engine `cave derive` (§24) |
| 8 | 0.13.0 | action templates `cave act` (§25) |
| 9 | 0.14.0 | evals harness `cave eval` |
| 10 | 0.15.0 | LLM loop policy (`cave reconstruct --agent`) |
| 11 | 0.16.0 | contradiction resolution (§26) |
| 12 | 0.17.0 | named computation MCP tools (`cave_fuse`, `cave_derive`) |
| 13 | 0.18.0 | alias discovery `cave suggest-alias` (§27) |
| 14 | 0.19.0 | store merge `cave sync` (§28) |
| 15 | 0.20.0 | branching convention (§28.6) |
| 16 | 0.21.0 | automations `cave automate` (§29) |
| 17 | 0.22.0 | human read surface `cave serve` (§30) |
| 18 | 0.23.0 | reports with citations `cave report` (§31) |
| 19 | 0.24.0 | temporal values + `cave query --at` (§32) |

Open decisions: **1** (sync tx semantics) decided in 0.19.0 as spec
§28 — keep origin tx, the row id is global identity, Lamport receive
rule; **2** (alias closure vs claim-key identity) decided in 0.6.0 as
spec §13.6 — union-of-rows, with disagreement surfacing shipped in
0.8.0; **3** (append-only vs forgetting) and **4** (verb lifecycle)
remain open — items 3 and 2 in §1 above.
