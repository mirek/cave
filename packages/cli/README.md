# @cavelang/cli

The `cave` command — the whole stack behind one binary. Runs directly from
TypeScript sources via Node's type stripping; no build step.

```
$ echo 'auth USES jwt @ 90%' | pnpm exec cave parse
ok: 1 claim

$ pnpm exec cave add --db knowledge.db notes.cave
added 12 claim(s), 3 edge(s)

$ pnpm exec cave query --db knowledge.db '?x USES jwt'
?x = auth/middleware
?x = api/gateway

$ pnpm exec cave query --db knowledge.db '?cause CAUSE app/crash' 'WHERE conf >= 0.7'
$ pnpm exec cave export --db knowledge.db --current
$ pnpm exec cave demo
```

## Commands

Every command answers `--help` with its options and examples (also
`cave help <command>`). `--db` is optional everywhere: it defaults to
`$CAVE_DB`, or `cave.db` in the current directory.

| Command | Flags | Behavior |
|---|---|---|
| `parse [file…]` | `--json` | Lint (stdin by default). Exit 1 when diagnostics exist; `--json` dumps the AST document. |
| `highlight [file…]` | | ANSI syntax colors from the tree-sitter grammar's own highlight query (see [`@cavelang/highlight`](../highlight)); `cave export` colors the same way on a terminal. |
| `add [--db p] [file…]` | `--strict`, `--check`, `--no-prelude`, `--no-src` | Ingest. Lenient by default (problems on stderr, valid lines land); `--strict` rolls back on any problem; `--check` is the shape gate (spec §20.3) — the append rolls back if it introduces new expectation violations; `--no-prelude` starts from an empty registry instead of the standard §5.5 pairs. Claims without a `@src:` context are stamped `@src:cli` (spec §9.5); `--no-src` opts out. |
| `import [--db p] [file…]` | `--strict`, `--no-prelude` | Restore/merge a database from CAVE text — `add` minus provenance stamping, because canonical text *is* the interchange format and replayed claims must keep their exported claim keys (spec §9.5). |
| `query [--db p] <pattern…>` | `--json`, `--all`, `--aliases`, `--as-of <t>`, `--resolve`, `--no-prelude` | CAVE-Q. Extra positionals join as lines, so `WHERE` filters ride as separate arguments. Bindings print as `?x = value`; fully bound patterns print the matched raw line (or the pattern itself for transitive matches, which carry no row). `--aliases` widens matching through the §13.6 closure; `--as-of <t>` reconstructs belief at a past date/timestamp/tx (spec §12.3); `--resolve` matches only the winners the §26 resolution policy picks among contested facts (incompatible with `--all`). `--no-prelude` aligns the read-time registry with a store written via `add --no-prelude`. |
| `resolve [--db p]` | `--aliases`, `--policy`, `--json`, `--no-prelude` | Contested facts under the §26 resolution policy: every fact more than one belief series speaks about, candidates ranked (precedence class, reliability-weighted confidence, tx) with the winner first — what `query --resolve` would match. `--policy` prints the effective policy instead: the built-in precedence ladder merged with in-band `source/<name> HAS precedence:` / `HAS reliability:` declarations. |
| `derive [--db p] [rules.cave…]` | `--dry-run`, `--full`, `--aliases`, `--min-conf <p>`, `--max-passes <n>`, `--list`, `--retract <r>`, `--json`, `--no-prelude` | Declare and fire rules (spec §24, see [`@cavelang/rules`](../rules)): `premises => conclusion` forward chaining over current beliefs, `BECAUSE`/`VIA` lineage, watermark-incremental and idempotent; retracts conclusions whose premises no longer hold. |
| `act [--db p] <name> [p=v…]` | `--declare`, `--list`, `--retract <n>`, `--dry-run`, `--no-check`, `--aliases`, `--hooks <file>`, `--json`, `--no-prelude` | Execute an action template (spec §25, see [`@cavelang/act`](../act)): validate parameters, check CAVE-Q preconditions against current belief, append effects atomically with lineage inside the §20.3 shape gate; out-of-band hooks fire after commit. |
| `check [--db p]` | `--stale <days>`, `--json`, `--no-prelude` | Knowledge health report (spec §20, see [`@cavelang/shape`](../shape)): shape violations against in-band `EXPECTS` declarations, stale current beliefs (default horizon 90 days), review candidates (conf 0.3–0.7), alias disagreements, coverage stats. Exit 1 on violations; everything else is advisory. |
| `suggest-alias [--db p]` | `--min <s>`, `--limit <n>`, `--agent <template>`, `--timeout <s>`, `--write`, `--json`, `--no-prelude` | Alias discovery (spec §27, see [`@cavelang/shape`](../shape)): same-entity candidates from string/graph similarity as suggested `ALIAS` claims at review-band confidence (0.3–0.5). Prints pipeable CAVE text; `--write` appends stamped `@src:suggest/alias`; `--agent` runs an LLM judge over the candidates (the ingest/eval shell contract). Pairs with any recorded `ALIAS` history are never re-suggested. |
| `sync [--db p] <source>` | `--as <label>`, `--into <label>`, `--dry-run`, `--no-record`, `--json`, `--no-prelude` | Store merge (spec §28, see [`@cavelang/sync`](../sync)): another CAVE store file — or `;@`-annotated canonical text, `-` for stdin — merges by row identity; present rows skip, re-runs merge nothing, effective merges append a `SYNCED-INTO` record (`--no-record` for checkouts, spec §28.6). |
| `export [--db p]` | `--out <file>`, `--current`, `--tx`, `--no-prelude` | Canonical CAVE text — all rows in tx order, or current beliefs only. `--tx` precedes every claim line with its `;@` transaction annotation (spec §28.4), so the text carries row identity: the committed, reviewable store text of the §28.6 branching convention. Stdout by default; `--out` writes a file and reports the claim count. |
| `mcp [--db p]` | `--read-only`, `--tools <list>`, `--no-prelude`, `--src <ctx>`, `--no-src` | Serve the engine as an MCP server on stdio (see [`@cavelang/mcp`](../mcp)) — tools for add/query/fuse/search/about/neighbors/reconstruct/derive/export/lint, with the §22 spec card as server instructions. `--read-only` / `--tools <list>` narrow the served tool surface (the agent permission boundary), composing by intersection. Appends are stamped `@src:agent/<client-name>` (spec §9.5); `--src` replaces the stamp, `--no-src` disables it. |
| `ingest [--db p] <globs/urls…>` | see `cave ingest --help` | LLM-driven ingestion of files and web pages (fetched and readability-extracted) through any headless agent (see [`@cavelang/ingest`](../ingest)): batching, instructions markdown, hybrid knowledge context, MCP or stdout agents, incremental digests, `--plan` NDJSON for SDK drivers. |
| `eval <suite…>` | see `cave eval --help` | Golden-fixture extraction/query evals (ROADMAP item 9, see [`@cavelang/eval`](../eval)): N fresh-store runs against any agent, claim-key + value scoring with §9.5 actor-stamp normalization, CAVE-Q expectations, optional LLM judge, `--min` CI gate. |
| `connect <source>` | see `cave connect --help` | Deterministic structured ingestion (spec §23, see [`@cavelang/connect`](../connect)): CSV/TSV/JSON/JSONL/SQLite/URL records through `?field` mapping templates, per-record digests, `--watch`, `--prune`, query-time `--query` overlay. |
| `reconstruct [--db p] <seed…>` | `--query <text>`, `--agent <template>`, `--steps <n>`, `--claims <n>`, `--timeout <s>`, `--trace`, `--no-prelude` | Active memory reconstruction from seed cues (spec §18, see [`@cavelang/loop`](../loop)): best-first traversal collecting related claims as canonical CAVE text; the heuristic policy by default, an LLM select/stop policy with `--agent` (ROADMAP item 10). |
| `demo` | | The cave-loop multi-hop recovery demo (§18). |
| `version` | | Print the cave version. |
| `help [command]` | | The overview, or one command's options and examples. |

## Text backup / interchange

```
$ cave export --db knowledge.db --out backup.cave
exported 812 claim(s) to backup.cave

$ cave import --db restored.db backup.cave
added 812 claim(s), 37 edge(s)
```

The text round trip preserves every claim with its metadata, the **full
belief-series order** (rows export in tx order and re-ingest with fresh
monotonic tx ids, so latest-tx-wins resolution is unchanged),
qualifier/grouping edges, and in-band registry declarations (`REVERSE`,
`X IS verb`) — a restored database answers queries identically, inverse
reads included. Original transaction timestamps are re-minted: canonical
CAVE text carries no transaction identity. Use `--current` for a compact
backup of current beliefs only (history intentionally dropped).

Everything is testable without spawning: each command is a pure function
`(argv) → { code, out, err }` (`@cavelang/cli` exports them), and `main.ts` is
a four-line dispatcher. Tests cover both layers.
