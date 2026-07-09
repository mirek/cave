# @cavelang/mcp

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

The server's `instructions` carry the spec §22 compact card, so a
connected model knows how to write CAVE claims without further prompting.

## Tools

| Tool | Purpose |
|---|---|
| `cave_add` | append CAVE text (extraction output); lenient, `strict` opt-in |
| `cave_query` | CAVE-Q patterns (§12): `?x USES jwt`, `WHERE conf >= 0.7`, `EXTENDS+`, inverse verbs |
| `cave_search` | FTS over claims, values, comments |
| `cave_about` | current claims about an entity, both directions, canonical lines |
| `cave_neighbors` | named forward + inverse edges (§13.3) for graph walking |
| `cave_reconstruct` | cave-loop active reconstruction from seed cues (§18) — pull everything related to a symptom before reasoning |
| `cave_export` | canonical text backup (`current` for beliefs only) |
| `cave_lint` | validate CAVE text without storing |

`cave_reconstruct` runs the `@cavelang/loop` heuristic policy over the SQLite
store through the §18 store contract (`sqliteStore`) — the same multi-hop
recovery as the demo, against persistent knowledge. An MCP client is
itself the model, so it can drive selection by hand via `cave_neighbors`;
the packaged LLM-driven policy lives in `cave reconstruct --agent`.

## Serving scope

The full surface is read-write. `--read-only` serves only tools that
never write (drops `cave_add`); `--tools <list>` serves only the named
tools (comma-separated). Each flag can only narrow, so the two compose
as an intersection — `--read-only` still drops writing tools that
`--tools` lists:

```
cave mcp --db k.db --read-only
cave mcp --db k.db --tools cave_query,cave_about,cave_search
```

Tools outside the scope are absent from `tools/list` and
indistinguishable from nonexistent in `tools/call`; the server
`instructions` mention only served tools, and a surface with no writing
tool declares itself read-only. A scope that names an unknown tool, or
serves nothing, fails at startup — before the database is opened. Read
tools carry the MCP `readOnlyHint` annotation, so clients can treat
them accordingly (e.g. auto-approve).

## Actor provenance

`cave_add` stamps `@src:agent/<client-name>` on appended claims that carry
no `@src:` context (spec §9.5), naming the client from the `initialize`
handshake (`@src:agent` before one arrives; a written `@src:` always
wins). `--src <context>` replaces the stamp — useful for pipelines, e.g.
`--src pipeline/nightly` — and `--no-src` disables stamping.

## Protocol

Newline-delimited JSON-RPC 2.0 on stdio, implementing the tools-only MCP
slice: `initialize` (echoes the client's protocol version),
`notifications/initialized`, `ping`, `tools/list`, `tools/call`. Tool
failures return `isError` results; protocol violations return JSON-RPC
errors. Stdout is protocol-only; the startup banner goes to stderr.

Hand-rolled rather than an SDK dependency: the surface is ~150 lines, the
dispatcher is a pure function (tested without processes), and
`@prelude/jsonrpc` targets WebSocket-style transports with numeric-only
ids while MCP ids may be strings.

## Tests

```
pnpm --filter @cavelang/mcp test
```

Pure-dispatcher tests for every tool and protocol path, plus an end-to-end
test that spawns `cave mcp` and speaks NDJSON over stdio.
