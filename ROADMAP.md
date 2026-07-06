# CAVE — Roadmap

CAVE today is a language, a store, a query engine, and an agent toolkit:
text parses to claims, claims accumulate append-only in SQLite, CAVE-Q
asks questions across inverse verbs and transitive hops, fusion combines
uncertain estimates, `cave ingest` lets an LLM write the claims, and
`cave mcp` serves the whole engine to any agent.

The destination is larger: a **complete knowledge loop on one machine** —

- **sense** — knowledge flows in from files, structured data, and streams;
- **model** — claims with confidence, provenance, and belief history;
- **conclude** — rules derive knowledge that nobody typed;
- **act** — decisions execute as governed writes with real side effects;
- **trust** — every claim answers *who said this, is it checked, is it
  still believed*;
- **distribute** — stores merge, branch, and survive review

— all in plain text and one SQLite file, with the agent outside the
language (§19.5). This document maps what exists, what is missing, and
the order to build it in.

Summary of the gaps:

- **Sense** — deterministic structured ingestion, continuous ingestion,
  and query-time federation are missing; LLM ingestion (`cave ingest`)
  exists.
- **Model** — storage, belief evolution, inverses, and query exist and
  are CAVE's strongest layer; schema expectations, alias resolution, and
  a contradiction-resolution policy are missing.
- **Conclude** — nothing in a CAVE store was ever *derived*; the rules
  engine (Draft §17.4) is the single largest functional hole.
- **Act** — the entire kinetic layer (governed writes, side effects,
  automation) is missing.
- **Trust** — actor provenance, evals, serving scope, and a human read
  surface are missing.
- **Distribute** — two CAVE stores cannot merge; everything needed for
  sync already exists in the data model, unused.

## 1. What the architecture already gets right

Several capabilities that large data platforms build as heavyweight
services fall out of CAVE's primitives almost for free. These are the
foundations the roadmap builds on rather than replaces:

1. **The claim series is a full revision history.** One row per belief
   event under a stable claim key, `MAX(tx)` = current, history never
   destroyed, provenance in `@src:` contexts — every fact is a "stack of
   cards" recording what, when, and where it came from, reconstructable
   as of any past moment. The storage already supports this; it just
   isn't *surfaced* (no as-of query API, no actor stamp).
2. **Reversible entity resolution is nearly free.** Merging two names
   for the same entity destructively is the classic mistake; CAVE's
   append-only model pre-solves it: merge = append `dupe ALIAS
   canonical`, unmerge = append `dupe ALIAS canonical @ 0%`, and both
   histories survive intact. Only query-time alias closure is missing
   (and one real design question; see open decision 2).
3. **`REVERSE` keeps belief coherent across directions.** One stored
   row, one belief series, two readable names (§13.3) — the two
   directions of a relation can never drift apart in confidence. The
   relationship half of a semantic layer needs no work; investment
   belongs in the attribute/shape half.
4. **The tx log makes derived computation incremental.** The entire
   store is an append-only changelog with lexicographically ordered
   transaction ids. Any derived computation — rules firing, coverage
   stats, sync — can resume from a tx watermark instead of recomputing
   from scratch. Incrementality is a ~50-line pattern here, not a
   platform.
5. **Rules keep logic in the same graph as facts.** Data platforms
   usually separate data from transform code, then spend services
   re-linking them for lineage. Draft §17.4 rules (`?x NEEDS ?y, ?y
   NEEDS ?z => ?x NEEDS ?z`) put the logic in the same line format, same
   store, same graph as the facts — and `BECAUSE` edges give
   derived-claim lineage natively. Implementing rules buys transforms +
   lineage + provenance in one stroke, diffable in git.
6. **`cave mcp` is one governed definition for every consumer.** The
   spec card as server instructions, one tool surface for humans and
   agents alike — and because CAVE's schema is itself claims, an agent
   reads the ontology through the same tools it reads data. No generated
   SDK layer required to get typed, discoverable access.
