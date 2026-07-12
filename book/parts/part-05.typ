= Reconstruction and Agent Memory
A direct query requires the caller to know what pattern to ask. cave reconstruct starts from an entity or symptom and walks the graph best-first, collecting related claims until a budget or stopping condition is reached.

The deterministic policy scores frontier entities using relation direction, confidence, recency, and novelty. --trace exposes every expansion and score. An optional agent policy receives the collected claims and frontier at each step and chooses the next cue or STOP.

```cave
cave reconstruct --db incident.db checkout/errors --trace
cave reconstruct --db incident.db checkout/errors \
  --query "what caused the failures?" --agent 'claude -p' 
```

The heuristic is a baseline rather than a hidden fallback. Reconstruction fixtures allow the language-model policy and deterministic policy to be scored by the same claim-key F1. This makes claims about better memory retrieval testable.

Reconstruction differs from vector retrieval: it follows explicit typed relations and inverse views, returns source claims, and exposes the path that brought each claim into context.


= Store Synchronization and Git
CAVE stores merge by immutable row identity. UUIDv7 claim ids and edge identities make sync a set union: present rows skip, absent rows insert, and contradictory knowledge does not create a merge conflict because contradictions are legal and resolved at read time.

```cave
cave sync --db main.db laptop.db
cave export --db laptop.db --tx | cave sync --db main.db - --as laptop
```

A successful merge can append a SYNCED-INTO claim naming origin and target labels. The receive rule ensures later local appends sort after merged history even when clocks differ.

Transaction annotations are full-line comments of the form ;@ <uuidv7> immediately above a claim. cave export --tx emits them and cave sync replays them with original identity. Plain import ignores the annotations and performs an ordinary replay.

The recommended Git workflow commits the annotated text export, not the SQLite file. A branch rebuilds a private store by syncing the export with --no-record, performs normal appends, re-exports, and reviews the textual diff. Text conflicts are resolved by syncing both exports into a fresh store and exporting the union, which can be configured as a merge driver.


= Automations and the Closed Loop
Automations watch belief changes and connect triggers to steps. A declaration contains CAVE-Q trigger premises on the left and action names, hook names, or agent prompt templates on the right.

```cave
automation/page-on-spike HAS automation: `
  ?svc IS service,
  ?svc HAS error-rate: ?r,
  ?r > 0.05 =>
  action/open-incident,
  hook/page,
  "investigate the spike on ?svc"`
```

A solution fires only when at least one supporting premise row is newer than the automation watermark. Bookkeeping rows and an automation's own outputs are excluded so the loop cannot wake itself forever. Other automations' output remains eligible, enabling chains.

The settle cycle records a watermark before executing steps, fires incremental rules, executes governed actions, runs configured hooks, and records an agent's CAVE reply with automation provenance. Idempotent write paths ensure the cycle converges.

With cave connect --watch feeding source changes and cave automate watching store changes, the single-machine loop is: sense, model, conclude, act, record, and inspect.


= Human and Machine Interfaces
The CLI is the broad operator surface. MCP exposes the store to agents. cave serve and cave report provide human-facing read surfaces.

#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Surface*],
  [*Purpose*],
  [cave mcp],
  [Query, append, fuse, reconstruct, and generated action tools for MCP clients.],
  [cave serve],
  [Local read-only self-contained HTML dashboard.],
  [cave report],
  [Render Markdown templates with CAVE-Q values and claim citations.],
  [cave highlight],
  [Tree-sitter-driven terminal syntax highlighting.],
  [VS Code extension],
  [Semantic tokens from the same tree-sitter query.],
)

cave serve provides knowledge-health tiles, entity 360 pages, forward and inverse relations, topic browsing, alias closure, full-text search, belief-history timelines, and BECAUSE/VIA lineage trees. It serves localhost by default and permits GET only.

cave report evaluates fenced cave-q blocks and inline query splices in a Markdown template. Rendered facts carry footnotes with canonical claim text, date, and claim key. Ambiguous inline values fail unless resolution is explicitly requested, preventing a report from silently selecting a contested fact.

The MCP server can be read-only or tool-scoped. It dynamically generates act_<name> tools from current action declarations, giving an agent a governed, inspectable write vocabulary.


= Package Architecture
The repository is a pnpm TypeScript monorepo. Packages form a dependency ladder from domain types to user surfaces. The separation keeps parsing, storage, policy, and orchestration independently testable.

```cave
@cavelang/core
  -> parser
  -> canonical
  -> store
  -> query
  -> shape
  -> connect
  -> fusion
  -> rules
  -> act
  -> sync
  -> loop
  -> automate
  -> view
  -> mcp
  -> ingest
  -> eval
  -> tree-sitter-cave
  -> highlight
  -> cli
```

#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Layer*],
  [*Responsibilities*],
  [Core],
  [Claim/value types, units, UUIDv7 transactions, claim keys.],
  [Parser],
  [Line grammar, metadata, indentation, rule/action bodies.],
  [Canonical],
  [Inverse registry, continuation expansion, stable emission.],
  [Store],
  [SQLite schema, append/import/export, provenance, edges.],
  [Query],
  [CAVE-Q, filters, transitive paths, aliases, temporal reads.],
  [Policy],
  [Shape checks, fusion, resolution, derivation, actions.],
  [Orchestration],
  [Connect, ingest, reconstruction, sync, automations.],
  [Presentation],
  [MCP, CLI, reports, web view, highlighting.],
)

A tree-sitter grammar is shared across terminal highlighting, the website, the editor extension, and tree-sitter-native editors. This avoids syntax drift between the parser and presentation surfaces.
