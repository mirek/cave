# @cavelang/cli

The `cave` command — the whole stack behind one binary. Runs directly from
TypeScript sources via Node's type stripping; no build step.

```
$ echo 'auth USES jwt @ 90%' | pnpm exec cave parse
ok: 1 claim

$ pnpm exec cave add notes.cave --db knowledge.db
added 12 claim(s), 3 edge(s)

$ pnpm exec cave query '?x USES jwt' --db knowledge.db
?x = auth/middleware
?x = api/gateway

$ pnpm exec cave query '?cause CAUSE app/crash' 'WHERE conf >= 0.7' --db knowledge.db
$ pnpm exec cave export --db knowledge.db --current
$ pnpm exec cave demo
```

## Commands

| Command | Flags | Behavior |
|---|---|---|
| `parse [file]` | `--json` | Lint (stdin by default). Exit 1 when diagnostics exist; `--json` dumps the AST document. |
| `add [file…] --db p` | `--strict`, `--no-prelude` | Ingest. Lenient by default (problems on stderr, valid lines land); `--strict` rolls back on any problem; `--no-prelude` starts from an empty registry instead of the standard §5.5 pairs. |
| `import [file…] --db p` | `--strict`, `--no-prelude` | Restore/merge a database from CAVE text — same operation as `add`, because canonical text *is* the interchange format. |
| `query <pattern…> --db p` | `--json`, `--all`, `--no-prelude` | CAVE-Q. Extra positionals join as lines, so `WHERE` filters ride as separate arguments. Bindings print as `?x = value`; fully bound patterns print the matched raw line (or the pattern itself for transitive matches, which carry no row). `--no-prelude` aligns the read-time registry with a store written via `add --no-prelude`. |
| `export --db p` | `--out <file>`, `--current`, `--no-prelude` | Canonical CAVE text — all rows in tx order, or current beliefs only. Stdout by default; `--out` writes a file and reports the claim count. |
| `mcp --db p` | `--no-prelude` | Serve the engine as an MCP server on stdio (see [`@cavelang/mcp`](../mcp)) — tools for add/query/search/about/neighbors/reconstruct/export/lint, with the §22 spec card as server instructions. |
| `ingest <globs/urls…> --db p` | see `cave ingest --help` | LLM-driven ingestion of files and web pages (fetched and readability-extracted) through any headless agent (see [`@cavelang/ingest`](../ingest)): batching, instructions markdown, hybrid knowledge context, MCP or stdout agents, incremental digests, `--plan` NDJSON for SDK drivers. |
| `demo` | | The cave-loop multi-hop recovery demo (§18). |

## Text backup / interchange

```
$ cave export --db knowledge.db --out backup.cave
exported 812 claim(s) to backup.cave

$ cave import backup.cave --db restored.db
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