7. **Plain text is branching, review, and distribution.** Canonical
   export under git gives branches, PRs, review, and merge with tools
   every developer already has; the export is a complete,
   self-describing (in-band registry declarations), re-ingestable
   transfer atom that crosses air gaps as a file. And because §9.4
   tolerates contradictions at write time, merging two stores can never
   "conflict" — coexisting claims are legal data, resolved at query
   time.
8. **§17.6 coverage measures knowledge quality intrinsically.** Unbound
   variables and low-confidence claims *are* the frontier — the graph
   itself says what is missing and what needs review. Expectation and
   coverage tooling is both the data-health story and the on-ramp to the
   Draft layer.

One overclaim to avoid: human-corrections-outrank-machine-ingest does
**not** fall out of latest-tx resolution alone. Latest-tx makes the most
*recent* claim win, not the *human's* — an ingest re-run after a manual
correction silently re-overrides it. That requires an explicit
resolution policy (roadmap item 11).

## 2. Capability gaps

Status: **exists** (usable today) · **partial** (primitives exist,
surface or semantics missing) · **missing** (nothing implemented). Every
`[core]` gap maps to a roadmap item below.

### Sense — getting knowledge in

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Deterministic structured ingestion | `cave ingest` (LLM extraction over files/globs/URLs) | partial | template-mapped, LLM-free path for CSV/JSON/SQLite/API sources — structured data deserves exact, repeatable, token-free conversion |
| Incremental ingestion | content-digest skip claims (`HAS ingest-digest:`) | partial | digests are whole-file; per-record keys give row-level incrementality for structured sources |
| Continuous ingestion (tail/stream/push) | none | missing | a watch/tail/listener mode appending claims as events arrive — scaled to one machine |
| Query-time federation (no copying) | none | missing | read-only claim views over external local data (SQLite `ATTACH`, CSV) resolved at query time, so not everything must be extracted into the store |

