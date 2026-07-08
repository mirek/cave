# CAVE — Implementation

A pnpm TypeScript monorepo implementing the CAVE specification
(split across the skills in [`.claude/skills/`](.claude/skills) — see the
[README's section index](README.md#the-specification) for which skill holds
which § sections).
Functional style throughout (immutable values, namespace modules in the
`@prelude` convention, no classes), built bottom-up — each package fully
documented and tested before the next one starts.

## Packages

Dependency order, bottom to top:

| Package | Spec | Purpose |
|---|---|---|
| [`@cavelang/core`](packages/core) | §2, §6, §7, §9 | Domain model: claims, values/units/multipliers, uncertainty, confidence, tags, contexts, claim keys, monotonic UUIDv7 |
| [`@cavelang/parser`](packages/parser) | §3, §4, §8, §16 | CAVE text → AST on [`@prelude/parser`](https://www.npmjs.com/package/@prelude/parser) combinators; never throws, lints |
| [`@cavelang/canonical`](packages/canonical) | §5, §8, §13.4 | Verb registry (`REVERSE`, extensions), inverse resolution, continuation expansion, qualifier edges, canonical emitter |
| [`@cavelang/store`](packages/store) | §13 | Persistence on the **Node.js builtin `node:sqlite`** — exact spec schema, append-only belief series, inverse-aware reads, FTS5 |
| [`@cavelang/query`](packages/query) | §12 | CAVE-Q patterns compiled to SQL: variables, wildcards, inverse verbs, `VERB+` transitive CTEs, `WHERE` filters |
| [`@cavelang/shape`](packages/shape) | §20 | Shape expectations (`EXPECTS` bound through the `EXTENDS` taxonomy), knowledge-health report (violations, staleness, review candidates, alias disagreements, coverage), write gating |
| [`@cavelang/connect`](packages/connect) | §23 | Deterministic structured ingestion — CSV/TSV/JSON/JSONL/SQLite/URL records mapped through CAVE templates with `?field` variables; per-record digest incrementality, watch mode, query-time overlay |
| [`@cavelang/fusion`](packages/fusion) | §10 | Bayesian fusion, noisy-AND, hypothesis helpers — pure math |
| [`@cavelang/loop`](packages/loop) | §18 | cave-loop: injectable store/policy, heuristic policy, LLM sketch, multi-hop recovery demo |
| [`@cavelang/mcp`](packages/mcp) | — | The engine as an MCP server (stdio JSON-RPC): add/query/search/about/neighbors/reconstruct/export/lint tools |
| [`@cavelang/ingest`](packages/ingest) | — | LLM-driven ingestion: batch files and web pages (fetch + Readability) through any headless agent (Claude Code, Copilot CLI, SDK scripts) with hybrid knowledge context |
| [`@cavelang/tree-sitter-cave`](packages/tree-sitter-cave) | §16 | Tree-sitter grammar (line-oriented, no external scanner) + `queries/highlights.scm` — the single grammar source behind terminal and editor highlighting; parser and WASM are generated on demand, never committed |
| [`@cavelang/highlight`](packages/highlight) | — | web-tree-sitter over the grammar WASM, rendering `highlights.scm` captures as ANSI for terminals |
| [`@cavelang/cli`](packages/cli) | — | `cave parse / highlight / add / import / query / check / export / mcp / ingest / connect / demo` |

Outside the npm dependency graph, [`editors/vscode`](editors/vscode)
packages the same grammar WASM and highlight query as a VSCode extension
(semantic tokens — deliberately no TextMate grammar to drift out of sync).

## Toolchain

- **No build step.** Node ≥ 22.18 runs `.ts` directly (type stripping);
  workspace packages export `./src/index.ts` and resolve through pnpm
  symlinks. `tsc --noEmit` (strict, `erasableSyntaxOnly`) typechecks.
- **Builtin test runner** — `node --test`, zero test dependencies.
- **SQLite is `node:sqlite`** — no native modules. (The original request
  said "builtin mssql"; Node has no builtin MSSQL driver and the spec's
  storage model is SQLite/FTS5, so `node:sqlite` is the interpretation.)
- External runtime dependency: `@prelude/parser` (plus its radix-trie),
  used by the tokenizer.

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
- **Alias closure is union-of-rows** (§13.6, roadmap open decision 2):
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
- **The standard prelude is opt-out, not baked in**: no verb is born with
  an inverse (§5.5), but `@cavelang/store` and the CLI default to the shared
  §5.5 prelude registry (`--no-prelude` / `Registry.empty` to opt out).

## Status vs the spec

- **Normative spec**: implemented, including legacy acceptance
  (colonless attributes parse, emitters always produce the colon form).
- **Draft layer (§17)** — variables in core grammar, reification `[S V O]`,
  rules `=>`, temporal values: *not implemented*, as speced ("commitment is
  gated on the parser implementation"). CAVE-Q's `?x` layer (§12) is
  implemented.
- **Non-normative agent layer (§18)**: implemented as `@cavelang/loop`.
