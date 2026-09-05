#import "../style.typ": note, file, recap

= How the Pieces Fit

CAVE is a pnpm workspace of TypeScript packages that form a ladder from
domain types to user surfaces. This chapter is the map: what each layer
owns, which way dependencies point, how the same kernel reaches a terminal,
an agent, a browser, and an editor, and the handful of invariants every
change has to preserve.

== Three boundaries

Three decisions shape everything else.

*Text becomes data once.* CAVE text is parsed and canonicalized before it is
keyed or persisted; reads operate on stored columns and side tables and never
re-parse `raw_line`. There is one parser, one key rule, one query engine, and
one persistence model, reused from every surface.

*Belief changes append.* An update or retraction is a new row in the same
belief series. Existing rows stay addressable for history, provenance,
bitemporal queries, and synchronization.

*Policy is mostly knowledge.* Verb declarations, rules, actions,
automations, shape expectations, source reliability, and precedence are
stored as claims. The executable machinery stays in code; the configuration
it interprets travels with the knowledge, and executable commands (hooks,
agents) never enter the store.

== The layers

#table(columns: (auto, auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Layer*], [*Packages*], [*Responsibility*],
  [Domain], [`core`, `fusion`],
    [Immutable claim and value types, keys, time, UUIDv7, probabilistic math.],
  [Language], [`parser`, `canonical`],
    [CAVE text and diagnostics, the inverse and lifecycle registry, canonical claims, emission.],
  [Data], [`store`, `query`, `shape`],
    [Persistence, CAVE-Q, resolution, expectations, health, write gates.],
  [Formal reasoning], [`solver`, `scenario`, optional `solver-z3`],
    [Exact portable models, typed snapshot bindings, opt-in Z3 search (Chapter 27).],
  [Behavior], [`rules`, `act`, `automate`, `loop`],
    [Derivation, governed writes, event processing, reconstruction policies.],
  [Movement], [`connect`, `ingest`, `sync`],
    [Deterministic records, agent extraction, store union.],
  [Integration], [`mcp`, `eval`],
    [The agent tool protocol and repeatable quality evaluation.],
  [Presentation], [`cli`, `view`],
    [Command dispatch, the read-only HTTP view, cited reports.],
  [Language tooling], [`tree-sitter-cave`, `highlight`, the VS Code extension],
    [One grammar and highlight query for terminal and editors.],
  [Browser], [`website`],
    [Documentation and a playground running the kernel in the browser on an in-memory store.],
)

Dependencies point inward, toward domain, language, and data. Higher
packages compose lower functions; the lower layers never call the CLI, MCP,
HTTP, or agent surfaces. The code favours small functions and immutable
values over class hierarchies, with conventional error subclasses carrying
typed failure details at API boundaries.

Workspace boundaries and release boundaries differ on purpose. Libraries
with independent consumers publish as their own npm packages. Rules,
actions, automation, ingestion, MCP, views, and the other command
implementations stay as focused private workspace packages and ship as
documented `@cavelang/cli/<feature>` subpaths, so tests and ownership stay
small without multiplying version surfaces. Every public package releases at
one version, in lockstep, through automated changesets.

== One process boundary

Every command enters one awaited dispatcher, whether its implementation is
synchronous, asynchronous, or a long-running server. `SIGINT` and `SIGTERM`
become one abort signal; HTTP servers, protocol readers, watchers, timers,
and stores close before the conventional signal exit code is returned. A
simple user error is one stack-free line on standard error; a command that
reports findings, such as parse diagnostics or a rejected shape gate,
prints its structured report instead (Chapter 28). `CAVE_DEBUG=1` keeps the
diagnostic stack for unexpected errors.

Local integrations cross one process boundary too. Direct commands are
executable-and-arguments arrays with no shell interpolation. Agent and hook
strings are explicitly platform-shell templates, `/bin/sh` on POSIX and
PowerShell 7 on Windows, with placeholder values quoted for that shell. The
boundary bounds both output streams separately, normalizes exits, redacts
command material from failure messages, and owns whole-tree termination on
timeout, cancellation, or overflow.

== One grammar, four renderers

A tree-sitter grammar lives beside the parser and is the source for every
presentation of CAVE text: `cave highlight` and the colours `cave export`
prints on a terminal, the website's editor, the VS Code extension's
semantic tokens, and any tree-sitter-native editor pointed at the grammar.
The grammar is not the parser, but the two are tested against each other,
and the one highlight query drives every renderer, so syntax cannot drift
between what the engine accepts and what an editor colours.

== The invariants

Changes to the system are expected to preserve these:

1. Canonicalize before identity.
2. Never update or delete belief rows.
3. Treat row ids as global identities that sync preserves with their
   transaction order, side tables, raw text, keys, and edges.
4. Filter publication structurally, from visible rows only; a current-only
   export resolves current belief before applying the ceiling.
5. Format source spans in one place.
6. Keep generated clients derived and reproducible.
7. Keep provenance dimensions separate from identity-bearing contexts.
8. Version every physical schema change with one transactional migration.
9. Publish snapshots only after verification.
10. Keep reads non-destructive: aliasing, resolution, valid time, and
    reconstruction never rewrite claims.
11. Use the store's transaction boundary for compound writes.
12. Keep external effects after commit and out of the store.
13. Reuse the kernel from every surface.

== Boundaries that will stay

Some things are deliberately not built. Ordinary stored claims stay fully
bound: variables live only in queries, rules, actions, automations, and
connector templates. Claims are not reified into terms; explicit qualifier
edges and provenance rows address relationships instead. Time-dependent
values are linear trajectories and tiled steps, not stored formulas. Network
listeners stay outside the core: a webhook or socket bridge owns its
transport and feeds a watched file or a bounded connect pass. There is no
multi-tenant access control and none is planned; the store is one person's
or one team's knowledge on one machine, with plain text as the escape hatch.
A proposal to move one of these boundaries has to show a workflow the
existing structures cannot express and specify identity, scope,
determinism, security, lifecycle, and compatibility before the boundary
moves.

#recap[Packages form a ladder from domain types to surfaces, with
dependencies pointing inward and one kernel reused everywhere. Text becomes
data once, belief appends, policy is knowledge. One dispatcher and one
process boundary own lifecycle and shell safety; one grammar drives every
renderer. Thirteen invariants and a short list of permanent non-goals keep
the shape stable.]
