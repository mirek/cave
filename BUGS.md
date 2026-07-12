# Bugs and issues

This file collects suspected bugs and design issues found by static analysis. Entries are intended to be reviewed, reproduced, and either fixed or closed as not applicable.

Conventions:

- **Names, not numbers.** Every entry is identified by a short slug (for example `export-clobbers-db`). Numbers are deliberately not used: they go stale the moment an entry is added, removed, or reordered. Refer to entries by slug in commits, PRs, and TODO.md.
- **Ordered by severity.** Open entries are kept sorted most severe / most urgent first, so the next bug to address is always the top open entry. Fixed entries sink to the bottom of the file.
- **Test first.** To address an entry: reproduce the bug with a test and watch it fail, then fix it, then confirm the test passes. Record the resolution in the entry when done.

On 2026-07-10, all 25 merged pull requests and their submitted reviews/inline threads were audited against the current main branch. Review-derived entries below include only concerns still present after that verification; duplicate comments are clustered.

## query-numeric-values: CAVE-Q does not accept normal multi-token or multiplied numeric values

- **Source:** Merged PR review [#1](https://github.com/mirek/cave/pull/1)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/query`
- **Relevant file:** `packages/query/src/pattern.ts`

### Summary

`WHERE value` still uses a decimal-only regex, rejecting values such as `20B USD/yr`. Exact attribute patterns still require exactly one value token, rejecting stored forms such as `900M users/wk`.

### Impact

Users cannot query using the same numeric syntax that ingestion accepts and normalizes.

### Suggested fix

Parse filter and attribute tails with the shared CAVE value parser, then compare normalized number/unit fields.

## about-shows-retracted: MCP `cave_about` may present retracted rows as current claims

- **Source:** GPT-5.5 Thinking
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/mcp`, `@cavelang/store`
- **Relevant files:**
  - `packages/mcp/src/tools.ts`
  - `packages/store/src/store.ts`
  - `packages/query/src/compile.ts`

### Summary

`cave_about` uses `store.currentBeliefs()` and filters rows mentioning the requested entity. `currentBeliefs()` returns the latest row per claim key but does not filter out `conf = 0` rows. By contrast, normal CAVE-Q queries exclude unsupported/retracted current rows by default unless the query explicitly asks otherwise.

### Impact

MCP clients can see retraction rows as “everything currently believed about an entity” and may treat `@ 0%` facts as supported current facts.

### Suggested fix

Filter `conf > 0` in `aboutLines` by default. If retractions are useful in this view, add an explicit `includeRetracted` option or label the output as including retractions.

## stdout-source-identity: stdout ingest changes fallback source identity when content changes

- **Source:** Merged PR review [#8](https://github.com/mirek/cave/pull/8)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/ingest`
- **Relevant file:** `packages/ingest/src/run.ts`

### Summary

Stdout-mode fallback provenance remains `src:ingest/<batch-content-digest>`. Editing a source changes the context and therefore the claim key, so a revised claim does not supersede its previous belief series.

### Impact

Old and new extracted facts can both remain current after a file revision.

### Suggested fix

Use stable source identity derived from connector/path/record identity, or retract the previous digest's generated series before recording the new one.

## partial-ingest-digests: stdout-mode ingest records source digests even when parsing produced problems

- **Source:** GPT-5.5 Thinking
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/ingest`
- **Relevant files:**
  - `packages/ingest/src/run.ts`
  - `packages/ingest/src/files.ts`

### Summary

In stdout mode, agent output is passed through `store.ingest(caveTextOf(output), ...)`. The returned problems are stored in the batch report, but the batch is still marked `ok: true`. Afterward, `Files.recordDigests(store, files)` runs for the successful batch.

### Impact

A partially invalid extraction can still mark its input files or URLs as ingested. A later run will skip those unchanged sources even though the previous extraction had parse/canonicalization problems and may be incomplete.

### Suggested fix

Only record digests when `ingested.problems.length === 0`, or add an explicit option such as `--accept-partial` to keep the current behavior intentionally.

## stale-rule-watermark: re-declared rules inherit stale derive watermarks

- **Source:** Merged PR review [#13](https://github.com/mirek/cave/pull/13)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/rules`
- **Relevant file:** `packages/rules/src/engine.ts`

### Summary

Rule loading still reuses the current `derive-watermark` for a digest without comparing it to the current declaration row. Retracting and re-declaring the same rule can therefore skip all older premises.

### Impact

A re-declared rule may leave its conclusions absent until a new premise arrives or `--full` is used.

### Suggested fix

Clear/retract the watermark with the rule, or ignore it whenever the declaration is newer.

## transitive-trigger-rows: transitive automation triggers cannot see event rows

- **Source:** Merged PR review [#22](https://github.com/mirek/cave/pull/22)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/automate`, `@cavelang/query`
- **Relevant file:** `packages/automate/src/engine.ts`

### Summary

Transitive query matches carry no `found.row`, leaving a trigger solution's row list empty. The firing filter requires at least one row newer than the automation watermark.

### Impact

Automations using allowed `VERB+` premises never fire on newly added edges.

### Suggested fix

Return supporting/event edge rows for trigger evaluation, or separately test whether the transitive result depends on post-watermark edges.

## watch-watermark-race: automate watch can advance past an unprocessed concurrent write

- **Source:** Merged PR review [#22](https://github.com/mirek/cave/pull/22)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/automate`
- **Relevant file:** `packages/automate/src/main.ts`

### Summary

After `settle()`, the watch loop sets `seen` to a fresh `MAX(tx)`. A write arriving after settle's final read but before that assignment is marked seen without being processed.

### Impact

A matching event can be missed indefinitely until another write arrives.

### Suggested fix

Capture the cycle boundary before settling and loop until the observed maximum is fully processed.

## exponent-notation: generated numeric CAVE values can use unsupported scientific notation

- **Source:** Merged PR reviews [#10](https://github.com/mirek/cave/pull/10) and [#18](https://github.com/mirek/cave/pull/18)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/connect`, `@cavelang/mcp`
- **Relevant files:** `packages/connect/src/template.ts`, `packages/mcp/src/tools.ts`

### Summary

Connect formats JSON numbers with `String(value)`; MCP fusion converts `toPrecision` output back through `Number`. Both can emit exponent notation such as `1e-7`, which CAVE's numeric parser does not recognize as a number.

### Impact

Numeric fields/posteriors can round-trip as atoms, breaking filters, checks, and later fusion.

### Suggested fix

Use one shared finite-number formatter that always emits CAVE-compatible decimal or multiplier syntax.

## connect-fetch-timeout: `connect` URL fetching has no timeout and inconsistent URL detection

- **Source:** GPT-5.5 Thinking
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/connect`
- **Relevant files:**
  - `packages/connect/src/source.ts`
  - `packages/ingest/src/web.ts`

### Summary

`connect` loads URLs with plain `fetch(url)`, without timeout, custom headers, or an injected fetch implementation. Its URL detector is also case-sensitive. `ingest` has a more robust implementation: case-insensitive URL detection, request headers, redirect policy, and `AbortSignal.timeout(...)`.

### Impact

`cave connect <url>` can hang indefinitely on slow endpoints, behave differently from `cave ingest <url>`, or fail to recognize uppercase `HTTP://` / `HTTPS://` inputs that `ingest` would accept.

### Suggested fix

Share URL helper code between `ingest` and `connect`, or port the timeout/header behavior into `connect`. Make URL detection case-insensitive in both surfaces.

## connect-exit-zero: federated connect queries exit successfully after mapping failures

- **Source:** Merged PR review [#10](https://github.com/mirek/cave/pull/10)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/connect`
- **Relevant file:** `packages/connect/src/main.ts`

### Summary

`runQuery` prints `report.failures` but still returns 0 in JSON, no-match, and match paths.

### Impact

Scripts and CI can accept incomplete query results as a complete success.

### Suggested fix

Return non-zero whenever any source record failed to instantiate or ingest, while still printing partial results if useful.

## export-error-contract: export output errors escape and its claim count includes qualifier lines

- **Source:** Merged PR reviews [#2](https://github.com/mirek/cave/pull/2) and [#3](https://github.com/mirek/cave/pull/3)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/cli`
- **Relevant file:** `packages/cli/src/cli.ts`

### Summary

`exportCommand` still has `try/finally` without `catch`, so output write failures throw instead of returning the command's `Output` contract. Its count filters transaction annotation lines only; indented qualifier/grouping lines are still reported as claims.

### Impact

Programmatic callers can crash, and successful exports report misleading claim counts.

### Suggested fix

Catch and return write/export failures, and count canonical root claims from structured rows or parser output.

## eval-glob-escape: eval passes discovered filenames back through glob expansion

- **Source:** Merged PR review [#15](https://github.com/mirek/cave/pull/15)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/eval`, `@cavelang/ingest`
- **Relevant file:** `packages/eval/src/run.ts`

### Summary

Eval discovers a concrete fixture path, then passes `basename(kase.source)` as an ingest glob. Filenames containing `[]`, `?`, or `*` are reinterpreted as patterns.

### Impact

An eval can ingest the wrong source or report no batch.

### Suggested fix

Add a literal-path ingest API or escape glob metacharacters before selection.

## report-block-vanishes: failed report query blocks disappear from rendered markdown

- **Source:** Merged PR review [#24](https://github.com/mirek/cave/pull/24)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/view`
- **Relevant file:** `packages/view/src/report.ts`

### Summary

When a fenced `cave-q` query fails, `renderBlock` still returns no lines. The block vanishes even though the report contract says problems are marked in place.

### Impact

An output file can contain a blank section whose failure is visible only on stderr/exit status.

### Suggested fix

Render a visible invalid-query placeholder at the block location.

## inline-splice-backticks: inline report splices only support one-backtick delimiters

- **Source:** Merged PR review [#24](https://github.com/mirek/cave/pull/24)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/view`
- **Relevant file:** `packages/view/src/report.ts`

### Summary

The inline splice scanner remains a regular expression that hard-codes one-backtick delimiters. Valid Markdown code spans with longer delimiters, needed when the query contains a backtick code literal, are misparsed.

### Impact

Valid templates can be mangled or reported as invalid.

### Suggested fix

Scan Markdown code spans while honoring the full opening delimiter length, then recognize `cave-q:` inside the span.

## lineage-truncation-leaf: lineage depth truncation is rendered as a complete leaf

- **Source:** Merged PR review [#23](https://github.com/mirek/cave/pull/23)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/view`
- **Relevant file:** `packages/view/src/api.ts`

### Summary

At depth 16, lineage traversal still returns an empty child array with no truncation marker.

### Impact

The UI/API silently hides valid support and makes an incomplete explanation look complete.

### Suggested fix

Return an explicit truncated node/flag or expose pagination/depth metadata.

## search-limit-pushdown: view search materializes all matches before applying its limit

- **Source:** Merged PR review [#23](https://github.com/mirek/cave/pull/23)
- **Severity:** Medium/Performance
- **Status:** Open
- **Area:** `@cavelang/view`, `@cavelang/store`
- **Relevant file:** `packages/view/src/api.ts`

### Summary

The view still calls `store.search(text).slice(0, limit)`; the FTS query materializes all matches first.

### Impact

Broad searches can block the single HTTP thread and allocate far more memory than the 100-row response needs.

### Suggested fix

Thread a SQL `LIMIT` into the store search API.

## mcp-tsconfig-refs: the MCP TypeScript project omits direct dependency references

- **Source:** Merged PR review [#18](https://github.com/mirek/cave/pull/18)
- **Severity:** Medium
- **Status:** Open
- **Area:** `@cavelang/mcp`
- **Relevant file:** `packages/mcp/tsconfig.json`

### Summary

MCP imports `@cavelang/fusion` and `@cavelang/rules`, but its composite project references still omit `../fusion` and `../rules`.

### Impact

A clean or filtered `tsc -b packages/mcp` can fail or consume stale dependency outputs.

### Suggested fix

Add both direct references and cover a clean filtered MCP build in CI.

## mcp-src-prefix: `cave mcp --src` accepts `src:` despite help saying to omit it

- **Source:** GPT-5.5 Thinking
- **Severity:** Low
- **Status:** Open
- **Area:** `@cavelang/mcp`, `@cavelang/core`
- **Relevant files:**
  - `packages/mcp/src/main.ts`
  - `packages/core/src/context.ts`

### Summary

The `cave mcp` help says `--src <context>` should be passed without the `src:` prefix. Validation still allows `:`. The store stamps source contexts by prepending `src:` to the provided actor string, so `--src src:foo` becomes `@src:src:foo`.

### Impact

Users can accidentally create nested source contexts that do not match intended provenance conventions.

### Suggested fix

Reject values beginning with `src:` or normalize by stripping the prefix before passing the value into source stamping.

## eval-inline-comments: eval rejects its documented inline comments on expectations

- **Source:** Merged PR review [#15](https://github.com/mirek/cave/pull/15)
- **Severity:** Low
- **Status:** Open
- **Area:** `@cavelang/eval`
- **Relevant file:** `packages/eval/src/queries.ts`

### Summary

Documentation shows `none ; comment`, but the parser checks exact trimmed equality with `none` and does not strip inline comments from expectation lines.

### Impact

Otherwise-valid fixtures are rejected before the agent runs.

### Suggested fix

Apply the shared comment splitter to expectation lines before parsing.

## alias-typo-blocking: alias suggestions miss leading-character typos

- **Source:** Merged PR review [#19](https://github.com/mirek/cave/pull/19)
- **Severity:** Low/Recall
- **Status:** Open
- **Area:** `@cavelang/shape`
- **Relevant file:** `packages/shape/src/suggest.ts`

### Summary

Candidate blocking still requires the same first normalized character, an exact token, or a shared rare value. High edit-similarity pairs such as `postgres`/`ostgres` never reach scoring.

### Impact

The advertised typo signal silently misses a common typo class.

### Suggested fix

Add an edit-tolerant block such as suffix/trigram/length buckets before scoring.

## windows-portability: test and demo commands are not Windows-portable

- **Source:** Merged PR review [#1](https://github.com/mirek/cave/pull/1)
- **Severity:** Low/Portability
- **Status:** Open
- **Area:** package scripts, `@cavelang/loop`
- **Relevant files:** `packages/*/package.json`, `packages/loop/src/demo.ts`

### Summary

Package test scripts still single-quote their glob, for example `node --test 'test/*.test.ts'`. Windows cmd.exe passes those quote characters literally. The demo's direct-invocation check also still splits `process.argv[1]` only on `/`, so it misses Windows paths.

### Impact

Package tests and the loop demo can fail or silently not run on Windows.

### Suggested fix

Use a cross-platform test discovery form and compare paths with `node:path`/`fileURLToPath` rather than manual separator handling.

## dry-run-uuid-clock: text-sync dry-runs mutate the process UUID clock

- **Source:** Merged PR review [#20](https://github.com/mirek/cave/pull/20)
- **Severity:** Low/Design
- **Status:** Open
- **Area:** `@cavelang/sync`, `@cavelang/core`
- **Relevant file:** `packages/sync/src/sync.ts`

### Summary

Dry-run text sync still calls `insertResult` with explicit transaction IDs inside a rolled-back SQLite transaction. UUID observation is process state, so a future imported UUID advances later locally minted IDs even though the database write rolls back.

### Impact

A command advertised as writing nothing changes subsequent transaction ordering in the process.

### Suggested fix

Validate without observing IDs, or snapshot and restore generator state around dry-runs.

## multi-process-tx-order: current-belief ordering relies on process-local UUIDv7 monotonicity

- **Source:** GPT-5.5 Thinking
- **Severity:** Low/Design
- **Status:** Open, narrowed — since 0.19.0 the §28.2 receive rule (`Uuidv7.observe`, `packages/store/src/store.ts`) observes a store's `MAX(tx)` at open and after merge, so sequential multi-process writes and post-merge appends order correctly. Still real for two processes holding the same database file open concurrently: each generator only observes at open, so a slow-clock process can mint a tx below a fast-clock peer's fresh append.
- **Area:** `@cavelang/core`, `@cavelang/store`
- **Relevant files:**
  - `packages/core/src/uuidv7.ts`
  - `packages/store/src/store.ts`

### Summary

Current belief is resolved by `MAX(tx)` per `claim_key`. The UUIDv7 generator is strictly monotonic only within a single process.

### Impact

If multiple processes write to the same SQLite database with skewed clocks, “latest” can be wrong. This may be acceptable for a local single-writer tool, but it is an implicit invariant.

### Suggested fix

Document single-writer expectations clearly. If multi-process writes are intended, add a SQLite-controlled commit sequence column and use that to resolve current belief ordering.

## example-wording: reviewed example wording remains incorrect

- **Source:** Merged PR review [#5](https://github.com/mirek/cave/pull/5)
- **Severity:** Low/Documentation
- **Status:** Open
- **Area:** examples
- **Relevant files:** `examples/incident/incident.md`, `examples/README.md`

### Summary

The reviewed phrases “payments goes through” and “its hand extraction to CAVE” remain unchanged.

### Suggested fix

Use “the payments service goes through” and “its hand extraction into CAVE” (or equivalent wording).

## as-of-future-inverses: as-of queries use inverse declarations from the future

- **Source:** Merged PR review [#12](https://github.com/mirek/cave/pull/12)
- **Severity:** Medium
- **Status:** Fixed by [PR #36](https://github.com/mirek/cave/pull/36); regression test `asOf does not use inverse declarations recorded after the boundary (spec §12.3)` (`packages/query/test/asof.test.ts`)
- **Area:** `@cavelang/query`, `@cavelang/store`
- **Relevant files:**
  - `packages/query/src/bounded.ts`
  - `packages/store/src/open.ts`

### Summary

Rows and resolution policy were rewound for `asOf`, but patterns were compiled with `store.registry()`, rebuilt from all declarations. An inverse declared after the boundary was therefore usable in a historical query.

### Impact

Historical queries could return facts using vocabulary that did not exist at that time.

### Resolution

The public store now retains its configured base registry and can reconstruct the verb registry from declaration rows visible at an `asOf` boundary. Public query and match calls substitute that historical registry during compilation while the existing SQL continues to apply the same boundary to claims, aliases, transitive edges, and resolution policy. Future inverse and extension declarations can no longer affect historical query interpretation.

## alias-literal-terms: alias closure treats literal terms as entities

- **Source:** Merged PR review [#7](https://github.com/mirek/cave/pull/7)
- **Severity:** Medium
- **Status:** Fixed in 0.25.2; regression tests `literal terms are not entities: the closure never links through them` (`packages/query/test/alias.test.ts`) and `literal terms are not entities: closure and traversal skip them` (`packages/store/test/alias.test.ts`)
- **Area:** `@cavelang/query`, `@cavelang/store`
- **Relevant files:**
  - `packages/query/src/compile.ts`
  - `packages/store/src/store.ts`
  - `packages/store/src/row.ts`

### Summary

Both alias-edge CTEs accepted every positive `ALIAS` row with a non-null object. They did not exclude code/text literal encodings, despite alias closure being defined for entity terms (spec §13.6: "The closure applies to entity positions only").

### Impact

With aliases enabled, queries could widen through literal values and return unrelated rows: two entities aliasing one `"…"`/`` `…` `` literal became transitive aliases of each other, and a pattern naming a literal matched rows about entities aliased to it. The store surfaces (`aliasesOf`, traversal, `claimsAbout`, resolution grouping) widened the same way.

### Resolution

The suggested fix: both alias endpoints must be entity-form terms. A shared SQL predicate — `Row.entityTermSql`, the stored-text dual of `Row.parseTerm` — excludes literal encodings from both `alias_edge` CTEs: the store's (feeding `aliasesOf`, traversal and §26 resolution grouping) and the query compiler's (feeding single-hop, transitive and `resolve` matching, which all widen through the same edge set). An `ALIAS` row with a literal endpoint now contributes no edge; entity-to-entity aliases in the same store still widen as before. The §13.6 reference CTE in the spec skill shows the entity-form condition.

## agent-shell-quoting: `cave ingest --agent` shell substitutions are unquoted

- **Source:** GPT-5.5 Thinking
- **Severity:** High/Medium
- **Status:** Fixed in 0.25.1; regression tests `runShellAgent shell-quotes substituted values — spaces, quotes and $() arrive verbatim` and `shell agent run: a db path with spaces stays one argument` (`packages/ingest/test/run.test.ts`), and `shellComplete shell-quotes {prompt-file} — a temp dir with spaces still works` (`packages/loop/test/llm.test.ts`)
- **Area:** `@cavelang/ingest`, `@cavelang/loop`
- **Relevant files:**
  - `packages/ingest/src/run.ts`
  - `packages/loop/src/llm.ts`

### Summary

`runShellAgent` replaced `{prompt-file}`, `{mcp-config}`, and `{db}` inside a shell command template, then executed the resulting string with `spawn(command, { shell: true })`. `loop`'s `shellComplete` carried an unshared copy of the same unquoted `{prompt-file}` substitution.

### Impact

Paths containing spaces or shell metacharacters could break the command. Because `--db` is user-controlled, this was also a shell-injection footgun for users who pass untrusted or dynamically generated paths.

### Resolution

Suggested fix 2 (templates kept, values escaped): every substituted value is now POSIX-single-quoted before replacement — the `shellQuote` convention act/automate hooks already use (spec §25.4) — in both `runShellAgent` (covering `cave ingest --agent` plus the eval agent and judge) and `shellComplete` (covering `cave reconstruct --agent`, the suggest-alias judge, and automate prompt steps). A substituted value always lands as one argument and is never shell-evaluated; placeholders are written bare — wrapping one in your own quotes (e.g. `"{db}"`) now yields literal quote characters. The ingest/loop READMEs and every `--agent` help text document the quoting.

## src-stamp-bypass: `connect` record provenance can be bypassed by explicit `@src:` contexts

- **Source:** GPT-5.5 Thinking; merged PR reviews [#13](https://github.com/mirek/cave/pull/13) and [#14](https://github.com/mirek/cave/pull/14)
- **Severity:** High
- **Status:** Fixed in 0.25.0; regression tests `an authored @src: context cannot bypass the record lifecycle stamp` (`packages/connect/test/run.test.ts`), `a conclusion naming its own @src: still carries the rule stamp — retraction propagates` and `--retract finds conclusions that name their own @src:` (`packages/rules/test/engine.test.ts`), `an effect naming its own @src: still carries execution attribution` (`packages/act/test/engine.test.ts`), and the two `lifecycle stamping …` tests in `packages/store/test/provenance.test.ts`
- **Area:** `@cavelang/connect`, `@cavelang/rules`, `@cavelang/act`, `@cavelang/store`
- **Relevant files:**
  - `packages/connect/src/run.ts`
  - `packages/connect/README.md`
  - `packages/store/src/store.ts`
  - `packages/rules/src/engine.ts`
  - `packages/act/src/engine.ts`

### Summary

`connect` says every record-produced claim is auto-stamped with `@src:connect/<name>/<key>` so changed records can retract claims they no longer produce. Internally, `connect` calls `store.ingest(text, { source: subject })` and then retracts stale rows carrying `src:<subject>`.

However, `store.ingest(..., { source })` only stamps a claim when the claim does **not** already contain a `src:` context. A mapping template can therefore include an explicit `@src:...` context and prevent the record lifecycle stamp from being applied. The same bypass exists for rule conclusions and action effects: their engines rely on `insertResult(..., { source })`, which also declines to add the mandatory rule/action source when any authored `src:` context already exists.

### Impact

Claims produced from such templates are not associated with the record stamp used by `retractStale`. If the source record changes or disappears, those claims may remain current instead of being retracted. This undermines the deterministic diff/retraction model for `connect`. Rule conclusions can survive premise or rule retraction because `suspend()`/`retractRule()` find them by the missing rule source. Action effects lose the mandatory execution attribution.

### Resolution

Suggested fix 3 (a store-level append option forcing the lifecycle context): `AppendOptions.lifecycle` makes `stampSource` apply `@src:<source>` even when the claim already names a source — the authored context is kept alongside the stamp (multi-source rows resolve per §26.3), and the exact stamp context is never duplicated. `connect` record units, rule conclusions (`conclude` + `insertResult`), and action effects (`instantiate` + `insertResult`) now stamp through this option, so `retractStale`, `suspend()`/`retractRule()`, and execution attribution always find their rows. Plain append surfaces (`cave add`, MCP, ingest, automate replies) keep the §9.5 author-wins rule, preserving the cross-actor retraction pattern. Spec skills (§9.5, §24.3, §25.2, §23.2 extraction guide, cave-writing §6.1) and the connect README now document lifecycle stamps as the exception.

## export-clobbers-db: export could overwrite and corrupt its source database

- **Source:** Merged PR review [#2](https://github.com/mirek/cave/pull/2)
- **Severity:** High
- **Status:** Fixed in 0.24.2; regression test `export refuses --out that would overwrite the source database` in `packages/cli/test/cli.test.ts`
- **Area:** `@cavelang/cli`
- **Relevant file:** `packages/cli/src/cli.ts`

### Summary

`cave export --db knowledge.db --out knowledge.db` called `writeFileSync` on the open database path after reading it, replacing SQLite data with text. Equivalent paths and links were not checked.

### Impact

A backup command could destroy the source database.

### Resolution

`exportCommand` now compares the two paths before opening the store and fails with exit 1 (`--out '<path>' is the source database — refusing to overwrite it`) when they name the same file: equal once resolved against the working directory, or — when both exist — an equal device/inode pair, which also catches symlinks and hard links to the database.

## ci-releases-only: CI validates releases only, not normal pushes or pull requests

- **Source:** GPT-5.5 Thinking
- **Severity:** Medium
- **Status:** Fixed by [PR #25](https://github.com/mirek/cave/pull/25); residual gaps tracked in `TODO.md` §3.4 — the smoke script never runs in CI, and CI tests Node 22 while publish uses Node 26
- **Area:** GitHub Actions
- **Relevant file:** `.github/workflows/publish.yml`

### Summary

The visible workflow is `Publish`, triggered only by tags matching `v*.*.*`. It installs dependencies, builds the tree-sitter grammar, builds packages, and runs tests before publishing.

### Impact

Release tags are protected by build/test checks, but normal pushes and pull requests do not appear to get automatic validation. Bugs can sit on `main` until release time.

### Resolution

`.github/workflows/ci.yml` now runs on pull requests and pushes to `main` and performs install, tree-sitter generation, build, and tests. The original suggested workflow was for `pull_request` and pushes to `main`, running at least:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm --filter @cavelang/tree-sitter-cave build
- run: pnpm build
- run: pnpm typecheck
- run: pnpm test
```
