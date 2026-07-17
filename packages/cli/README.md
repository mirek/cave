# @cavelang/cli

The `cave` command — the whole stack behind one binary. Runs directly from
TypeScript sources in the workspace; npm releases contain emitted JavaScript.

The supported Node.js lines are 22 and 24: 22.18.0 is the exact minimum, and
24.18.0 Active LTS is recommended. Linux, macOS, and Windows are supported; CI
represents them with Ubuntu 24.04, macOS 15, and Windows Server 2022 and
exercises the CLI's native, filesystem, process, and built-package paths on
each.

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

`cave parse --json` is the parser AST/debug surface, not a persisted claim
record. `cave export` remains canonical CAVE text (with optional `;@` identity
annotations), which is the language interchange contract rather than JSON.

Every command answers `--help` with its options and examples (also
`cave help <command>`). `--db` is optional everywhere: it defaults to
`$CAVE_DB`, or `cave.db` in the current directory.

All commands—synchronous, asynchronous, and long-running—enter through one
promise-based dispatcher. It owns argument-exception formatting, stdout and
stderr routing, exit codes, and SIGINT/SIGTERM propagation. Servers, watchers,
timers, protocol readers, and stores finish their cleanup before a signal exit
is reported. Unexpected errors are one-line and stack-free by default; set
`CAVE_DEBUG=1` to include the diagnostic stack.