### Model — the semantic layer

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Claim-level transactions, immutable history | append-only `cave_claim`, UUIDv7 tx, `MAX(tx)` = current, full history export | exists | none — this is CAVE's strongest layer |
| Schema expectations, checkable typing | entities, verbs, in-band extension verbs, unit parsing | partial | schema-as-claims (expected attributes, units, cardinality) + a validator; typing exists by convention, is never checkable |
| Verb lifecycle | adding verbs/inverses/topics is free, in-band | partial | *renaming/deprecating* a verb strands historical claims — needs a verb-alias / deprecation convention (entity `ALIAS` doesn't cover verbs) |
| Shape polymorphism | `EXTENDS` taxonomy + transitive CAVE-Q | partial | let shape declarations target "everything that `EXTENDS+` service" — the taxonomy is queryable but nothing *binds* to it |
| Entity resolution: merge/unmerge | `ALIAS` verb (§5.2), ignored by query/traversal | partial | query-time alias closure; unmerge = retraction — near-free thanks to append-only (open decision 2) |
| Entity resolution: match discovery | none | missing | candidate suggestion (`cave suggest-alias`) — under LLM extraction, naming drift makes *discovery*, not merge mechanics, the bottleneck |
| As-of reconstruction | `history(key)`, `WHERE tx > date`; data fully supports it | partial | an as-of resolver (`cave query --as-of <date>`) — pure SQL over existing rows |
| Contradiction-resolution policy | latest-tx-per-key only | missing | §9.4 promises resolution via source reliability, precedence, context — configurable and explicit, so human corrections outrank ingest re-runs |
| Source-span provenance | `@src:` names a source, file-level | partial | a `@src:file#L10-L20` span convention — cheap, and it lets a claim answer "which sentence produced you" |
| Schema-change review | schema edits are ordinary in-band appends | missing | verb/`REVERSE`/topic mutations need actor stamping + reviewable text diffs — today any MCP client can silently redefine a verb and change the meaning of existing queries |
| Typed client generation | none | missing | once schema-as-claims exists: generate typed TypeScript query helpers from the store's own schema claims |

### Conclude — derived knowledge

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Rules / transforms | none (rules `=>` are Draft §17.4, unimplemented) | missing | forward-chaining rules engine deriving claims from patterns — CAVE's transform layer, already designed in the spec |
| Incremental derivation | none — but the tx log is the required substrate | missing | derived computation resuming from a tx watermark instead of full recomputation |
| Derivation lineage | `raw_line`, `@src:` contexts, `BECAUSE`/`VIA` edges | partial | derived claims must link to premise claims + rule via `BECAUSE` edges; today lineage exists for sources, not for conclusions |
| Knowledge health checks | `cave_lint` / parse diagnostics, `--strict` rollback | partial | *shape* checking (required attributes, staleness, confidence floors, coverage) as a runnable command, with optional write-gating |

### Act — the kinetic layer

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Governed writes (actions) | `cave_add` / `cave add` — raw ungoverned append | missing | named action templates with declared parameters and CAVE-Q preconditions; agents get a governed write vocabulary instead of freeform appends |
| Side effects / writeback | none | missing | out-of-band hooks (config-declared shell templates, like `--agent`) fired on action execution — a decision recorded in CAVE should be able to reach the outside world |
| Named computation | fusion/loop are pure libraries, not invocable by name | partial | expose fusion/derivation as named MCP tools (`cave_fuse`, …) so agents delegate computation instead of doing arithmetic in tokens |
| Event-driven automation | none | missing | a long-running loop firing rules/actions/hooks/agent prompts when new claims match patterns — closes sense → decide → act → record unattended |

### Trust — provenance, quality, scope

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Actor provenance (who appended this) | tx gives when/what; `raw_line` gives as-written | partial | auto-stamped `@src:` actor context on MCP/ingest/CLI appends completes the who/when/what audit triad |
| Extraction/query evals | none (unit tests cover code, not extraction quality) | missing | golden-fixture harness; without it, ingest prompt changes are unfalsifiable |
| Serving scope | MCP serves the whole store read-write to any client | missing | `--read-only` and per-tool enable flags — the minimum viable agent permission boundary |
| Sensitivity-aware export | `#tag` / `@ctx` could mark sensitivity by convention | missing | a lightweight `#sensitivity:` convention honored by export/serve filters |
| Redaction / forgetting | none — append-only forever; retraction `@ 0%` leaves text in `raw_line` and every export | missing | an explicit stance (open decision 3): accidentally ingested secrets/PII need `cave redact` as a declared, exceptional history rewrite — or documented permanence |
| Human read surface | `cave_about`, `claimsAbout`, traversal, FTS — API/MCP only | partial | the graph cannot be *looked at*; a minimal local browse surface, not an app builder |
| Reports with citations | `cave export` canonical text, persisted comments | partial | templated markdown from CAVE-Q results with claim keys as citations, so prose deliverables trace back to claims |

### Distribute — many stores

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Multi-store sync | `cave export`/`import` round-trips one store; contradictions coexist by design | missing | `cave sync` merging append-only stores — the data model pre-solves conflicts; tx semantics are open decision 1 |
| Branch/review workflow | plain-text export diffs under ordinary git | partial | a documented branch/merge convention (seeded store file + sync merge + PR review on canonical text) |
| Offline/air-gap operation | npm packages, no build step, single SQLite file, offline | exists | none — the canonical text export is the transferable atom |

## 3. Roadmap

Ground rules, restating §19.5: no new core syntax unless semantics
strictly demand it (reuse `?x` variables and existing conventions
everywhere); in-band declarations over config where the declaration *is*
knowledge — but executable things (hooks, agent commands) stay
**out-of-band** in config, with only references in claims, because a
store that accepts appends from LLM ingestion of untrusted documents
must never contain executable content; append-only always; SQLite +
plain text; the agent stays outside the language. Each shipped item is
its own lockstep minor version bump (per `CLAUDE.md`); phases are
sequencing, not version ranges. A new package is warranted only when the
capability has an independent dependency surface or consumer; otherwise
extend an existing one.

### Phase 1 — surface what the storage already supports

*Close trust gaps before adding power. Mostly small, high-leverage.*

1. **Alias closure** (`@cavelang/store` + `query`, no new package).
   Query-time resolution of entities through current positive `ALIAS`
   claims (recursive CTE, like `VERB+`); unmerge = `ALIAS … @ 0%`.
   Opt-in per query/traversal first; requires the belief-series decision
   in open decision 2.
2. **Actor provenance** (spec convention + `mcp`/`ingest`/`cli`).
   Auto-stamp `@src:agent/<name>` / `@src:cli` / `@src:ingest/<digest>`
   on appends that don't already carry a source context. Completes the
   who/when/what audit triad; also the gate that makes in-band schema
   changes (verb redefinitions) attributable and reviewable.
3. **`@cavelang/shape` — expectations as claims + `cave check`.**
   Shape declarations in-band using a dedicated meta-verb (not `NEEDS`,
   which is a domain verb — collision with ordinary dependency claims),
   targeting the `EXTENDS` taxonomy (not name globs, which would
   institute a shadow type system): "everything `EXTENDS+ service`
   expects attribute `owner`". `cave check` reports violations, stale
   claims (tx older than N), review candidates (conf 0.3–0.7), and
   §17.6-precursor coverage stats. Optional `--strict` gating on
   `add`/`ingest` — the same checks later reused as action preconditions
   (one mechanism, two enforcement points).
4. **`@cavelang/connect` — deterministic structured ingestion +
   federation-lite.** `cave connect data.csv --map mapping.cave`:
   mapping templates are CAVE lines with `?column` variables (reusing
   the existing variable syntax — no new placeholder grammar), producing
   claims with no LLM in the loop; JSON/CSV/SQLite/API sources;
   **per-record digests** for row-level incrementality; `--watch` tail
   mode for continuous ingestion; read-only query-time views over local
   external data (SQLite `ATTACH`).
5. **MCP serving scope** (`@cavelang/mcp`): `--read-only`,
   `--tools <list>`. Small; the minimum viable agent permission
   boundary.
6. **As-of queries** (`@cavelang/query`): `cave query --as-of <date>` —
   current-belief resolution at a past tx, reconstructed from rows that
   already exist.

### Phase 2 — the kinetic layer and the rules engine

*CAVE stops being read-only memory; knowledge starts producing
knowledge.*

7. **`@cavelang/rules` — implement Draft §17.4**, gated exactly as the
   spec demands (commitment follows the parser proving it out).
   Forward-chaining over current beliefs; derived claims append with
   `BECAUSE` edges to their *specific premise rows* (derivation lineage
   on the existing `cave_edge` table); confidence composes via
   `@cavelang/fusion` noisy-AND with the independence assumption
   explicit; **incremental by tx watermark** (only re-fire rules whose
   premises match new rows); **idempotent** (skip when the conclusion
   equals current belief — otherwise a watch loop re-appends identical
   claims forever); premise retraction re-derives or retracts
   dependents. `cave derive`. One package delivers transforms + lineage
   + incrementality and unblocks §17 commitment.
8. **`@cavelang/act` — action templates.** Actions declared in-band
   (parameters and CAVE-Q preconditions as claims); executing = validate
   preconditions against current belief → append templated claims
   atomically → optionally fire a **config-declared** side-effect hook
   (shell template, the `--agent` pattern pointed outward; the claim may
   *name* a hook, never contain one). Exposed as generated MCP tools:
   agents get a governed write vocabulary with human-confirmable
   execution.
9. **`@cavelang/eval` — the evals harness.** Fixtures as plain files:
   source text + golden `.cave` for extraction; CAVE-Q + expected
   bindings for query. Run N times against any `--agent`; score by
   claim-key match, value tolerance, optional LLM judge.
   `cave eval suite/`.
10. **LLM loop policy** (`@cavelang/loop`): implement the `llm.ts`
    `AsyncPolicy` sketch via the shell-agent template, with the
    heuristic policy as the eval baseline (via item 9).
11. **Contradiction-resolution policy** (`@cavelang/store`/`query`):
    configurable resolution beyond latest-tx — precedence classes (human
    correction outranks ingest re-run), source reliability, context
    specificity. §9.4 promises this; nothing implements it, and item 1's
    alias closure plus fusion both need it.
12. **Named computation tools** (`@cavelang/mcp`): expose fusion and
    derivation as MCP tools (`cave_fuse`, `cave_derive`) so agents
    delegate math instead of doing it in tokens.
13. **Alias discovery** (`cave suggest-alias`, in `@cavelang/shape` or
    `store`): propose same-entity candidates by string/graph similarity,
    optional LLM judge, emitting *suggested* `ALIAS` claims at low
    confidence for human review — discovery is the bottleneck under LLM
    naming drift.

### Phase 3 — distribution and the closed loop

*Many stores, running continuously, visible to humans.*

14. **`@cavelang/sync` — store merge.** Merge two append-only stores;
    §9.4 contradiction tolerance makes conflicts legal data resolved at
    query time. Requires open decision 1 first: tx semantics across
    machines and a tx-carrying interchange extension (canonical text
    deliberately omits tx today — an additive spec delta, per §19.5).
15. **Branching convention** (docs + `cave sync`): branch = separate
    store file seeded by export; merge = sync; review = git PR on
    canonical text. Accepts the full-copy divergence cost — fine at
    CAVE's scale, stated honestly.
16. **`cave automate`** (extends `rules`/`act`; distinct from
    `connect --watch`, which is ingestion): a long-running loop — new
    claims matching patterns fire rules, actions, out-of-band hooks, or
    an agent prompt. With `connect --watch` this closes sense → decide →
    act → record on one machine.
17. **`@cavelang/view` — the human read surface.** `cave serve`: one
    static, self-contained HTML page over the store — entity 360, topic
    browse, belief-history timeline per claim key, `BECAUSE`-edge
    lineage graph, coverage/frontier dashboard from `shape`.
18. **`cave report`** (in `view` or `cli`): templated markdown from
    CAVE-Q results with claim keys as citations — prose deliverables
    that trace back to claims.
19. **Temporal values, §17.5 layer 2** (`parser`/`core`): trajectories
    (`20B -> 40B @2025..2028`) with interpolation in query — only after
    rules (item 7) proves the Draft grammar path, per the spec's own
    gating.

## 4. Open design decisions

Flagged here so they are decided deliberately, not implied by code.

1. **Sync tx semantics.** If merged rows keep their origin tx,
   `MAX(tx)` = current belief becomes cross-machine wall-clock
   last-writer-wins (UUIDv7 encodes clock order, not causal order — skew
   silently flips beliefs) and the single-writer monotonic-generator
   invariant breaks. If rows are re-stamped on merge, repeated syncs
   lose idempotency. Candidate middle path: keep origin tx for identity
   but record the merge as claims (`store/b SYNCED-INTO store/a
   @time:…`) and let the resolution policy (roadmap item 11) treat
   provenance, not raw tx, as the tiebreaker across origins. The
   interchange format must carry tx (an additive canonical-text
   extension or sidecar). This decision *is* the design work of item 14.
2. **Alias closure vs claim-key identity.** Aliased entities keep
   separate belief series (claim keys embed the subject). Closure must
   choose: union-of-rows at read time (cheap, but two series can
   disagree) or cross-key belief resolution (coherent, but re-opens the
   "one fact, two names" problem §19.2 solved for inverses — this time
   without a canonical direction). Recommendation: union + surface
   disagreements as review candidates in `cave check`, never silent
   merging.
3. **Append-only vs forgetting.** Ingesting external data will
   eventually capture a secret or PII, and retraction leaves the text in
   `raw_line` and every export. Either commit to documented permanence
   (and say so), or spec `cave redact` as a declared, exceptional,
   history-rewriting operation that leaves a tombstone claim. Silence is
   the one wrong option.
4. **Verb lifecycle.** Renaming or deprecating a verb strands historical
   claims under the old name; entity `ALIAS` doesn't apply to verbs. A
   `REVERSE`-style in-band convention (e.g. verb-alias declarations
   honored by the registry) fits §19.5; needs spec design.

## 5. Permanent non-goals

Multi-tenant access-control frameworks; organizations/workspaces/project
hierarchies; app builders and analytics suites; hosted services of any
kind; distributed compute engines; model catalogs (`--agent` shell
templates already externalize model choice); read-side audit logging;
Kubernetes anything. Staying small *is the product*: every capability
above must remain runnable offline, on one machine, over one SQLite
file, with plain text as the escape hatch.
