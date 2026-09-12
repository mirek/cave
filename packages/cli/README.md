# @cavelang/cli

The `cave` command — the whole stack behind one binary. Runs directly from
TypeScript sources in the workspace; npm releases contain emitted JavaScript.

The shared CAVE text reader requires valid UTF-8 in files and standard input.
Malformed bytes produce a filename or stdin diagnostic instead of silently
becoming replacement characters. `parse`, `add` and `import` return status 1
without stdout on this decoding error; invalid additions/imports leave existing
history unchanged, and `add` rejects the input before creating a missing database.
Explicit replacement characters, accented text and emoji remain valid input.
Action execution and doctor share hook-file validation: configuration must be
valid UTF-8 JSON mapping nonblank names to command strings, with no unpaired
surrogates in names or commands. Invalid configuration fails before action
effects; doctor reports the failure without revealing configuration contents.

The supported Node.js lines are 24 and 26: 24.16.0 and 26.1.0 are their exact minimums,
24.21.0 Active LTS is recommended, and 26.8.1 Current is also tested. Linux,
macOS, and Windows are supported; CI represents them with Ubuntu 24.04, macOS
15, and Windows Server 2022 and exercises the CLI's native, filesystem,
process, and built-package paths on each.

```
$ echo 'auth USES jwt @ 90%' | pnpm exec cave parse
ok: 1 claim

$ pnpm exec cave add --db knowledge.db notes.cave
added 12 claim(s), 3 edge(s)

$ pnpm exec cave query --db knowledge.db '?x USES jwt'
?x = auth/middleware
?x = api/gateway

$ pnpm exec cave query --db knowledge.db '?cause CAUSE app/crash' 'WHERE conf >= 0.7'
$ pnpm exec cave export --db knowledge.db --current --max-sensitivity internal
$ pnpm exec cave demo
```

## Programmatic feature subpaths

The package manifest is the entry-point registry. Every published entry point
is documented here and follows the CLI package's semantic-versioning promise:

| Entry point | Contract |
|---|---|
| `@cavelang/cli` | Buffered command functions plus the shared dispatcher and command registry. |
| `@cavelang/cli/main` | Executable process entry point; prefer the `cave` binary from package scripts. |
| `@cavelang/cli/act` | Action declarations and governed execution. |
| `@cavelang/cli/automate` | Event-driven automation declarations and settling. |
| `@cavelang/cli/connect` | Deterministic structured-source ingestion. |
| `@cavelang/cli/eval` | Golden-fixture extraction and reconstruction evaluation. |
| `@cavelang/cli/ingest` | LLM-driven document ingestion. |
| `@cavelang/cli/loop` | Active memory reconstruction. |
| `@cavelang/cli/mcp` | MCP tools, scopes, and stdio server. |
| `@cavelang/cli/rules` | Rule declarations and forward chaining. |
| `@cavelang/cli/shape` | Expectations, health checks, and typed-client generation. |
| `@cavelang/cli/sync` | Store synchronization and annotated interchange. |
| `@cavelang/cli/view` | Read-only view models, HTTP serving, and cited reports. |

For example:

```ts
import { declareRules, derive } from '@cavelang/cli/rules'
import { createServer } from '@cavelang/cli/mcp'
```

The source modules remain separate private workspace packages for focused
ownership and tests. See [the package migration table](../../PACKAGE_SURFACES.md)
when updating an import from a former standalone package name.

The CLI build checks literal runtime imports in its published `dist/src` and
`dist/internal` trees after consolidation. External package roots must appear
in the CLI's dependencies, optional dependencies or peer dependencies; a private
workspace's development dependency alone is insufficient. Diagnostics identify
the importing file and package. Compiled tests are excluded. Computed import
names, package-local aliases, export targets and actual dependency availability
still require the installed-package smoke checks.

## Commands

### JSON compatibility

JSON that contains claims is storage-independent and versioned. `cave query
--json` emits a `cave.query-page/v1` object whose `matches` are
`cave.query-match/v1` objects and whose `claim` and `support` members are
`cave.claim/v1`; its optional `next` value is an opaque continuation. Resolve,
rule, action, and health JSON
replace any nested database rows with the same claim record and never expose
`claim_key`, `raw_line`, or `value_text` columns. New optional fields may be
added within a version; incompatible shape changes require a new version.