| Command | Flags | Behavior |
|---|---|---|
| `parse [file…]` | `--json` | Lint (stdin by default). Exit 1 when diagnostics exist; `--json` dumps the AST document. |
| `highlight [file…]` | | ANSI syntax colors from the tree-sitter grammar's own highlight query (see [`@cavelang/highlight`](../highlight)); `cave export` colors the same way on a terminal. |
| `add [--db p] [file…]` | `--strict`, `--check`, `--no-prelude`, `--no-src` | Ingest. Lenient by default (problems on stderr, valid lines land); `--strict` rolls back on any problem; `--check` is the shape gate (spec §20.3) — the append rolls back if it introduces new expectation violations; `--no-prelude` starts from an empty registry instead of the standard §5.5 pairs. Claims without a `@src:` context are stamped `@src:cli` (spec §9.5); `--no-src` opts out. |
| `import [--db p] [file…]` | `--strict`, `--no-prelude` | Restore/merge a database from CAVE text — `add` minus provenance stamping, because canonical text *is* the interchange format and replayed claims must keep their exported claim keys (spec §9.5). |
| `query [--db p] <pattern…>` | `--json`, `--limit <n>`, `--cursor <t>`, `--all`, `--aliases`, `--as-of <t>`, `--at <t>`, `--resolve`, `--no-prelude` | Bounded CAVE-Q page (100 matches by default, maximum 1,000). Extra positionals join as lines, so `WHERE` filters ride as separate arguments. Bindings print as `?x = value`; fully bound patterns print the matched raw line (or the pattern itself for transitive matches, which carry no row). Human output ends with `next: <token>` when another page exists; pass it to `--cursor` to continue the first page's frozen transaction snapshot. `--aliases` widens matching through the §13.6 closure; `--as-of <t>` reconstructs belief at a past date/timestamp/tx (spec §12.3); `--at <t>` selects valid-time claims and interpolates trajectories (spec §32.4); `--resolve` matches only the winners the §26 resolution policy picks among contested facts (incompatible with `--all`). `--no-prelude` aligns the read-time registry with a store written via `add --no-prelude`. |
| `resolve [--db p]` | `--aliases`, `--policy`, `--json`, `--no-prelude` | Contested facts under the §26 resolution policy: every fact more than one belief series speaks about, candidates ranked (precedence class, reliability-weighted confidence, tx) with the winner first — what `query --resolve` would match. `--policy` prints the effective policy instead: the built-in precedence ladder merged with in-band `source/<name> HAS precedence:` / `HAS reliability:` declarations. |
| `derive [--db p] [rules.cave…]` | `--dry-run`, `--full`, `--aliases`, `--min-conf <p>`, `--max-passes <n>`, `--list`, `--retract <r>`, `--json`, `--no-prelude` | Declare and fire rules (spec §24, see [`@cavelang/rules`](../rules)): `premises => conclusion` forward chaining over current beliefs, `BECAUSE`/`VIA` lineage, watermark-incremental and idempotent; retracts conclusions whose premises no longer hold. |
| `act [--db p] <name> [p=v…]` | `--declare`, `--list`, `--retract <n>`, `--dry-run`, `--no-check`, `--aliases`, `--hooks <file>`, `--json`, `--no-prelude` | Execute an action template (spec §25, see [`@cavelang/act`](../act)): validate parameters, check CAVE-Q preconditions against current belief, append effects atomically with lineage inside the §20.3 shape gate; out-of-band hooks fire after commit. |
| `automate [--db p]` | `--once`, `--declare`, `--list`, `--retract <n>`, `--hooks <file>`, `--agent <template>`, `--json`, `--no-prelude` | The event-driven loop (spec §29, see [`@cavelang/automate`](../automate)): in-band `automation/<name>` trigger patterns over new claims fire rules, actions, out-of-band hooks and agent prompts; `--once` for cron, `--declare`/`--list`/`--retract` for the lifecycle; the daemon polls `MAX(tx)` and settles on change. |
| `check [--db p]` | `--stale <days>`, `--json`, `--no-prelude` | Knowledge health report (spec §20, see [`@cavelang/shape`](../shape)): shape violations against in-band `EXPECTS` declarations, stale current beliefs (default horizon 90 days), review candidates (conf 0.3–0.7), alias disagreements, coverage stats. Exit 1 on violations; everything else is advisory. |
| `backup [--db p] --out <file>` | `--force`; `--verify <file>`, `--sha256 <hex>` | Create an online, exact SQLite snapshot with `VACUUM INTO`, verify it, and publish atomically; or verify a prior snapshot (spec §13.2.2). |
| `restore <snapshot> --db <path>` | `--force`, `--sha256 <hex>` | Verify and atomically restore exact snapshot bytes; refuses active/stale WAL, SHM, and rollback-journal sidecars (spec §13.2.2). |
| `generate [--db p]` | `--out <file>`, `--version <n>`, `--no-prelude` | Deterministic versioned TypeScript interfaces and store-backed readers from current `EXPECTS` claims (spec §20.4, see [`@cavelang/shape`](../shape)); embeds normalized schema and SHA-256, fails on ambiguous/unsupported expectations before writing. |
| `suggest-alias [--db p]` | `--min <s>`, `--limit <n>`, `--agent <template>`, `--timeout <s>`, `--write`, `--json`, `--no-prelude` | Alias discovery (spec §27, see [`@cavelang/shape`](../shape)): same-entity candidates from string/graph similarity as suggested `ALIAS` claims at review-band confidence (0.3–0.5). Prints pipeable CAVE text; `--write` appends stamped `@src:suggest/alias`; `--agent` runs an LLM judge over the candidates (the ingest/eval shell contract). Pairs with any recorded `ALIAS` history are never re-suggested. |
| `sync [--db p] <source>` | `--as <label>`, `--into <label>`, `--dry-run`, `--no-record`, `--json`, `--no-prelude` | Store merge (spec §28, see [`@cavelang/sync`](../sync)): another CAVE store file — or `;@`-annotated canonical text, `-` for stdin — merges by row identity; present rows skip, re-runs merge nothing, effective merges append a `SYNCED-INTO` record (`--no-record` for checkouts, spec §28.6). |
| `export [--db p]` | `--out <file>`, `--current`, `--tx`, `--max-sensitivity <level>`, `--no-prelude` | Sensitivity-scoped canonical CAVE text (spec §9.7) — default maximum `internal`; select `restricted` for complete portable history or a replica. `--current` compacts but never sanitizes permanent history (§9.6). `--tx` precedes every claim line with its `;@` transaction annotation (spec §28.4). Stdout by default; `--out` writes a file and reports the claim count. |
| `report [--db p] [template…]` | `--out <file>`, `--aliases`, `--resolve`, `--as-of <t>`, `--at <t>`, `--max-sensitivity <level>`, `--no-prelude` | Render sensitivity-scoped cited Markdown from fenced and inline CAVE-Q templates (spec §9.7, §31, see [`@cavelang/view`](../view)). Every query uses the same audience, alias, resolution, transaction-time, and valid-time snapshot options. |
| `serve [--db p]` | `--port <n>`, `--host <a>`, `--max-sensitivity <level>`, `--no-prelude` | The sensitivity-scoped human read surface (spec §9.7, §30, see [`@cavelang/view`](../view)): one static page whose counts, aliases, history, lineage, and search are computed only from visible rows. Strictly read-only (GET only), localhost by default. |
| `mcp [--db p]` | `--read-only`, `--permissions <list>`, `--tools <list>`, `--hooks <file>`, `--no-prelude`, `--src <ctx>`, `--no-src` | Serve the engine as an MCP server on stdio (see [`@cavelang/mcp`](../mcp)) — static tools for add/query/fuse/search/about/neighbors/reconstruct/derive/export/lint plus one generated `act_<name>` tool per current action. Permission classes separate `read`, ephemeral `evaluate`, durable `record`, and effect-capable `action`; `--read-only` keeps only read/evaluate. Permission, tool, and read-only scopes intersect. `--hooks` supplies reviewed out-of-band commands for action tools. Appends are stamped `@src:agent/<client-name>` (spec §9.5); `--src` replaces the stamp, `--no-src` disables it. |
| `ingest [--db p] <globs/urls…>` | `--agent <template>`, `--stdout`, `--lenient`, `--plan`, `--dry-run`, `--json`, `--no-prelude` | LLM-driven ingestion of files and web pages (fetched and readability-extracted) through any headless agent (see [`@cavelang/ingest`](../ingest)): strict atomic staging by default; explicit lenient partial progress with a complete per-source manifest; isolated URL outcomes classified as retryable network/HTTP or permanent HTTP failures; batching, hybrid context, MCP or stdout agents, incremental retry digests, and `--plan` NDJSON for SDK drivers. |
| `eval <suite…>` | `--agent <template>`, `--judge <template>`, `--runs <n>`, `--stdout`, `--min <p>`, `--json`, `--no-prelude` | Golden-fixture extraction/query evals (see [`@cavelang/eval`](../eval)): N fresh-store runs against any agent, claim-key + value scoring with §9.5 actor-stamp normalization, CAVE-Q expectations, optional LLM judge, `--min` CI gate. |
| `connect <source>` | `--map <file>`, `--key <field>`, `--watch`, `--prune`, `--query <pattern>`, `--dry-run`, `--no-prelude` | Deterministic structured ingestion (spec §9.8, §23, see [`@cavelang/connect`](../connect)): CSV/TSV/JSON/JSONL/SQLite/URL records through `?field` templates, physical source identity and CSV/TSV/JSONL line spans, per-record digests, `--watch`, `--prune`, query-time overlay. |
| `reconstruct [--db p] <seed…>` | `--query <text>`, `--agent <template>`, `--steps <n>`, `--claims <n>`, `--timeout <s>`, `--trace`, `--no-prelude` | Active memory reconstruction from seed cues (spec §18, see [`@cavelang/loop`](../loop)): best-first traversal collecting related claims as canonical CAVE text; the heuristic policy by default, an LLM select/stop policy with `--agent`. |
| `doctor [--db p]` | `--hooks <file>`, `--json` | Read-only runtime, package-layout, configuration, and store-health diagnostics. Missing optional configuration is advisory; unsupported runtimes, broken assets, malformed configured hooks, and unreadable or corrupt stores fail. Reports identify configuration sources but never expose paths, hook content, URLs, or environment values, so both human and `cave.doctor/v1` JSON output are safe to share. |
| `demo` | | The cave-loop multi-hop recovery demo (§18). |
| `version` | | Print the cave version. |
| `help [command]` | | The overview, or one command's options and examples. |

