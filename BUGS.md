# Bugs and issues

This file collects suspected bugs and design issues found by static analysis. Entries are intended to be reviewed, reproduced, and either fixed or closed as not applicable.

Conventions:

- **Names, not numbers.** Every entry is identified by a short slug (for example `export-clobbers-db`). Numbers are deliberately not used: they go stale the moment an entry is added, removed, or reordered. Refer to entries by slug in commits, PRs, and TODO.md.
- **Ordered by severity.** Entries are kept sorted most severe / most urgent first, so the next bug to address is always the top entry.
- **Test first.** To address an entry: reproduce the bug with a test and watch it fail, then fix it, then confirm the test passes.
- **Addressed entries are removed.** The fixing commit and the regression test it names are the record; git history keeps the entry text.

On 2026-07-10, all 25 merged pull requests and their submitted reviews/inline threads were audited against the current main branch. Review-derived entries below include only concerns still present after that verification; duplicate comments are clustered.

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

## digest-path-lexing: ingest digest claims for paths that are not entity atoms never parse

- **Source:** Found while writing the eval-glob-escape regression tests
- **Severity:** Medium/Cost
- **Status:** Open
- **Area:** `@cavelang/ingest`
- **Relevant file:** `packages/ingest/src/files.ts`

### Summary

`recordDigests` builds provenance text by interpolating the file path into a CAVE line. A path that does not lex as an entity atom — one containing a space, for example — produces an invalid line (`expected an UPPERCASE verb, got "..."`), and the problems returned by `store.ingest` are discarded, so the digest claim silently never lands. `isIngested` keys the lookup programmatically (`Claim.entity(path)`), so it never matches either.

### Impact

A file whose path is not a valid entity atom (`design notes.md`, matched by `*.md` or passed as a literal `files` entry) is re-selected and re-ingested by every run — repeated agent spend with no incremental skip — while ingest reports success.

### Suggested fix

Record digests through a path representation that round-trips the parser (or append the provenance claim programmatically rather than via text), and surface `store.ingest` problems from `recordDigests` instead of discarding them.

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
