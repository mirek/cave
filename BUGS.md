# Bugs and issues

This file collects suspected bugs and design issues found by static analysis. Entries are intended to be reviewed, reproduced, and either fixed or closed as not applicable.

## BUG-001: `connect` record provenance can be bypassed by explicit `@src:` contexts

- **Source:** GPT-5.5 Thinking
- **Severity:** High
- **Status:** Open
- **Area:** `@cavelang/connect`, `@cavelang/store`
- **Relevant files:**
  - `packages/connect/src/run.ts`
  - `packages/connect/README.md`
  - `packages/store/src/store.ts`

### Summary

`connect` says every record-produced claim is auto-stamped with `@src:connect/<name>/<key>` so changed records can retract claims they no longer produce. Internally, `connect` calls `store.ingest(text, { source: subject })` and then retracts stale rows carrying `src:<subject>`.

However, `store.ingest(..., { source })` only stamps a claim when the claim does **not** already contain a `src:` context. A mapping template can therefore include an explicit `@src:...` context and prevent the record lifecycle stamp from being applied.

### Impact

Claims produced from such templates are not associated with the record stamp used by `retractStale`. If the source record changes or disappears, those claims may remain current instead of being retracted. This undermines the deterministic diff/retraction model for `connect`.

### Suggested fix

Prefer one of:

1. Reject explicit `src:` contexts in record templates.
2. Introduce a separate lifecycle context, for example `@connect:<name>/<key>`, that is always applied and used for retraction.
3. Add a store-level append option that forces an internal provenance/lifecycle context even when user-authored source contexts are already present.

## BUG-002: `cave ingest --agent` shell substitutions are unquoted

- **Source:** GPT-5.5 Thinking
- **Severity:** High/Medium
- **Status:** Open
- **Area:** `@cavelang/ingest`
- **Relevant file:** `packages/ingest/src/run.ts`

### Summary

`runShellAgent` replaces `{prompt-file}`, `{mcp-config}`, and `{db}` inside a shell command template, then executes the resulting string with `spawn(command, { shell: true })`.

### Impact

Paths containing spaces or shell metacharacters can break the command. Because `--db` is user-controlled, this is also a shell-injection footgun for users who pass untrusted or dynamically generated paths.

### Suggested fix

Avoid shell command strings for substitutions. Represent agents as `{ command, args }` and call `spawn(command, args, { shell: false })`. If string templates are kept, shell-escape every substituted value before replacement.

## BUG-003: stdout-mode ingest records source digests even when parsing produced problems

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

## BUG-004: MCP `cave_about` may present retracted rows as current claims

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

## BUG-005: `connect` URL fetching has no timeout and inconsistent URL detection

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

## BUG-006: CI validates releases only, not normal pushes or pull requests

- **Source:** GPT-5.5 Thinking
- **Severity:** Medium
- **Status:** Open
- **Area:** GitHub Actions
- **Relevant file:** `.github/workflows/publish.yml`

### Summary

The visible workflow is `Publish`, triggered only by tags matching `v*.*.*`. It installs dependencies, builds the tree-sitter grammar, builds packages, and runs tests before publishing.

### Impact

Release tags are protected by build/test checks, but normal pushes and pull requests do not appear to get automatic validation. Bugs can sit on `main` until release time.

### Suggested fix

Add a separate `CI` workflow for `pull_request` and pushes to `main`, running at least:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm --filter @cavelang/tree-sitter-cave build
- run: pnpm build
- run: pnpm typecheck
- run: pnpm test
```

## BUG-007: current-belief ordering relies on process-local UUIDv7 monotonicity

- **Source:** GPT-5.5 Thinking
- **Severity:** Low/Design
- **Status:** Open
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

## BUG-008: `cave mcp --src` accepts `src:` despite help saying to omit it

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