Query parse failures exit with status 1 and write diagnostics to stderr, leaving
stdout empty even with `--json`. Filter line numbers count blank and comment
lines in the supplied query; separate positional arguments join with newlines.
Confidence thresholds must be finite. Correcting a failed query requires no
database rebuild or recovery.

`cave parse --json` is the parser AST/debug surface, not a persisted claim
record. `cave export` remains canonical CAVE text (with optional `;@` identity
annotations), which is the language interchange contract rather than JSON.

Every command answers `--help` with its options and examples (also
`cave help <command>`). `--db` is optional everywhere: it defaults to
`$CAVE_DB`, or `cave.db` in the current directory. It names a store by
content, not by extension: a SQLite file opens as usual, and any other file
is CAVE text, replayed into an in-memory store before a read-only command
runs (`query`, `search`, `resolve`, `check`, `export`, `report`, `generate`,
`serve`, `mcp --read-only`, dry-run and `--list` modes), exactly as `cave
import` would store it. Commands that append refuse a text file and point at
`cave import --db <store.db> <file>`; a read against a missing path is an
error rather than a fresh empty database, and a read never migrates an older
store — it names the writing command that does (spec §13.7). Dry runs
(`derive --dry-run`, `act --dry-run`, `sync --dry-run`, `connect --query`)
append inside a rolled-back transaction, so they open writable but likewise
create and migrate nothing; `ingest --plan` and `--dry-run` only read, and
plan against an empty in-memory store when no store exists yet.

All commands—synchronous, asynchronous, and long-running—enter through one
promise-based dispatcher. It owns argument-exception formatting, stdout and
stderr routing, exit codes, and SIGINT/SIGTERM propagation. An already-aborted
runtime signal stops dispatch before argument normalization, command loading,
or command-specific I/O; dispatch returns quietly with code 0, while the process
wrapper retains signal exit codes. Servers, watchers,
timers, protocol readers, and stores finish their cleanup before a signal exit
is reported. Unexpected errors are one-line and stack-free by default; set
`CAVE_DEBUG=1` to include the diagnostic stack.

Ingestion cancellation also interrupts pending URL requests and response reads.
SIGINT exits with code 130 after cleanup, without reporting cancellation as an
unexpected error; strict ingestion leaves the target unchanged.

