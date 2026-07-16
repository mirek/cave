# CAVE — Implementation

A pnpm TypeScript monorepo implementing the CAVE specification
(split across the skills in [`.claude/skills/`](.claude/skills) — see the
[README's section index](README.md#the-specification) for which skill holds
which § sections).
Functional style throughout (immutable domain values and namespace modules in
the `@prelude` convention; classes are limited to typed `Error` subclasses),
built bottom-up — each package is documented and tested alongside its public
behavior.

## Packages

Dependency order, bottom to top:

| Package | Spec | Purpose |
|---|---|---|
| [`@cavelang/core`](packages/core) | §2, §6, §7, §9, §32 | Domain model: claims, values/units/multipliers (incl. `A -> B` trajectories), uncertainty, confidence, tags, contexts, valid-time periods/ranges (`Time`), claim keys, monotonic UUIDv7 |
| [`@cavelang/parser`](packages/parser) | §3, §4, §8, §16 | CAVE text → AST on [`@prelude/parser`](https://www.npmjs.com/package/@prelude/parser) combinators; never throws, lints |
| [`@cavelang/canonical`](packages/canonical) | §5, §8, §13.4 | Verb registry (`REVERSE`, `RENAMED-TO`, extensions), inverse and lifecycle resolution, continuation expansion, qualifier edges, canonical emitter |
| [`@cavelang/store`](packages/store) | §13, §26 | Persistence on the **Node.js builtin `node:sqlite`** — exact spec schema, append-only belief series, inverse-aware reads, FTS5, contradiction resolution (precedence classes, source reliability, `resolvedBeliefs`/`contested`) |
| [`@cavelang/query`](packages/query) | §12, §26, §32 | CAVE-Q patterns compiled to SQL: variables, wildcards, inverse and lifecycle verb resolution, `VERB+` transitive CTEs, `WHERE` filters, `resolve` winners-only matching, `at` valid-time filtering + trajectory interpolation |
| [`@cavelang/shape`](packages/shape) | §20, §27 | Shape expectations (`EXPECTS` bound through the `EXTENDS` taxonomy, optional exact-one cardinality and exact-unit tags), knowledge-health report (actionable violations, staleness, review candidates, alias disagreements, coverage), write gating; alias discovery (`suggestAliases` — string/graph similarity signals, suggested `ALIAS` claims in the review band, optional judge contract) |
| [`@cavelang/connect`](packages/connect) | §23 | Deterministic structured ingestion — CSV/TSV/JSON/JSONL/SQLite/URL records mapped through CAVE templates with `?field` variables; per-record digest incrementality, watch mode, query-time overlay |
| [`@cavelang/fusion`](packages/fusion) | §10 | Bayesian fusion, noisy-AND, hypothesis helpers — pure math |
| [`@cavelang/solver`](packages/solver) | — | Dependency-free formal-reasoning boundary: immutable Boolean/integer/exact-real/finite-enum models, hard and weighted-soft constraints, lexicographic objectives, validation and resource limits, capability negotiation, canonical digests, result unions, bounded feasibility/optimization/counterexample/sensitivity workflows, deterministic tie-breaking, linear-subset recognition, and versioned JSON/human explanations mapped to model declarations, evidence rows, and scenario inputs; concrete solver adapters remain optional |
| [`@cavelang/solver-z3`](packages/solver-z3) | — | Optional Node.js adapter for official Z3 Wasm: lazy one-time initialization, exact portable-model compilation, tracked unsat cores, lexicographic and weighted-soft optimization, queued checks, bounded execution, explicit worker shutdown, and a separate allowlisted architecture-workflow CLI fixture |
| [`@cavelang/scenario`](packages/scenario) | — | Typed, replayable evaluator inputs: explicit CAVE-Q snapshots, rolled-back hypothetical overlays, exact numeric/unit conversion, cardinality and conflict policies, durable row evidence, stable scenario evidence IDs, and a solver-explanation metadata bridge; async evaluators run only after rollback. Explicit atomic/idempotent result recording uses separate versioned result, recommendation, decision, action-audit, and external-effect-audit artifacts with compatibility-aware replay |
| [`@cavelang/rules`](packages/rules) | §24 | Rules engine — `premises => conclusion` forward chaining over current beliefs; in-band rule claims, `BECAUSE`/`VIA` derivation lineage, noisy-AND confidence, tx-watermark incrementality, well-founded support |
| [`@cavelang/act`](packages/act) | §25 | Action templates — named, parameterized governed writes: in-band declarations, CAVE-Q preconditions validated against current belief, atomic effects with `BECAUSE`/`VIA` lineage, §20.3 gate by default, out-of-band side-effect hooks |
| [`@cavelang/sync`](packages/sync) | §28 | Store merge — append-only stores union by row identity (idempotent, transitive, conflict-free under §9.4 coexistence): store files through SQL `ATTACH`, `;@` transaction-annotated canonical text through the ordinary pipeline; in-band `SYNCED-INTO` merge records, the §28.2 tx receive rule, re-statement replay and the §28.6 branching convention (text under git, checkout/land by sync, union merge driver) |
| [`@cavelang/loop`](packages/loop) | §18 | cave-loop: injectable store/policy (sync + async), in-memory store and SQLite adapter, heuristic policy (the eval baseline), LLM policy over shell-agent templates (one completion per step decides select/stop), multi-hop recovery demo |
| [`@cavelang/automate`](packages/automate) | §29 | Automations — the event-driven loop: in-band `automation/<name>` declarations pair §24.1 trigger premises with steps (§25 actions, §25.4 hooks, agent prompts); solutions fire on rows newer than the automation's watermark, armed at declaration, deaf to their own echo; settle cycles interleave incremental derivation with trigger evaluation until quiescent |
| [`@cavelang/view`](packages/view) | §30, §31 | The human read surface — `cave serve`: one static, self-contained HTML page over the store (entity 360, topic browse, belief-history timelines, `BECAUSE`/`VIA` lineage trees, §20.2 coverage/frontier dashboard, FTS search) behind read-only GET endpoints; `cave report`: markdown templates rendered from CAVE-Q results with claim keys as footnote citations; view models and the report renderer are plain functions over a store |
| [`@cavelang/mcp`](packages/mcp) | — | The engine as an MCP server (stdio JSON-RPC): add/query/fuse/search/about/neighbors/reconstruct/derive/export/lint tools plus one generated `act_<name>` tool per declared action (§25.5); `cave_fuse`/`cave_derive` expose named §10.1 fusion and §24 derivation; serving scopes distinguish read, ephemeral evaluation, durable recording, and effect-capable action permissions, with `--read-only` and exact tool allowlists as further intersections |
| [`@cavelang/ingest`](packages/ingest) | — | LLM-driven ingestion: batch files and web pages (fetch + Readability) through any headless agent (Claude Code, Copilot CLI, SDK scripts) with hybrid knowledge context |
| [`@cavelang/eval`](packages/eval) | — | Extraction and reconstruction eval harness: golden-fixture suites as plain files, N fresh-store runs against any agent via `ingest`, claim-key scoring with §9.5 actor-stamp normalization and value tolerance, CAVE-Q expectations, optional LLM judge, `--min` CI gate; reconstruction cases (`<stem>.loop.cave`) score §18 loop policies against the heuristic baseline |
| [`@cavelang/tree-sitter-cave`](packages/tree-sitter-cave) | §16 | Tree-sitter grammar (line-oriented, no external scanner) + `queries/highlights.scm` — the single grammar source behind terminal and editor highlighting; parser and WASM are generated on demand, never committed |
| [`@cavelang/highlight`](packages/highlight) | — | web-tree-sitter over the grammar WASM, rendering `highlights.scm` captures as ANSI for terminals |
| [`@cavelang/cli`](packages/cli) | — | `cave parse / highlight / add / import / query / resolve / derive / act / automate / check / suggest-alias / sync / export / report / serve / mcp / ingest / eval / connect / reconstruct / demo` |

Outside the npm dependency graph, [`editors/vscode`](editors/vscode)
packages the same grammar WASM and highlight query as a VSCode extension
(semantic tokens — deliberately no TextMate grammar to drift out of sync).

## Toolchain

- **Build-free development, emitted releases.** Node ≥ 22.18 can run the
  workspace `.ts` sources directly through type stripping and pnpm symlinks.
  `pnpm build` / `pnpm typecheck` run composite `tsc -b`: they typecheck and
  emit package `dist/` trees. CI builds before tests, and package `prepack`
  scripts emit the JavaScript and declarations published to npm.
- **Builtin test runner** — `node --test`, zero test dependencies.
- **SQLite is `node:sqlite`** — no native modules. (The original request
  said "builtin mssql"; Node has no builtin MSSQL driver and the spec's
  storage model is SQLite/FTS5, so `node:sqlite` is the interpretation.)
- **Runtime dependencies stay at feature boundaries.** The parser uses
  `@prelude/parser`; highlighting uses `web-tree-sitter`; web ingestion uses
  `@mozilla/readability` and `linkedom`; and the opt-in `solver-z3` adapter
  alone depends on the official threaded `z3-solver` Wasm distribution.
  Website-only dependencies include React, Markdown rendering, `sql.js`, and
  Tree-sitter. The domain and solver-neutral model packages remain
  dependency-free.

```sh
pnpm install
pnpm test          # all packages, bottom-up
pnpm typecheck
pnpm --filter @cavelang/loop demo
```

## Cross-package design decisions

Package READMEs document local decisions; these are the global ones:

- **Claim keys** are JSON arrays of `[subject, verb, negated, payloadPart,
  sortedContexts]` — readable in the DB, collision-free, computed on the
  canonical (primary-direction) form so forward and inverse writes share a
  belief series (§5.5, §9.2).
- **Payload classification**: `attr: value` → attribute; numeric/date
  value → metric; nothing (`EXISTS`) → none; otherwise relation. The
  object-less `none` payload is an extension the grammar needs for bare
  existence claims.
- **Qualifier conditions are claims** (§8.1): bare entities become
  `x EXISTS`, comparisons become `left EXCEEDS value` (metric payload),
  `UNLESS` becomes `WHEN` + negation. Grouped full claims link with the
  `QUALIFIES` edge role from §13.2's role list.
- **Terms are stored formatted** (literals keep their delimiters) so
  `` `<=` `` the code literal never collides with an entity spelled the
  same, while entity queries from §13.5 work verbatim.
- **Traversal defaults**: graph reads (store, query, loop) skip negated
  and `@ 0%` rows; contradictions still coexist as data (§9.4).
- **Alias closure is union-of-rows** (§13.6):
  opt-in `aliases` on store traversal and CAVE-Q widens matching through
  current positive `ALIAS` claims (undirected recursive CTE), but stored
  rows, claim keys and bindings are never rewritten to a canonical name —
  aliased entities keep separate belief series, and disagreements surface
  side by side instead of merging silently.
- **Actor provenance stamps in the store, surfaces choose the actor**
  (§9.5): `store.ingest`/`insertResult` take `{ source }` and stamp
  `@src:<source>` on claims without a `src:` context *before* keying, so
  the same fact from different actors keeps separate belief series
  (§9.4). `cave add` passes `cli`, the MCP server `agent/<client-name>`
  (from the initialize handshake; `--src`/`--no-src` override), stdout
  ingest `ingest/<batch-digest>` (content-derived for key-stable
  re-runs) — and `cave import` passes nothing, because interchange
  replay must preserve exported claim keys.
- **Checking is a read; gating is a transaction** (§20):
  `@cavelang/shape` evaluates in-band `EXPECTS` declarations with SQL
  over current beliefs and never writes; `cave add --check` wraps
  ingest + re-evaluation in the store's savepoint-based (nestable)
  `transaction` and rolls back appends that introduce new violations —
  in-memory registry declarations included, so rolled-back claims can't
  leave vocabulary behind.
- **Connect maps exactly and diffs by provenance** (§23):
  `@cavelang/connect` substitutes record fields into CAVE-Q-style `?field`
  slots textually and pushes the result through the ordinary
  parse → canonicalize → append pipeline; each record's claims carry
  `@src:connect/<name>/<key>` (so a changed record retracts what it no
  longer yields), and `connect-digest` claims — computed over the
  *instantiated* text — make re-runs row-level incremental. `--query` runs
  a CAVE-Q pattern over the store + mapped claims inside a rolled-back
  transaction: query-time federation without persisting.
- **Rules are claims; derivations are appends** (§24): `@cavelang/rules`
  stores each rule as `rule/<digest> HAS rule: `…`` (digest over
  normalized text), joins premises by specializing CAVE-Q patterns per
  binding, and appends conclusions stamped `@src:rule/<digest>` with
  `BECAUSE` edges to the exact premise rows and a `VIA` edge to the rule.
  Confidence is `@cavelang/fusion` noisy-AND (max across derivations of
  one key); per-rule `derive-watermark` claims make re-runs skip rules no
  new row could affect, idempotency makes re-fires append nothing, and
  support is recomputed per firing so retracting a premise retracts the
  dependent chain — mutually-supporting cycles included.
- **Actions are named rules the caller fires; hooks stay out-of-band**
  (§25): `@cavelang/act` reuses the §24.1 line shape under
  `action/<name> HAS action: `…`` — bare `?param` segments declare
  caller-supplied bindings, premises gate (no solution → nothing appends,
  no noisy-AND — an action is the caller's assertion), effects append
  atomically with `@src:action/<name>` stamps and `BECAUSE`/`VIA`
  lineage, inside the §20.3 shape gate by default. Identity is the
  *name*: one evolving declaration series per subject, resolved
  newest-across-actor-series. Executable side effects never enter the
  store — the claim names a hook, the shell template lives in config
  (`--hooks`), runs strictly after commit with shell-quoted placeholders
  and the appended claims on stdin, and its failure is reported, never
  rolled back. `cave mcp` generates one `act_<name>` tool per current
  action, recomputed per `tools/list`.
- **Evals score normalized keys against self-checked fixtures**:
  `@cavelang/eval` runs each case in a fresh throwaway
  store through `@cavelang/ingest` (one agent contract everywhere), then
  canonicalizes both golden and produced claims, strips §9.5 actor
  stamps (`src:cli`, `src:agent/*`, `src:ingest`) before re-keying —
  which surface wrote a claim must not move its key, while
  fixture-authored content sources stay identity — and matches on
  key + value (relative `--tolerance`, unit-strict). Query expectations
  are exact solution sets written as `cave query` prints them; fixtures
  self-check against their own goldens before any agent run, and the
  optional judge only ever adds a parallel judged score.
- **The LLM loop policy spends the model on select/stop only**
  (spec §18): `llmPolicy` sends one completion per
  step — the query, the collected claims as canonical CAVE, the scored
  frontier — and the reply is the next cue or `STOP` (stop rides on
  select; the `done` budget check costs nothing). Edge scoring stays the
  heuristic arithmetic, so prompt scores mean the same under both
  policies; lenient reply parsing degrades to the strongest cue while
  agent *errors* propagate as failures. The model stays out-of-band
  (§19.5) behind `shellComplete` — the `cave ingest`/`cave eval`
  `--agent` shell-template contract — and the heuristic baseline is
  runnable machinery: eval reconstruction cases (`<stem>.loop.cave`,
  ordinary CAVE lines about the entity `loop`) score either policy's
  reconstruction by claim key, answering queries from the reconstruction
  alone.
- **Suggestions are questions, not merges** (§27): `@cavelang/shape`
  proposes same-entity pairs from deterministic, explainable signals —
  string similarity and exactly-two-carriers textual attribute values
  generate, shared relation neighbors only boost (siblings share
  parents) — and emits `dupe ALIAS canonical #suggested` at `score/2`
  confidence clamped to the §20.2 review band (0.3–0.5). Text out by
  default (review is a pipe into `cave add`); `--write` stamps
  `@src:suggest/alias`. Any recorded `ALIAS` history between a pair —
  merged, negated or retracted — excludes it, so review decisions stick
  and written re-runs append nothing; the optional judge is the
  ingest/eval shell-agent contract (§19.5), filtering candidates without
  ever raising a confidence or writing.
- **Resolution is a read mode; the policy is knowledge** (§26): contested
  facts — one fact asserted by several §9.5-forked series, or opposite
  polarity — group by claim key modulo `src:` contexts and negation
  (computed in SQL from the stored key's JSON, so `resolve` composes with
  `asOf` and the alias closure mechanically), and one window ranks
  candidates by precedence class (max over sources), reliability-weighted
  confidence (min over sources), then tx. Precedence and reliability are
  in-band `source/<name> HAS …` claims matched by longest segment prefix
  over a built-in ladder (cli > agent/action > root > rule); the policy
  claims themselves resolve under the built-ins alone, so ingested text
  cannot self-elevate. Winners are stored rows returned verbatim —
  nothing is rewritten, and unresolved reads keep §9.4 coexistence.
- **The id is the row; the store is the monotonic authority** (§28):
  every append mints one UUIDv7 serving as both `id` and `tx`, and
  `@cavelang/sync` merges by that identity — absent rows copy verbatim
  (claim key, raw line, side tables), present rows skip, so re-syncs are
  idempotent, chains are transitive, and the same fact recorded on two
  machines lands as two rows in one belief series (asserted twice, §9.4).
  The generator applies the Lamport receive rule (`Uuidv7.observe`): a
  store's `MAX(tx)` is observed at open and after merge. Before minting,
  each outer write reserves SQLite's write lock and observes `MAX(tx)`
  again, so concurrent processes allocate in commit order despite clock
  skew. Every append therefore outsorts everything already stored — local
  knowledge always wins locally, whatever the origin clocks read. Merge events append in-band
  `store/<from> SYNCED-INTO store/<into> @src:sync` records (only when
  effective); text interchange carries identity through `;@ <tx>` comment
  lines (`cave export --tx`), transparent to the grammar, strict on
  replay (`cave sync`), and gracefully ordinary under plain `cave import`.
  Edges form a graph and text a tree, reconciled by *re-statements*: the
  emitter renders a row's children once and re-states the claim line
  alone (same annotation) under each further citing parent — shared
  premises, a rule's `VIA` row, §24.5 support cycles — and replay unions
  identical re-statements back into one row while conflicting repeats
  reject whole. The §28.6 branching convention rides on this with no new
  surface: the committed `--tx` export is the store, working stores
  rebuild by `--no-record` sync (a checkout is plumbing, landing is a
  recorded merge), review is the export diff, and text-level git
  conflicts re-export as the union (documented merge driver).
- **Automations fire on events, never on state** (§29):
  `@cavelang/automate` evaluates triggers with the same §24.2 join rules
  and actions use, but a solution fires only when it cites a row newer
  than the automation's in-band `automate-watermark` — absent one, the
  declaration row's tx, so declaring arms the watcher and pre-existing
  matches stay state. A transitive (`VERB+`) premise cites its
  supporting edge rows (CAVE-Q's opt-in `support` option), so a new
  edge fires exactly the solutions whose connection it backs and the
  supporting path rides into hooks and prompts. Rows stamped by engine bookkeeping
  (`src:cave-automate`/`cave-derive`/`cave-act`) or by the automation's
  own steps (`src:automation/<name>`, its actions' `src:action/<x>`)
  are never events for it — no self-wakes, while cross-automation
  chains work and converge on the idempotent write paths (§24.4, §25.2,
  and the agent-reply guard, which skips reply claims equal to current
  belief). The watermark appends *before* steps execute, so a crash
  drops outside-world steps rather than replaying them — §25.4's
  never-re-notify stance — and quiescent cycles append nothing. Step
  execution reuses the §25 machinery wholesale: `action/` steps call
  `act()` (gate, lineage, hooks included), `hook/` steps read the same
  `--hooks` configuration, prompt steps ride the `shellComplete` agent
  contract (§19.5 — commands stay out-of-band; the store names hooks
  and phrases prompts).
- **The read surface reads, structurally** (§30): `@cavelang/view`'s
  view models are plain functions over a store — nothing in the package
  writes — and the server refuses every non-GET method, so read-only is
  a property of the surface, not a discipline. The page is one static
  HTML document (inline style and script, CSP `default-src 'none'` with
  self-only connections): claims render from stored columns and side
  tables, never by re-parsing text — the tree-sitter grammar stays the
  single grammar source, and no client-side parser exists to drift —
  while `raw_line` is shown where the authored text is the point.
  Binding is `127.0.0.1` unless `--host` widens it deliberately.
- **Reports render deterministically or mark the hole** (§31):
  `cave report` (also `@cavelang/view`) walks the template line by
  line — fenced `cave-q` blocks render a fragment per CAVE-Q solution
  (`?var` substituted longest-name-first, unbound tokens passing
  through), inline splices demand exactly one variable and one
  solution, and every failure renders a visible marker, lands on
  stderr with the template line, and fails the exit code — a
  deliverable never silently drops a fact. Citations dedupe by row id
  into `[^cN]` footnotes built from the *canonical* line (`emitClaim`
  over the stored row and side tables — §9.5 stamps live in the
  context table, and provenance must not hide), the tx date and the
  claim key; the §12.3/§13.6/§26.4 read opt-ins forward to every query
  in the template unchanged.
- **The standard prelude is opt-out, not baked in**: no verb is born with
  an inverse (§5.5), but `@cavelang/store` and the CLI default to the shared
  §5.5 prelude registry (`--no-prelude` / `Registry.empty` to opt out).

## Status vs the spec

- **Normative spec**: implemented, including legacy acceptance
  (colonless attributes parse, emitters always produce the colon form).
- **Draft layer (§17)** — rules `=>` passed the parser gate and are
  committed + implemented as §24 (`@cavelang/rules`, `cave derive`);
  temporal layer 2 passed it too and is committed + implemented as §32
  (trajectory values in `@cavelang/core`, time contexts in `Time`,
  interpolation in `@cavelang/query` / `cave query --at`); variables in
  core grammar, reification `[S V O]` and temporal layer 3
  (`(t -> expr)` functions) remain *not implemented*, as speced
  ("commitment is gated on the parser implementation"). CAVE-Q's `?x`
  layer (§12) is implemented.
- **Non-normative agent layer (§18)**: implemented as `@cavelang/loop`,
  including the LLM-driven policy over shell-agent templates
  with the heuristic policy as its eval baseline.
