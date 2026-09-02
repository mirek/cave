#import "../style.typ": note, file, recap

= Agents Over MCP

A language model with tools is the most demanding user a store has: it
writes quickly, names things inconsistently, and forgets what it recorded
an hour ago. `cave mcp` serves the store to any Model Context Protocol
client and gives the model a small, self-describing vocabulary: read, search,
walk, reconstruct, fuse, derive, and, when an operator allows it, record and
act.

== The server

`cave mcp` speaks the protocol over standard input and output, which is how
MCP clients start servers. Registering it with a client is one line:

// no-test
```sh
$ copilot mcp add cave -- cave mcp --db "$HOME/cave.db"
$ claude mcp add cave -- cave mcp --db "$HOME/cave.db"
```

The server is self-describing. Its initialization instructions carry the
compact syntax card, and the `cave_help` tool serves version-matched
guidance on demand (`overview`, `write`, `find`, `revise`, `safety`), so a
model that has never seen CAVE can look up how to use it before it writes.
A portable CAVE Agent Skill in the repository adds workflow guidance for
Copilot, Codex, Claude Code, and other skill hosts; it defers to the
connected server's help for exact syntax.

== The tools

#table(columns: (auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Tool*], [*What it does*],
  [`cave_help`], [Version-matched operating guidance; reads no user data.],
  [`cave_query`], [A bounded CAVE-Q page with `all`, `aliases`, `asOf`, `at`, `resolve`, `limit`, `cursor`.],
  [`cave_about`], [Current claims about one entity, both directions.],
  [`cave_neighbors`], [Named forward and inverse edges, for walking the graph by hand.],
  [`cave_search`], [Full-text search over claims, values, and comments.],
  [`cave_reconstruct`], [The reconstruction loop from seed cues (Chapter 20).],
  [`cave_fuse`], [Precision-weighted fusion of numeric estimates of one quantity (Chapter 5).],
  [`cave_lint`], [Validate CAVE text without storing it.],
  [`cave_add`], [Append CAVE text; lenient by default, `strict` on request.],
  [`cave_derive`], [Fire the store's rules (Chapter 17).],
  [`cave_export`], [Sensitivity-scoped canonical text.],
  [`act_<name>`], [One generated tool per current action declaration (Chapter 18).],
)

Claim results are canonical CAVE text, not JSON rows: that is the
agent-facing compatibility contract, and a model reads a claim line more
reliably than a nested object. Because the protocol is newline-delimited
JSON-RPC, the server can be driven from a shell with no client at all,
which is a good way to see exactly what a model sees:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"book","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cave_query","arguments":{"pattern":"?who SUPPLIES lot/huila-26"}}}' \
    | cave mcp --db roastery.db 2>/dev/null > replies.jsonl

$ grep -o '"name":"cave_[a-z_]*"' replies.jsonl | tr '\n' ' '
"name":"cave_help" "name":"cave_add" "name":"cave_query" "name":"cave_fuse" "name":"cave_search" "name":"cave_about" "name":"cave_neighbors" "name":"cave_reconstruct" "name":"cave_derive" "name":"cave_export" "name":"cave_lint" 

$ grep -o '"text":"[^"]*"' replies.jsonl
"text":"?who = la-cima  ; la-cima SUPPLIES lot/huila-26"
```

One JSON reply per request lands in the file: the handshake, the tool list
with every tool's schema, and the query result as CAVE text. The server
exits when its input closes. Tool failures come back as
`isError` results so the model can correct a call, and the startup banner
goes to standard error because standard output is protocol only.

== Provenance for agents

Claims a model appends without a `@src:` context are stamped
`@src:agent/<client-name>`, using the name the client gave at
initialization. That puts every agent in its own belief series and in the
agent precedence class, below a human at the terminal (Chapter 11). `--src
pipeline/nightly` replaces the stamp for a named pipeline; `--no-src`
disables it.

== Scoping what an agent may do

The surface has four permission classes: `read` retrieves stored data,
`evaluate` performs ephemeral computation, `record` appends durable data,
and `action` may execute governed effects. `--permissions` serves only the
named classes, `--tools` only the named tools, and `--read-only` is the
shorthand that keeps read and evaluate. Scopes compose by intersection, and
a scope that names an unknown tool, or serves nothing, fails at startup
before the database is opened. The one thing startup cannot check is an
`act_<name>` tool: those exist only while the action is declared, and are
read from the store on every listing, so the third scope below serves an
empty list until Chapter 18's declaration has been loaded, and a misspelt
action name is an empty list rather than an error. The declaration is
Chapter 18's:

#file("actions.cave")
```cave
; governed writes: the only way an order gets recorded
action/reorder HAS action: `?lot, ?lot NEEDS reorder, ?lot SUPPLIED-BY ?supplier => ?lot HAS order: 30kg, ?supplier NEEDS contact` ; order 30 kg of a lot that ran low
action/reorder/lot IS param ; the lot to reorder
```

// no-test
```sh
$ cave mcp --db roastery.db --read-only
$ cave mcp --db roastery.db --permissions read,evaluate
$ cave act --db roastery.db --declare actions.cave
$ cave mcp --db roastery.db --permissions action --tools act_reorder
$ cave mcp --db roastery.db --tools cave_query,cave_about,cave_search
```

Tools outside the scope are absent from the tool list and indistinguishable
from nonexistent when called. Read and evaluate tools carry the protocol's
read-only hint so clients can auto-approve them, and the client's ordinary
permission prompt is where a human confirms a write.

== Actions as the write vocabulary

The most useful scope for a working agent is often no `cave_add` at all.
Every current action declaration becomes an `act_<name>` tool, recomputed on
every tool listing, with the declaration comment as its description and the
parameters as its schema. The agent then chooses from a set of allowed
decisions whose preconditions the engine checks, whose effects append
atomically with lineage, and whose hooks reach the outside world only after
commit (`--hooks` supplies the configuration). The store gets governed
writes instead of free-form ones, and the operator can widen the vocabulary
by declaring another action, without restarting anything.

== Driving an agent from the command line

The same contract runs the other way. `cave ingest --agent`, `cave eval
--agent`, `cave reconstruct --agent`, `cave suggest-alias --agent`, and
`cave automate --agent` each run a headless agent command with a prompt on
standard input and, where the agent records through the store, a temporary
MCP configuration substituted for `{mcp-config}`. Any agent that can be
started from a shell fits, and the model never enters the engine: there is
no SDK dependency, the shell is explicit, output is bounded, and a timeout
kills the whole process tree.

#note([What an agent should do], [Recall before reasoning: ask
`cave_about` for one entity, `cave_query` for a shape, `cave_search` when
the wording is unknown, `cave_reconstruct` for bounded multi-hop context.
Record one fact per line with a source and honest confidence, lint
unfamiliar syntax first, never edit history, and never store secrets. That
paragraph is the Agent Skill in miniature.])

#recap[`cave mcp --db <store>` serves the store over stdio with read,
search, walk, reconstruct, fuse, derive, lint, add, export, and generated
`act_<name>` tools. Appends are stamped `@src:agent/<client>`. `--read-only`,
`--permissions`, and `--tools` scope the surface by intersection. The
reverse contract, `--agent '<command>'`, lets every CAVE workflow drive any
headless agent.]
