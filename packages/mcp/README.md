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
| `cave_query` | CAVE-Q patterns (§12): `?x USES jwt`, `WHERE conf >= 0.7`, `EXTENDS+`, inverse verbs; `aliases` (§13.6), `asOf` (§12.3), `at` valid time (§32.4), and `resolve` (§26 winners only) opt-ins |
| `cave_fuse` | Bayesian fusion of numeric estimates (§10.1) — named computation over a CAVE-Q `pattern`, an entity's current claims (`about`), or literal `text` |
| `cave_search` | FTS over claims, values, comments |
| `cave_about` | current claims about an entity, both directions, canonical lines; `aliases` / `resolve` opt-ins |
| `cave_neighbors` | named forward + inverse edges (§13.3) for graph walking; `aliases` / `resolve` opt-ins |
| `cave_reconstruct` | cave-loop active reconstruction from seed cues (§18) — pull everything related to a symptom before reasoning |
| `cave_derive` | fire the stored rules (§24) — named computation; `dryRun`, `full`, `aliases`, `minConf`, `maxPasses` |
| `cave_export` | sensitivity-scoped canonical text (default `internal`; `maxSensitivity: restricted` for complete portable history; `current` for beliefs only) |
| `cave_lint` | validate CAVE text without storing |
| `act_<name>` | one generated governed-write tool per current action declaration (§25.5); parameters come from the declaration and hooks stay out of band |

`cave_reconstruct` runs the `@cavelang/loop` heuristic policy over the SQLite
store through the §18 store contract (`sqliteStore`) — the same multi-hop
recovery as the demo, against persistent knowledge. An MCP client is
itself the model, so it can drive selection by hand via `cave_neighbors`;
the packaged LLM-driven policy lives in `cave reconstruct --agent`.

## Named computation

`cave_fuse` and `cave_derive` expose the engine's
computation by name, so agents delegate math instead of doing arithmetic
in tokens. `cave_fuse` runs §10.1 precision-weighted fusion over
independent estimates of **one quantity** — one claim key modulo `@src:`
contexts (§26.1's group identity, widened by the alias closure under
`aliases`), one unit — selected three ways: a CAVE-Q `pattern`
(`openai HAS revenue: ?v`), an entity name (`about: revenue`, the only
reach into metric `IS` series, whose values CAVE-Q variables never
bind), or literal `text` that never touches the store. It reports the
contributing estimates, the posterior as a writable CAVE value
(`19.97B USD/yr +/- 508.5M USD/yr (2σ)`) and the exact mean/sigma.
Selections that span several quantities or mix units fail loudly instead
of averaging nonsense. `cave_derive` fires the store's in-band rules
(§24) with the same options as `cave derive` — declare rules through
`cave_add`, preview with `dryRun`, and re-runs stay idempotent and
watermark-incremental — so the declare → fire loop never leaves the
protocol.

Current action declarations generate `act_<name>` tools dynamically on every
`tools/list`. They validate parameters and preconditions, append effects with
lineage through the same §25 action engine, and therefore count as writing
tools. `cave mcp --hooks hooks.json` (or `$CAVE_HOOKS`) supplies the reviewed
out-of-band command templates named by those actions; executable commands are
never read from claims. Hook failure is reported after the committed claims
remain durable.

## Serving scope

The full surface includes four explicit permission classes: `read` retrieves
stored data, `evaluate` performs ephemeral computation, `record` appends
durable data, and `action` may execute governed effects. `--permissions
<list>` serves only the named classes.

`--read-only` is the compatibility shorthand that keeps `read` and `evaluate`
but drops `record` and `action`; `cave_fuse` therefore survives while
`cave_add`, `cave_derive`, and generated actions disappear. `--tools <list>`
serves only named tools. Every scope composes by intersection:

```
cave mcp --db k.db --read-only
cave mcp --db k.db --permissions read,evaluate
cave mcp --db k.db --permissions record --tools cave_add
cave mcp --db k.db --permissions action --tools act_mark-deployed
cave mcp --db k.db --tools cave_query,cave_about,cave_search
```

Tools outside the scope are absent from `tools/list` and
indistinguishable from nonexistent in `tools/call`; the server
`instructions` mention only served tools, and a surface with no writing
tool declares itself read-only. A scope that names an unknown tool, or
serves nothing, fails at startup — before the database is opened. Read and
evaluation tools carry the MCP `readOnlyHint` annotation, so clients can treat
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
