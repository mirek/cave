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
| `add [--db p] [file…]` | `--strict`, `--check`, `--no-prelude`, `--no-src` | Ingest. Lenient by default (problems on stderr, valid lines land); `--strict` rolls back on any problem; `--check` is the shape gate (spec §20.3) — the append rolls back if it introduces new expectation violations; `--no-prelude` starts from an empty registry instead of the standard §5.5 pairs. Claims without a `@src:` context are stamped `@src:cli` (spec §9.5); `--no-src` opts out. |
| `import [--db p] [file…]` | `--strict`, `--no-prelude` | Restore/merge a database from CAVE text — `add` minus provenance stamping, because canonical text *is* the interchange format and replayed claims must keep their exported claim keys (spec §9.5). |
| `query [--db p] <pattern…>` | `--json`, `--all`, `--no-prelude` | CAVE-Q. Extra positionals join as lines, so `WHERE` filters ride as separate arguments. Bindings print as `?x = value`; fully bound patterns print the matched raw line (or the pattern itself for transitive matches, which carry no row). `--no-prelude` aligns the read-time registry with a store written via `add --no-prelude`. |
| `check [--db p]` | `--stale <days>`, `--json`, `--no-prelude` | Knowledge health report (spec §20, see [`@cavelang/shape`](../shape)): shape violations against in-band `EXPECTS` declarations, stale current beliefs (default horizon 90 days), review candidates (conf 0.3–0.7), alias disagreements, coverage stats. Exit 1 on violations; everything else is advisory. |
| `export [--db p]` | `--out <file>`, `--current`, `--no-prelude` | Canonical CAVE text — all rows in tx order, or current beliefs only. Stdout by default; `--out` writes a file and reports the claim count. |
| `mcp [--db p]` | `--read-only`, `--tools <list>`, `--no-prelude`, `--src <ctx>`, `--no-src` | Serve the engine as an MCP server on stdio (see [`@cavelang/mcp`](../mcp)) — tools for add/query/search/about/neighbors/reconstruct/export/lint, with the §22 spec card as server instructions. `--read-only` / `--tools <list>` narrow the served tool surface (the agent permission boundary), composing by intersection. Appends are stamped `@src:agent/<client-name>` (spec §9.5); `--src` replaces the stamp, `--no-src` disables it. |
| `ingest [--db p] <globs/urls…>` | see `cave ingest --help` | LLM-driven ingestion of files and web pages (fetched and readability-extracted) through any headless agent (see [`@cavelang/ingest`](../ingest)): batching, instructions markdown, hybrid knowledge context, MCP or stdout agents, incremental digests, `--plan` NDJSON for SDK drivers. |
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