| Command | Flags | Behavior |
|---|---|---|
| `parse [file…]` | `--json` | Lint (stdin by default). Exit 1 when diagnostics exist; `--json` dumps the AST document. |
| `highlight [file…]` | | ANSI syntax colors from the tree-sitter grammar's own highlight query (see [`@cavelang/highlight`](../highlight)); `cave export` colors the same way on a terminal. |
| `add [--db p] [file…]` | `--strict`, `--check`, `--no-prelude`, `--no-src` | Ingest. Lenient by default (problems on stderr, valid lines land); `--strict` rolls back on any problem; `--check` is the shape gate (spec §20.3) — the append rolls back if it introduces new expectation violations; `--no-prelude` starts from an empty registry instead of the standard §5.5 pairs. Claims without a `@src:` context are stamped `@src:cli` (spec §9.5); `--no-src` opts out. |
| `import [--db p] [file…]` | `--strict`, `--no-prelude` | Restore/merge a database from CAVE text — `add` minus provenance stamping, because canonical text *is* the interchange format and replayed claims must keep their exported claim keys (spec §9.5). |
| `query [--db p] <pattern…>` | `--json`, `--limit <n>`, `--cursor <t>`, `--all`, `--aliases`, `--as-of <t>`, `--at <t>`, `--resolve`, `--sources`, `--no-prelude` | Bounded CAVE-Q page (100 matches by default, maximum 1,000). Extra positionals join as lines, so `WHERE` filters ride as separate arguments. Bindings print as `?x = value`, followed by `  ; comment` when the matched claim carries one (a multi-line comment opens as `;` lines above the binding line, as it does above a claim), so evidence written next to a claim travels with the answer; fully bound patterns print the matched raw line, comment block included (or the pattern itself for transitive matches, which carry no row). Human output ends with `next: <token>` when another page exists; pass it to `--cursor` to continue the first page's frozen transaction snapshot. A historical-row or lineage change rejects the cursor; restart without `--cursor`. `--aliases` widens matching through the §13.6 closure; `--as-of <t>` reconstructs belief at a past date/timestamp/tx (spec §12.3); `--at <t>` selects valid-time claims and interpolates trajectories (spec §32.4); `--resolve` matches only the winners the §26 resolution policy picks among contested facts (incompatible with `--all`). `--sources` overlays the store's declared sources (spec §23.4) inside a rolled-back transaction — federation-lite, nothing persists, URLs included; the answer is whole (no `--cursor`), and a text store, which followed its local sources on open, loads only its URL sources here. `--no-prelude` aligns the read-time registry with a store written via `add --no-prelude`. |
| `search [--db p] <terms…>` | `--raw`, `--limit <n>`, `--json`, `--no-prelude` | FTS5 full-text search over the store's index (spec §13.2): subject, verb, object, attribute name, value text, comment, and the raw line as written, so tags, contexts, and inverse spellings match too. The terms are one literal phrase by default (hyphenated names such as `token-expiry` are safe); `--raw` passes FTS5 MATCH syntax through (`AND`/`OR`/`NOT`, `NEAR`, `prefix*`, column filters such as `comment:heap`). Newest first, one raw line per match with its comment; `--limit` defaults to 100 (maximum 1,000) and a trailing `more matches beyond <n>` line reports a cap. `--json` emits a `cave.search/v1` object whose matches are `cave.claim/v1` records. Superseded and retracted rows stay searchable (spec §9.6); confirm currency with `query`. |
| `resolve [--db p]` | `--aliases`, `--policy`, `--json`, `--no-prelude` | Contested facts under the §26 resolution policy: every fact more than one belief series speaks about, candidates ranked (precedence class, reliability-weighted confidence, tx) with the winner first — what `query --resolve` would match. `--policy` prints the effective policy instead: the built-in precedence ladder merged with in-band `source/<name> HAS precedence:` / `HAS reliability:` declarations. |
| `derive [--db p] [rules.cave…]` | `--dry-run`, `--full`, `--aliases`, `--min-conf <p>`, `--max-passes <n>`, `--list`, `--retract <r>`, `--json`, `--no-prelude` | Declare and fire rules (spec §24, see [`@cavelang/rules`](../rules)): `premises => conclusion` forward chaining over current beliefs, `BECAUSE`/`VIA` lineage, watermark-incremental and idempotent; retracts conclusions whose premises no longer hold. Declaration errors exit nonzero in both text and JSON modes. Pass exhaustion exits nonzero, reports `complete: false` in JSON and labels the final text summary `derived (incomplete)`. |
| `act [--db p] <name> [p=v…]` | `--declare`, `--list`, `--retract <n>`, `--dry-run`, `--no-check`, `--aliases`, `--hooks <file>`, `--json`, `--no-prelude` | Execute an action template (spec §25, see [`@cavelang/act`](../act)): validate parameters, check CAVE-Q preconditions against current belief, append effects atomically with lineage inside the §20.3 shape gate; out-of-band hooks fire after commit. |
| `automate [--db p]` | `--once`, `--declare`, `--list`, `--retract <n>`, `--hooks <file>`, `--agent <template>`, `--json`, `--no-prelude` | The event-driven loop (spec §29, see [`@cavelang/automate`](../automate)): in-band `automation/<name>` trigger patterns over new claims fire rules, actions, out-of-band hooks and agent prompts; `--once` for cron (nonzero on incomplete settling or failures), `--declare`/`--list`/`--retract` for the lifecycle; the daemon polls `MAX(tx)` and settles on change. |
| `check [--db p]` | `--stale <days>`, `--json`, `--no-prelude` | Knowledge health report (spec §20, see [`@cavelang/shape`](../shape)): shape violations against in-band `EXPECTS` declarations, stale current beliefs (default horizon 90 days), review candidates (conf 0.3–0.7), alias disagreements, coverage stats. Exit 1 on violations; everything else is advisory. |
| `backup [--db p] --out <file>` | `--force`; `--verify <file>`, `--sha256 <hex>` | Create an online, exact snapshot of the store, verify it, and publish it atomically; or verify a prior snapshot (spec §13.2.2). |
| `restore <snapshot> --db <path>` | `--force`, `--sha256 <hex>` | Verify and atomically restore exact snapshot bytes; refuses active/stale WAL, SHM, and rollback-journal sidecars (spec §13.2.2). |
| `generate [--db p]` | `--out <file>`, `--version <n>`, `--no-prelude` | Deterministic versioned TypeScript interfaces and store-backed readers from current `EXPECTS` claims (spec §20.4, see [`@cavelang/shape`](../shape)); embeds normalized schema and SHA-256, fails on ambiguous/unsupported expectations before writing. |
| `suggest-alias [--db p]` | `--min <s>`, `--limit <n>`, `--agent <template>`, `--timeout <s>`, `--write`, `--json`, `--no-prelude` | Alias discovery (spec §27, see [`@cavelang/shape`](../shape)): `--min` requires a finite score in 0..1 or a percentage and `--limit` a positive safe integer. Returns same-entity candidates from string/graph similarity as suggested `ALIAS` claims at review-band confidence (0.3–0.5). Prints pipeable CAVE text, reversing the undirected relation when necessary to preserve entity names; an unrepresentable pair reports an error. `--write` validates each fresh line against its proposed pair before appending stamped `@src:suggest/alias`; `--agent` runs an LLM judge over the candidates (the ingest/eval shell contract). Pairs with any recorded `ALIAS` history are never re-suggested; writes recheck both directions under the transaction reservation and skip reviewed pairs. `--json` returns an array; `--json --write` writes and returns `{ suggestions, appended }`, with the selected proposals and actual appended count. |
| `sync [--db p] <source>` | `--as <label>`, `--into <label>`, `--dry-run`, `--no-record`, `--json`, `--no-prelude` | Store merge (spec §28, see [`@cavelang/sync`](../sync)): another CAVE store file — or `;@`-annotated canonical text, `-` for stdin — merges by row identity; matching present rows skip, conflicting identities reject the source with a nonzero exit, re-runs merge nothing, effective merges append a `SYNCED-INTO` record (`--no-record` for checkouts, spec §28.6). |
| `export [--db p]` | `--out <file>`, `--current`, `--tx`, `--max-sensitivity <level>`, `--no-prelude` | Sensitivity-scoped canonical CAVE text (spec §9.7) — default maximum `internal`; select `restricted` for complete portable history or a replica. `--current` compacts but never sanitizes permanent history (§9.6). `--tx` precedes every claim line with its `;@` transaction annotation, including a JSON provenance payload when contexts cannot reconstruct stored dimensions (spec §28.4). Stdout by default; `--out` writes a file and reports the claim count. |
| `report [--db p] [template…]` | `--out <file>`, `--aliases`, `--resolve`, `--as-of <t>`, `--at <t>`, `--max-sensitivity <level>`, `--no-prelude` | Render sensitivity-scoped cited Markdown from fenced and inline CAVE-Q templates (spec §9.7, §31, see [`@cavelang/view`](../view)). Every query uses the same audience, alias, resolution, transaction-time, and valid-time snapshot options. |
| `serve [--db p]` | `--port <n>`, `--host <a>`, `--max-sensitivity <level>`, `--no-prelude` | The sensitivity-scoped human read surface (spec §9.7, §30, see [`@cavelang/view`](../view)): one static page whose counts, aliases, history, lineage, and search are computed only from visible rows. Strictly read-only (GET/HEAD only), localhost by default. |
| `mcp [--db p]` | `--read-only`, `--permissions <list>`, `--tools <list>`, `--hooks <file>`, `--no-prelude`, `--src <ctx>`, `--no-src` | Serve the engine as an MCP server on stdio (see [`@cavelang/mcp`](../mcp)) — static tools for version-matched help plus add/query/fuse/search/about/neighbors/reconstruct/derive/export/lint, and one generated `act_<name>` tool per current action. Permission classes separate `read`, ephemeral `evaluate`, durable `record`, and effect-capable `action`; `--read-only` keeps only read/evaluate. Permission, tool, and read-only scopes intersect. `--hooks` supplies reviewed out-of-band commands for action tools. Appends are stamped `@src:agent/<client-name>` (spec §9.5); `--src` replaces the stamp, `--no-src` disables it. |
| `ingest [--db p] <globs/urls…>` | `--agent <template>`, `--stdout`, `--lenient`, `--plan`, `--dry-run`, `--json`, `--no-prelude` | LLM-driven ingestion of files and web pages (fetched and readability-extracted) through any headless agent (see [`@cavelang/ingest`](../ingest)): strict atomic staging by default; explicit lenient partial progress with a complete per-source manifest; isolated URL outcomes classified as retryable network/HTTP or permanent HTTP failures; batching, hybrid context, MCP or stdout agents, incremental retry digests, and `--plan` NDJSON for SDK drivers. Execution `--json` cannot be combined with `--plan` or `--dry-run`. |
| `eval <suite…>` | `--agent <template>`, `--judge <template>`, `--runs <n>`, `--stdout`, `--min <p>`, `--json`, `--no-prelude` | Golden-fixture extraction/query evals (see [`@cavelang/eval`](../eval)): N fresh-store runs against any agent, claim-key + value scoring with §9.5 actor-stamp normalization, CAVE-Q expectations, optional LLM judge, `--min` CI gate. |
| `connect [<source>]` | `--map <file\|inline>`, `--key <field>`, `--sql <query>`, `--watch`, `--prune`, `--query <pattern>`, `--dry-run`, `--list`, `--no-prelude` | Deterministic structured ingestion (spec §9.8, §23, see [`@cavelang/connect`](../connect)): CSV/TSV/JSON/JSONL/SQLite/URL records through `?field` templates (a file, or inline as a comma-separated list of claim lines), `--sql` reshaping any tabular source through a temporary SQLite table first, physical source identity and CSV/TSV/JSONL line spans, per-record digests, `--watch`, `--prune`, query-time overlay. Without a source, the store's declared sources run (spec §23.4): `source/<name> HAS path: …` claims with `map`, `key`, `format`, `delimiter`, `table`, `sql`, and `records` attributes mirror the options, a `.cave` path needs no map, and paths resolve against the store's directory; `--list` prints them, `--name` selects one, `--query` overlays them all, `--watch` re-runs on any of their files. A CAVE text file used as `--db` follows its declared sources on every open. |
| `reconstruct [--db p] <seed…>` | `--query <text>`, `--agent <template>`, `--steps <n>`, `--claims <n>`, `--timeout <s>`, `--trace`, `--no-prelude` | Active memory reconstruction from seed cues (spec §18, see [`@cavelang/loop`](../loop)): best-first traversal collecting related claims as canonical CAVE text; the heuristic policy by default, an LLM select/stop policy with `--agent`. |
| `doctor [--db p]` | `--hooks <file>`, `--json` | Read-only runtime, package, configuration and store-health checks. See [Diagnosis](#diagnosis) for results, snapshot behavior and privacy. |
| `demo` | | The cave-loop multi-hop recovery demo (§18). |
| `version` | | Print the cave version. |
| `help [command]` | | The overview, or one command's options and examples. |

File output from `export`, `report`, `generate` and `backup` cannot target the
source database or its SQLite `-wal`, `-shm` and `-journal` files. The check
includes database symlinks, existing file aliases and resolved output-parent
directories, including sidecars that SQLite has not created yet. Text stores
retain protection for their source file without reserving SQLite sidecar names.

All query-time arguments share one UTC parser. For example,
`--at 2026-07-02T12:00:00` and `--at 2026-07-02T12:00:00Z` select the same
instant on every host; explicit numeric offsets such as `+02:00` are honored.
The same rule applies to `--as-of` and CAVE-Q `WHERE tx` timestamps.

Every local command uses one bounded process boundary. The pnpm diagnostic
probe uses direct execution on POSIX and a fixed `cmd.exe` launcher for the
Windows command shim, without interpolating user data. Agent
and hook strings are intentionally platform-shell templates: `/bin/sh` on
POSIX, PowerShell 7 (`pwsh`) on Windows, with placeholder values quoted for that
shell. stdout/stderr limits, timeouts, and CLI cancellation terminate the
complete child tree, and failure messages omit command and environment data.

Shape declarations may add `#cardinality:one` or an attribute
`#unit:<unit>` tag. `cave check` reports the observed count and normalized
units when those constraints fail; declarations without either tag keep the
compatible one-or-more presence check.
The text coverage summary rounds average confidence to a whole percent, using
`<1%` or `>99%` when rounding would otherwise imply zero or certainty.
`cave check --json` retains the numeric average; when no current positive
beliefs remain, the JSON average is null and the text omits it.
Health-report text appends findings iteratively, so large violation, stale,
review and alias-disagreement sections do not exceed JavaScript's
function-argument limit. A regression checks all 130,000 review candidates
and retains the successful exit status for advisory findings. Reports still
assemble in memory; this is not a finding-count or output-memory budget.
`cave resolve --policy` likewise calculates table width iteratively. Large
sets of source declarations retain complete, aligned policy rows without
exceeding JavaScript's function-argument limit; the policy and output remain
in memory.
Resolution text rounds reliability and effective confidence to one decimal
percent, using `<0.1%` and `>99.9%` when rounding would otherwise imply zero
or certainty. Exact zero and one remain `0%` and `100%`; JSON retains numbers.

## Diagnosis

Use doctor to check an installation and store without repairing or migrating it:

```sh
cave doctor --db knowledge.db
cave doctor --db knowledge.db \
  --hooks hooks.json --json
```

A normal diagnosis returns status 0 when no checks fail, including when warnings
remain, or status 1 when a check fails. Missing optional configuration is
advisory. Unsupported runtimes, broken package assets, malformed configured
hooks, and unreadable or corrupt stores fail. Read each failed check's remediation
before retrying; doctor does not perform the repair for you.

A readable schema-version-0 database without `cave_` or `idx_cave_` objects
is reported as uninitialized. Unrelated names such as `caveat` do not imply
a CAVE migration; existing CAVE prefixes are recognized without regard to case.

For current-schema SQLite stores, the database checks cover:

| Check | What it examines |
|---|---|
| `store.integrity` | SQLite integrity and foreign-key references. |
| `store.rows` | Canonical lowercase UUIDv7 row identity with `id = tx`; payload-column consistency; binary negation, importance and approximation flags; finite confidence in [0, 1]; positive finite sigma levels, with null retaining the legacy default. It also streams stored history through the row decoder to check authored values and their numeric caches, and rejects empty or non-text explicit provenance values. |
| `store.search` | Search entries match stored claims, without missing, duplicate, orphaned or stale entries. This is separate from SQLite integrity. |

The `store.rows` scan also recomputes every historical claim's key using its
stored contexts. A mismatch fails diagnosis even when a newer revision is
valid. Contexts are read through the claim index while history is streamed;
diagnosis does not collect all history or repair keys. Corrected keys and
contexts are checked again on the next invocation.
The scan also loads stored tags and checks canonical claim emission, so
unemittable terms, contexts or tags fail diagnosis before export or sync.
Malformed contents remain redacted and the database is left unchanged for
repair and retry.

Stored edge roles must be `WHEN`, `VIA`, `BECAUSE` or `QUALIFIES`. Unsupported
roles also fail `store.rows` without printing the role or changing the database;
diagnosis checks the corrected relationships again after repair.

Provenance validation covers actor, source, run and domain entries without
printing their values or claim identities. SQLite TEXT affinity alone permits
binary values, and SQLite integrity checks do not reject empty strings; these
therefore belong to the semantic row check. A failed check leaves the database
unchanged. Correct the affected data or restore a verified backup, then rerun
doctor before retrying annotated export.

SQLite diagnosis holds one read transaction across schema, integrity, row and
search checks, so the report describes one snapshot. A subsequent invocation sees
later commits. With rollback journaling, the read transaction can temporarily
block a writer's commit; closing the diagnostic connection releases its locks.

A database close failure adds `store.cleanup` while preserving completed checks.
For a successfully assembled text store, this retains its claim count and does
not mislabel cleanup failure as a parse or declared-source loading failure.
A temporary SQLite capability-probe close failure adds `runtime.sqlite.cleanup`
while retaining the capability result. Both are failures with redacted messages.

Human-readable and `cave.doctor/v1` JSON reports identify configuration sources
but omit paths, hook contents, URLs, claim contents and environment values,
including when a text store or declared source cannot load. The targeted checks
do not establish semantic correctness of every historical claim.

The programmatic `diagnose({ db, hooks })` API captures both options once before
inspection. Changing getters cannot alter the reported database configuration
source or switch hook files during diagnosis; a later call can use new options.

## Exact backup and portable interchange

For row identity, transaction time, provenance, lineage, and full history:

```sh
cave backup --db knowledge.db --out knowledge.snapshot.db
cave backup --verify knowledge.snapshot.db --sha256 <recorded-hex>
cave restore knowledge.snapshot.db --db restored.db --sha256 <recorded-hex>
```

Verify and restore the standalone snapshot produced by `cave backup`.
Backup verification checks SQLite integrity, schema and the supplied checksum.
It can preserve structurally valid rows with semantic errors, such as damaged
claim keys or empty provenance. Run `cave doctor --db restored.db` to diagnose
the restored copy before export or sync. Keeping the original snapshot allows
repair work on the copy without changing that recovery point.
Snapshots from schema version 1 through the current version remain recoverable.
Verification and restore preserve their bytes and schema version; the next
writable open migrates the restored copy, leaving the retained backup untouched.
Unversioned and newer schema formats are rejected.
Verification rejects sources with SQLite WAL, shared-memory or rollback-journal
sidecars, whose contents would not be covered by a checksum of the main file.
Backup and restore also refuse destination sidecars even with `--force`, and
restore cannot write into a sidecar path belonging to its source snapshot.

Backup is an online, consistent SQLite snapshot safe with WAL and concurrent
readers/writers. CAVE verifies and atomically publishes it. Stop all users of
the destination before restore; a WAL/SHM/journal sidecar makes restore refuse rather
than guess. Failed creation or restore leaves the previous destination intact.

For portable, reviewable CAVE text:

`export --out`, `generate --out` and `report --out` write and flush a temporary
file in the destination directory before atomically replacing the output.
Write, flush, file-close or rename failures leave an existing output intact.
Export decoding errors, including conflicting historical payload columns and
invalid confidence or sigma levels, return status 1 with the affected claim ID and no partial stdout.
Annotated export rejects stored claim keys that disagree with the claim and
its contexts, so replay cannot silently change the belief series associated
with a transaction. It also rejects empty or non-string stored provenance values
before producing a replay file. Existing output
files and database bytes remain unchanged, and absent output files stay absent.
Sensitivity filtering still applies before decoding: excluded malformed rows do
not prevent a narrower export. Repair the included row before retrying a complete
export.
Cleanup attempts both file closure and temporary-file removal. Multiple failures
are retained in operation order rather than allowing cleanup to hide the first
error. If the output did not exist, these publication failures leave it absent;
the same command can be retried after the filesystem failure is resolved.
If temporary-directory cleanup fails after replacement, the complete file
remains published, but the command returns status 1 without a success message.
The error explicitly identifies the published output and temporary directory,
and retains the cleanup failure as its cause. Inspect the complete output and
the named temporary directory before deciding whether another export is needed.
Existing permission bits
are retained; valid symlinks are followed without replacing the link, while
hard-link aliases retain the old file. Dangling symlinks and non-regular files
are refused. Replacement requires write access to the destination directory.
This protects against partial output writes; it does not promise persistence
of the directory rename across power loss. Shell redirection (`>`) retains the
shell's ordinary truncation behavior.

If `report` throws while generating a stored citation, it exits with status 1,
names the affected claim in stderr and emits no report to stdout. An existing
`--out` file stays intact and a new output path stays absent, including when
earlier queries in the template succeeded. Retry after resolving the evidence
failure. Ordinary template/query problems still produce diagnostic Markdown
and status 1; that complete diagnostic document can be written to `--out`.
Invalid report `--at` or `--as-of` options fail before reading templates or
opening the store and leave the output unchanged, even for a static template.

```
$ cave export --db knowledge.db --max-sensitivity restricted --out backup.cave
exported 812 claim(s) to backup.cave

$ cave import --db restored.db backup.cave
added 812 claim(s), 37 edge(s)
```

With the explicit `restricted` ceiling, the text round trip preserves every
claim with its metadata and the **belief-series order** (rows export in tx
order and re-ingest with fresh monotonic tx ids, so latest-tx-wins resolution
is unchanged),
qualifier/grouping edges, and in-band registry declarations (`REVERSE`,
`RENAMED-TO`, `X IS verb`) — a restored database answers current-belief and
graph queries equivalently, including inverse and lifecycle spellings. Original
transaction timestamps are re-minted: canonical CAVE text carries no transaction
identity, so original as-of boundaries and staleness are not preserved. Use
`--current` for a compact
view of current beliefs only (history intentionally omitted from that
view). Lower ceilings use the order `public < internal < confidential <
restricted`; unlabeled rows are `internal`, while malformed or unknown labels
fail closed as `restricted`. Filtering is not a sanitization tool: current
claim text and every other
database, export, sync peer, backup, snapshot, or clone may still retain
sensitive content. CAVE has no claim-level redact command (§9.6); after an
accidental secret ingest, rotate it, stop sync, rebuild a reviewed safe store,
then explicitly destroy or expire every affected copy with the relevant
storage provider's confirmation.

`cave sync --json` emits a report on stdout for successful merges and rejected
claim/annotation content; a nonempty `problems` array also sets exit status 1.
Source-access, UTF-8 and database failures instead produce stderr diagnostics
and empty stdout with status 1. Check status and available stdout before parsing
JSON, including for dry runs. Correcting the source allows a fresh preview and
retry against the same target.
If final store closure fails after a report is produced, stdout retains that
JSON, stderr adds the cleanup diagnostic, and status is nonzero. A completed
merge may already be committed even when the command exits with a failure.

Everything is testable without spawning: individual buffered commands expose
`(argv) → { code, out, err }`, while `dispatch(argv, runtime)` exercises the
same awaited path as the binary with injectable streams and an abort signal.
`main.ts` only hands process arguments to `runCli` and assigns its final exit
code.

Buffered commands that own a store wait for their work to finish, then attempt
store close once. A close failure preserves completed `out` and existing `err`,
appends a `store close failed` diagnostic, and changes a successful status to 1;
an existing nonzero status is retained. Operation errors become ordinary failure
output before cleanup, so a later close failure cannot hide them. This covers
ingestion, queries (including async source overlays), search, resolution,
derivation, actions, checks, backup, alias suggestions, sync, reports, export,
client generation and reconstruction. Async source or agent work settles before
its store closes. Completed writes, generated files and published snapshots are
not undone by final-close failure; query overlays still roll back their scratch
writes. A close attempt does not guarantee release when native close fails.
Within these owned-store wrappers, thrown values that cannot be printed use
`[unprintable thrown value]`. Formatting failures cannot skip the close attempt,
erase completed output, or hide a simultaneous cleanup failure. This applies
to synchronous commands and awaited source-query work.
The outer dispatcher uses the same safe formatting for unexpected exceptions.
Debug output captures a stack once; if reading or formatting it fails, the
dispatcher falls back to the message, then the unprintable-value placeholder.
Normal diagnostics do not read the stack. A formatting failure therefore cannot
replace the command's status-1 diagnostic with a rejected dispatch promise.
The command-level catches for backup, restore, alias suggestion and
reconstruction use the same placeholder for unreadable setup failures, including
file inspection before a store is owned. Direct programmatic calls retain their
ordinary `{ code, out, err }` failure result in those cases.