All query-time arguments share one UTC parser. For example,
`--at 2026-07-02T12:00:00` and `--at 2026-07-02T12:00:00Z` select the same
instant on every host; explicit numeric offsets such as `+02:00` are honored.
The same rule applies to `--as-of` and CAVE-Q `WHERE tx` timestamps.

Every local command uses one bounded process boundary. The pnpm diagnostic
probe uses direct execution on POSIX and a fixed `cmd.exe` launcher for the
Windows command shim, without interpolating user data. Agent
and hook strings are intentionally platform-shell templates: `/bin/sh` on
POSIX, Windows PowerShell on Windows, with placeholder values quoted for that
shell. stdout/stderr limits, timeouts, and CLI cancellation terminate the
complete child tree, and failure messages omit command and environment data.

Shape declarations may add `#cardinality:one` or an attribute
`#unit:<unit>` tag. `cave check` reports the observed count and normalized
units when those constraints fail; declarations without either tag keep the
compatible one-or-more presence check.

## Exact backup and portable interchange

For row identity, transaction time, provenance, lineage, and full history:

```sh
cave backup --db knowledge.db --out knowledge.snapshot.db
cave backup --verify knowledge.snapshot.db --sha256 <recorded-hex>
cave restore knowledge.snapshot.db --db restored.db --sha256 <recorded-hex>
```

Backup is an online, consistent SQLite snapshot safe with WAL and concurrent
readers/writers. CAVE verifies and atomically publishes it. Stop all users of
the destination before restore; a WAL/SHM/journal sidecar makes restore refuse rather
than guess. Failed creation or restore leaves the previous destination intact.

For portable, reviewable CAVE text:

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

Everything is testable without spawning: individual buffered commands expose
`(argv) → { code, out, err }`, while `dispatch(argv, runtime)` exercises the
same awaited path as the binary with injectable streams and an abort signal.
`main.ts` only hands process arguments to `runCli` and assigns its final exit
code.
