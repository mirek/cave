# CAVE — Roadmap

CAVE today is a language, a store, a query engine, and an agent toolkit:
text parses to claims, claims accumulate append-only in SQLite, CAVE-Q
asks questions across inverse verbs and transitive hops, fusion combines
uncertain estimates, `cave ingest` lets an LLM write the claims,
`cave reconstruct` lets one drive memory reconstruction over them, and
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

- **Sense** — deterministic structured ingestion, row-level
  incrementality, continuous ingestion (`--watch`) and query-time overlay
  shipped in 0.9.0 (`cave connect`, item 4); LLM ingestion
  (`cave ingest`) exists.
- **Model** — storage, belief evolution, inverses, query, alias closure
  (0.6.0), shape expectations (0.8.0), as-of reconstruction (0.11.0),
  the contradiction-resolution policy (0.16.0, item 11 — human
  corrections outrank ingest re-runs) and alias discovery (0.18.0,
  item 13 — `cave suggest-alias` finds what §13.6 merges) exist and
  are CAVE's strongest layer.
- **Conclude** — the rules engine shipped in 0.12.0 (`cave derive`,
  item 7): forward chaining with `BECAUSE`/`VIA` lineage, incremental by
  tx watermark; named computation tools shipped in 0.17.0 (`cave_fuse`,
  `cave_derive`, item 12); event-driven automation shipped in 0.21.0
  (`cave automate`, item 16 — rules fire in every settle cycle).
- **Act** — governed writes and side effects shipped in 0.13.0
  (`cave act`, item 8): in-band action templates with validated CAVE-Q
  preconditions, generated `act_<name>` MCP tools, out-of-band hooks;
  named computation shipped in 0.17.0 (`cave_fuse`/`cave_derive`,
  item 12); event-driven automation shipped in 0.21.0 (`cave automate`,
  item 16 — new claims matching in-band trigger patterns fire rules,
  actions, hooks and agent prompts unattended) — with `connect --watch`,
  sense → decide → act → record closes on one machine.
- **Trust** — actor provenance shipped in 0.7.0, MCP serving scope in
  0.10.0, the evals harness in 0.14.0 (`cave eval`, item 9); a human
  read surface is missing.
- **Distribute** — store merge shipped in 0.19.0 (`cave sync`, item 14 —
  row identity, the tx receive rule, `--tx` annotated text interchange;
  open decision 1 decided as spec §28); the branching convention shipped
  in 0.20.0 (item 15, spec §28.6 — text under git, working stores
  rebuilt by sync, review on export diffs, union merge driver) —
  distribute is complete.

## 1. What the architecture already gets right

Several capabilities that large data platforms build as heavyweight
services fall out of CAVE's primitives almost for free. These are the
foundations the roadmap builds on rather than replaces:

1. **The claim series is a full revision history.** One row per belief
   event under a stable claim key, `MAX(tx)` = current, history never
   destroyed, provenance in `@src:` contexts — every fact is a "stack of
   cards" recording what, when, and where it came from, reconstructable
   as of any past moment. The storage already supports this; the actor
   stamp shipped in 0.7.0 (§9.5) and the as-of query API in 0.11.0
   (item 6, spec §12.3).
2. **Reversible entity resolution is nearly free.** Merging two names
   for the same entity destructively is the classic mistake; CAVE's
   append-only model pre-solves it: merge = append `dupe ALIAS
   canonical`, unmerge = append `dupe ALIAS canonical @ 0%`, and both
   histories survive intact. Query-time alias closure shipped in 0.6.0
   (spec §13.6, roadmap item 1; the design question was open
   decision 2, now decided).
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
   derived-claim lineage natively. Implementing rules bought transforms
   + lineage + provenance in one stroke, diffable in git — shipped in
   0.12.0 as spec §24 (item 7).
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
   Draft layer; the first cut shipped in 0.8.0 as `cave check` (item 3,
   spec §20).

One overclaim to avoid: human-corrections-outrank-machine-ingest does
**not** fall out of latest-tx resolution alone. Latest-tx makes the most
*recent* claim win, not the *human's* — an ingest re-run after a manual
correction silently re-overrides it. That requires an explicit
resolution policy — shipped in 0.16.0 as spec §26 (item 11): resolved
reads compare precedence class before recency, so the human-tier series
survives the re-run.

## 2. Capability gaps

Status: **exists** (usable today) · **partial** (primitives exist,
surface or semantics missing) · **missing** (nothing implemented). Every
`[core]` gap maps to a roadmap item below.

### Sense — getting knowledge in

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Deterministic structured ingestion | `cave connect` (spec §23): CSV/TSV/JSON/JSONL/SQLite/URL records through mapping templates with `?field` variables, no LLM in the loop | exists | shipped in 0.9.0 (item 4) |
| Incremental ingestion | per-record `connect-digest` claims (§23.2) + whole-file `ingest-digest` for LLM ingestion | exists | shipped in 0.9.0 (item 4); digests cover the instantiated text, so mapping changes re-fire |
| Continuous ingestion (tail/stream/push) | `cave connect --watch` re-runs incrementally on file change | partial | push/listener sources (sockets, webhooks) remain out of scope for now |
| Query-time federation (no copying) | `cave connect --query` (§23.3): map + CAVE-Q over the union + rollback, nothing persists | partial | shipped in 0.9.0 as a transaction overlay, not `ATTACH`d views — external data is re-mapped per query, fine at one-machine scale |

### Model — the semantic layer

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Claim-level transactions, immutable history | append-only `cave_claim`, UUIDv7 tx, `MAX(tx)` = current, full history export | exists | none — this is CAVE's strongest layer |
| Schema expectations, checkable typing | `EXPECTS` attribute/relation expectations + `cave check` (spec §20), shipped in 0.8.0 (item 3) | partial | unit and cardinality expectations — presence is checkable, value shape is not yet |
| Verb lifecycle | adding verbs/inverses/topics is free, in-band | partial | *renaming/deprecating* a verb strands historical claims — needs a verb-alias / deprecation convention (entity `ALIAS` doesn't cover verbs) |
| Shape polymorphism | `EXPECTS` binds shape declarations to the `EXTENDS` taxonomy (spec §20.1) | exists | shipped in 0.8.0 (item 3) |
| Entity resolution: merge/unmerge | `ALIAS` verb (§5.2) + opt-in query/traversal closure (§13.6); unmerge = retraction | exists | shipped in 0.6.0 (item 1); disagreements surfaced by `cave check` since 0.8.0 (item 3) |
| Entity resolution: match discovery | `cave suggest-alias` (spec §27): string/graph similarity signals propose suggested `ALIAS` claims at review-band confidence; optional LLM judge; decided pairs never re-suggested | exists | shipped in 0.18.0 (item 13) |
| As-of reconstruction | `cave query --as-of` (spec §12.3): current-belief resolution at a past date, timestamp or tx | exists | shipped in 0.11.0 (item 6) |
| Contradiction-resolution policy | opt-in resolved reads (spec §26): precedence classes over §9.5 stamp families, in-band `source/<name>` reliability/precedence claims, longest-prefix specificity, tx tiebreak | exists | shipped in 0.16.0 (item 11); human corrections outrank ingest re-runs |
| Source-span provenance | `@src:` names a source, file-level | partial | a `@src:file#L10-L20` span convention — cheap, and it lets a claim answer "which sentence produced you" |
| Schema-change review | schema edits are ordinary in-band appends; since 0.7.0 stamped with the appending actor (§9.5) | partial | actor stamping makes verb/`REVERSE`/topic mutations attributable; the reviewable-diff workflow is the branch/review convention (item 15) |
| Typed client generation | none | missing | once schema-as-claims exists: generate typed TypeScript query helpers from the store's own schema claims |

### Conclude — derived knowledge

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Rules / transforms | `cave derive` (spec §24): `premises => conclusion` forward chaining over current beliefs, rules stored in-band, noisy-AND confidence | exists | shipped in 0.12.0 (item 7) — Draft §17.4 proven out and committed |
| Incremental derivation | per-rule `derive-watermark` claims (§24.4): a run skips rules no new row could affect; idempotent re-fires | exists | shipped in 0.12.0 (item 7) |
| Derivation lineage | derived claims link `BECAUSE` to their specific premise rows and `VIA` to the rule (§24.3), on the existing `cave_edge` table; export renders the derivation tree | exists | shipped in 0.12.0 (item 7) |
| Knowledge health checks | `cave check` (spec §20.2): violations, staleness, review candidates, alias disagreements, coverage; `cave add --check` write gating | exists | shipped in 0.8.0 (item 3) |

### Act — the kinetic layer

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Governed writes (actions) | `cave act` (spec §25): named action templates declared in-band, parameters validated, CAVE-Q preconditions checked against current belief, atomic effects with `BECAUSE`/`VIA` lineage, §20.3 gate by default; served as generated `act_<name>` MCP tools | exists | shipped in 0.13.0 (item 8) |
| Side effects / writeback | `HAS hook:` names a config-declared shell template (`--hooks`, §25.4) fired after commit with the appended claims on stdin | exists | shipped in 0.13.0 (item 8); the claim names the hook, the command never enters the store |
| Named computation | `cave_fuse` / `cave_derive` MCP tools: §10.1 fusion and §24 derivation invocable by name | exists | shipped in 0.17.0 (item 12); agents delegate computation instead of doing arithmetic in tokens |
| Event-driven automation | `cave automate` (spec §29): in-band `automation/<name>` trigger patterns over new claims fire rules, actions, out-of-band hooks and agent prompts; armed at declaration, watermark firing log, idempotent settle cycles | exists | shipped in 0.21.0 (item 16) |

### Trust — provenance, quality, scope

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Actor provenance (who appended this) | auto-stamped `@src:` actor contexts on MCP/ingest/CLI appends (§9.5) + tx (when) + `raw_line` (as written) | exists | shipped in 0.7.0 (item 2) |
| Extraction/query evals | `cave eval` (item 9): golden-fixture suites as plain files, N runs against any `--agent`, claim-key scoring + value tolerance, CAVE-Q expectations, optional LLM judge, `--min` CI gate; reconstruction cases (item 10) score loop policies against the heuristic baseline | exists | shipped in 0.14.0 (item 9) and 0.15.0 (item 10); ingest prompt and loop policy changes are now falsifiable |
| Serving scope | `cave mcp --read-only` / `--tools <list>` narrow the served tool surface; hidden tools are absent from `tools/list` and unknown to `tools/call` | exists | shipped in 0.10.0 (item 5) |
| Sensitivity-aware export | `#tag` / `@ctx` could mark sensitivity by convention | missing | a lightweight `#sensitivity:` convention honored by export/serve filters |
| Redaction / forgetting | none — append-only forever; retraction `@ 0%` leaves text in `raw_line` and every export | missing | an explicit stance (open decision 3): accidentally ingested secrets/PII need `cave redact` as a declared, exceptional history rewrite — or documented permanence |
| Human read surface | `cave_about`, `claimsAbout`, traversal, FTS — API/MCP only | partial | the graph cannot be *looked at*; a minimal local browse surface, not an app builder |
| Reports with citations | `cave export` canonical text, persisted comments | partial | templated markdown from CAVE-Q results with claim keys as citations, so prose deliverables trace back to claims |

### Distribute — many stores

| Capability | CAVE today | Status | Move |
|---|---|---|---|
| Multi-store sync | `cave sync` (spec §28): append-only stores merge by row identity — idempotent, transitive, conflict-free under §9.4 coexistence; store files or `;@`-annotated text (`cave export --tx`); in-band `SYNCED-INTO` merge records; the §28.2 tx receive rule | exists | shipped in 0.19.0 (item 14); open decision 1 decided |
| Branch/review workflow | the §28.6 branching convention: the committed `--tx` export is the store, working stores rebuild by sync (`--no-record` checkouts), review is the export diff, text conflicts re-export as the union (git merge driver), landing is a recorded sync | exists | shipped in 0.20.0 (item 15) |
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
   in open decision 2. — **Shipped in 0.6.0** (spec §13.6): opt-in
   `aliases` on store traversal, CAVE-Q, `cave query --aliases`, and the
   MCP query/about/neighbors tools; union-of-rows per open decision 2.
2. **Actor provenance** (spec convention + `mcp`/`ingest`/`cli`).
   Auto-stamp `@src:agent/<name>` / `@src:cli` / `@src:ingest/<digest>`
   on appends that don't already carry a source context. Completes the
   who/when/what audit triad; also the gate that makes in-band schema
   changes (verb redefinitions) attributable and reviewable. —
   **Shipped in 0.7.0** (spec §9.5): the store stamps before keying (so
   actors keep separate belief series, §9.4), `cave add` stamps
   `@src:cli` (`--no-src` opts out), the MCP server stamps
   `@src:agent/<client-name>` from the initialize handshake
   (`--src`/`--no-src` override), stdout-mode ingest stamps
   `@src:ingest/<batch-digest>` (content-derived, key-stable across
   re-runs), and `cave import` never stamps — interchange replay
   preserves exported claim keys.
3. **`@cavelang/shape` — expectations as claims + `cave check`.**
   Shape declarations in-band using a dedicated meta-verb (not `NEEDS`,
   which is a domain verb — collision with ordinary dependency claims),
   targeting the `EXTENDS` taxonomy (not name globs, which would
   institute a shadow type system): "everything `EXTENDS+ service`
   expects attribute `owner`". `cave check` reports violations, stale
   claims (tx older than N), review candidates (conf 0.3–0.7), and
   §17.6-precursor coverage stats. Optional `--strict` gating on
   `add`/`ingest` — the same checks later reused as action preconditions
   (one mechanism, two enforcement points). — **Shipped in 0.8.0**
   (spec §20): `EXPECTS` in the standard prelude declares attribute and
   relation expectations (relation direction is `REVERSE`-aware);
   instances bind through current `IS` claims into the type or its
   `EXTENDS+` descendants; `cave check` adds alias-disagreement
   surfacing (closing open decision 2's remainder) and exits 1 on
   violations only; the gate landed as `cave add --check` — append +
   re-check in one savepoint transaction, rolled back when the append
   introduces violations absent before (pre-existing violations never
   block). LLM-ingest gating stays open until the action layer (item 8)
   gives agents the governed write path.
4. **`@cavelang/connect` — deterministic structured ingestion +
   federation-lite.** `cave connect data.csv --map mapping.cave`:
   mapping templates are CAVE lines with `?column` variables (reusing
   the existing variable syntax — no new placeholder grammar), producing
   claims with no LLM in the loop; JSON/CSV/SQLite/API sources;
   **per-record digests** for row-level incrementality; `--watch` tail
   mode for continuous ingestion; read-only query-time views over local
   external data (SQLite `ATTACH`). — **Shipped in 0.9.0** (spec §23):
   CSV/TSV/JSON/JSONL/SQLite/URL sources; variable-free mapping blocks
   append once as a prelude; per-record digests cover the *instantiated*
   text (mapping changes re-fire) under `connect/<name>/<key>`; every
   record claim is stamped `@src:connect/<name>/<key>` (§9.5), so
   changed keyed records retract claims they no longer yield and
   `--prune` retracts records that left the source; federation shipped
   as `--query` — map + CAVE-Q over the union inside a rolled-back
   transaction — rather than `ATTACH`d views (equivalent read semantics
   at one-machine scale, no new query surface).
5. **MCP serving scope** (`@cavelang/mcp`): `--read-only`,
   `--tools <list>`. Small; the minimum viable agent permission
   boundary. — **Shipped in 0.10.0**: every tool declares whether it
   writes; the flags compose by intersection (`--read-only` drops
   writing tools even when `--tools` lists them); tools outside the
   scope are absent from `tools/list` and indistinguishable from
   nonexistent in `tools/call`; server instructions mention only served
   tools, and a surface with no writing tool declares itself read-only;
   read tools carry the MCP `readOnlyHint` annotation; a scope naming
   unknown tools — or serving none — fails at startup, before the
   database is opened.
6. **As-of queries** (`@cavelang/query`): `cave query --as-of <date>` —
   current-belief resolution at a past tx, reconstructed from rows that
   already exist. — **Shipped in 0.11.0** (spec §12.3): the boundary is
   a date (whole UTC day included, mirroring `WHERE tx <=` interval
   semantics), a timestamp (whole second), or an exact transaction id;
   resolution, the alias closure and transitive hops all reconstruct at
   the boundary — a claim retracted later is still believed there, one
   recorded later is unknown — and `--all` composes as
   history-up-to-the-boundary. Surfaced as `cave query --as-of`,
   `query({ asOf })` and the MCP `cave_query` tool's `asOf` parameter.

### Phase 2 — the kinetic layer and the rules engine

*CAVE stops being read-only memory; knowledge starts producing
knowledge. The rules engine (item 7) shipped in 0.12.0, action templates
(item 8) in 0.13.0, the evals harness (item 9) in 0.14.0, the LLM loop
policy (item 10) in 0.15.0, the contradiction-resolution policy
(item 11) in 0.16.0, named computation tools (item 12) in 0.17.0,
alias discovery (item 13) in 0.18.0 — phase 2 is complete; phase 3
began with store merge (item 14, 0.19.0).*

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
   + incrementality and unblocks §17 commitment. — **Shipped in 0.12.0**
   (spec §24, the §17.4 rules subset committed): rules are in-band
   claims (`rule/<digest> HAS rule: `…``, digest over normalized text),
   premises are ordinary CAVE-Q patterns (inverse verbs, `VERB+`,
   `NOT`, `@ctx`/`#tag` — plus `?var op value` constraints) joined by
   specializing patterns per binding; several derivations of one
   conclusion keep the strongest (max, so cyclic graphs converge);
   derived rows stamp `@src:rule/<digest>` (§9.5) and link `VIA` to the
   rule row as well as `BECAUSE` to premise rows; support is recomputed
   per firing with the rule's prior output suspended until re-supported,
   so retraction cascades across rules and mutually-supporting cycles
   die with their sources; `cave derive` declares rule files (non-rule
   lines are prelude), fires, `--list`s and `--retract`s.
8. **`@cavelang/act` — action templates.** Actions declared in-band
   (parameters and CAVE-Q preconditions as claims); executing = validate
   preconditions against current belief → append templated claims
   atomically → optionally fire a **config-declared** side-effect hook
   (shell template, the `--agent` pattern pointed outward; the claim may
   *name* a hook, never contain one). Exposed as generated MCP tools:
   agents get a governed write vocabulary with human-confirmable
   execution. — **Shipped in 0.13.0** (spec §25): the declaration is the
   §24.1 line shape under a stable name (`action/<name> HAS action:
   `…``) with bare `?param` segments declaring caller-supplied bindings
   and a comma-separated effect list; premises gate — no solution, no
   append, and effect confidence is the template's own (an action is the
   caller's assertion, not an inference — no noisy-AND); effects append
   atomically, stamped `@src:action/<name>` with `BECAUSE`/`VIA` lineage,
   idempotent on re-run, inside the §20.3 shape gate by default (the
   promised second enforcement point); hooks are named in-band
   (`HAS hook:`), defined out-of-band (`--hooks hooks.json`,
   `$CAVE_HOOKS`), fire strictly after commit with shell-quoted
   placeholders and the appended claims on stdin, and never roll back
   recorded knowledge; `cave mcp` serves one generated `act_<name>` tool
   per current action, recomputed per `tools/list`, composing with the
   0.10.0 serving scope (`--read-only` drops them; `act_`-prefixed
   `--tools` entries resolve at call time).
9. **`@cavelang/eval` — the evals harness.** Fixtures as plain files:
   source text + golden `.cave` for extraction; CAVE-Q + expected
   bindings for query. Run N times against any `--agent`; score by
   claim-key match, value tolerance, optional LLM judge.
   `cave eval suite/`. — **Shipped in 0.14.0**: a case is
   `<stem>.golden.cave` plus its single `<stem>.<ext>` source sibling,
   optional `<stem>.queries.cave` (CAVE-Q patterns with expected
   bindings written as `cave query` prints them — exact solution sets,
   `none`, bare must-hold patterns) and nearest-first instructions;
   each of `--runs` N opens a fresh throwaway store and drives the
   agent through `@cavelang/ingest` (same mcp/`--stdout` protocols and
   `--agent` contract), so N runs measure variance; both sides
   canonicalize and strip §9.5 actor stamps before re-keying (content
   sources like `@src:maria` stay identity; inverse writes score
   against primary-direction goldens), matches need key + value
   agreement (`--tolerance` relative, unit-strict), with misses, extras
   and value-off diagnosed per run; fixtures self-check (the golden
   must satisfy its own queries) before agent money is spent; the
   optional `--judge` pairs semantically equivalent leftovers into a
   parallel judged F1 that never moves the strict score; `--min` gates
   CI on judged-or-strict F1 and the query pass rate.
10. **LLM loop policy** (`@cavelang/loop`): implement the `llm.ts`
    `AsyncPolicy` sketch via the shell-agent template, with the
    heuristic policy as the eval baseline (via item 9). — **Shipped in
    0.15.0**: `reconstructAsync` runs the same loop with awaited
    decisions (one shared step core, identical traces); `llmPolicy`
    spends one completion per step — the model reads the query, the
    collected claims as canonical CAVE and the scored frontier, and
    replies with the next cue or `STOP` (stop rides on select; budgets
    stay local and free; scoring stays the heuristic arithmetic —
    models are better spent on select/stop); replies parse leniently
    and degrade to the strongest cue, while agent *errors* propagate as
    failures; `shellComplete` adapts any shell-agent command (the
    `cave ingest`/`cave eval` `--agent` contract: prompt on stdin,
    `{prompt-file}`, reply on stdout), so no LLM SDK enters the package
    (§19.5); the §18 SQLite adapter moved in-package (`sqliteStore`,
    shared by MCP's `cave_reconstruct` and the new
    `cave reconstruct [--agent … --query … --trace]`); and the baseline
    is machinery, not a footnote — eval *reconstruction cases*
    (`<stem>.loop.cave`: `loop SEEDS <entity>`, optional
    `query`/`steps`/`claims` attributes, plain CAVE) score any policy
    against a golden by claim key, with queries answered by the
    reconstruction alone and fixtures self-checking that seeds and
    golden claims exist in the knowledge — `cave eval loop-suite/` is
    the heuristic baseline, `--agent` the LLM policy, like for like.
11. **Contradiction-resolution policy** (`@cavelang/store`/`query`):
    configurable resolution beyond latest-tx — precedence classes (human
    correction outranks ingest re-run), source reliability, context
    specificity. §9.4 promises this; nothing implements it, and item 1's
    alias closure plus fusion both need it. — **Shipped in 0.16.0**
    (spec §26): resolution is a strictly opt-in read mode — §9.4
    coexistence stays the default and nothing is ever rewritten. Current
    rows group by claim key modulo `src:` contexts and polarity (same
    fact, different voices; `@production` vs `@staging` never contest);
    the winner compares precedence class (max over the row's sources),
    then reliability-weighted confidence (min over sources), then tx —
    so recency still rules within a tier and within a series. The policy
    is knowledge: in-band `source/<name> HAS precedence:` /
    `HAS reliability:` claims matched to `src:` contexts by longest
    segment prefix (the §9.4 "context" dimension) over a built-in ladder
    (cli 4 > agent/action 3 > everything 2 > rule 1); policy claims
    themselves resolve under the built-ins alone, so an ingested
    document can never elevate its own batch. Surfaced as
    `cave query --resolve`, `query({ resolve })`, the `resolve` opt-in
    on store traversal and the MCP query/about/neighbors tools —
    composing with `aliases` (groups widen through the closure, closing
    the §13.6 pick-a-winner gap) and `--as-of` (candidates and policy
    reconstruct at the boundary) — plus `cave resolve` listing contested
    facts with ranked candidates (`--policy` for the effective table)
    and `store.contested()`, the feed fusion combines instead of picks.
12. **Named computation tools** (`@cavelang/mcp`): expose fusion and
    derivation as MCP tools (`cave_fuse`, `cave_derive`) so agents
    delegate math instead of doing it in tokens. — **Shipped in 0.17.0**:
    `cave_fuse` runs §10.1 precision-weighted fusion over independent
    estimates of one quantity — one claim key modulo `@src:` contexts
    (§26.1's group identity, widened through the alias closure under
    `aliases`) and one unit, guarded loudly — selected by CAVE-Q
    `pattern`, by entity (`about`, the only reach into metric `IS`
    series, whose values CAVE-Q variables never bind) or as literal
    `text` fused without touching the store; denials, retracted series
    and claims without numeric `+/-` uncertainty are skipped, and the
    posterior returns as a writable CAVE value plus exact mean/sigma.
    `cave_derive` fires the store's in-band rules with the `cave derive`
    options (`dryRun`/`full`/`aliases`/`minConf`/`maxPasses`) — rules
    are declared through ordinary `cave_add` appends, so declare → fire
    never leaves the protocol; it writes, so `--read-only` drops it
    (`cave_fuse` computes without writing and survives).
13. **Alias discovery** (`cave suggest-alias`, in `@cavelang/shape` or
    `store`): propose same-entity candidates by string/graph similarity,
    optional LLM judge, emitting *suggested* `ALIAS` claims at low
    confidence for human review — discovery is the bottleneck under LLM
    naming drift. — **Shipped in 0.18.0** (spec §27, in
    `@cavelang/shape` beside the §20 health checks it feeds): candidates
    generate from string similarity (normalized equality, segment
    reorder/containment, prefixes, edit distance with a
    differing-segments guard so `north-tower`/`south-tower` sibling
    naming never fires, digit-only differences read as versions) and
    shared *rare* textual attribute values (carried by exactly the two
    candidates — never numeric, never common category values); shared
    relation neighbors boost but never generate (siblings share
    parents). Suggestions are questions, not merges: `dupe ALIAS
    canonical #suggested` at `score/2` confidence clamped to 0.3–0.5 —
    inside `cave check`'s review band — printed as pipeable CAVE text by
    default, appended stamped `@src:suggest/alias` under `--write`. A
    pair with any recorded `ALIAS` history (merged, rejected or
    unmerged), one closure group, a direct relating claim or a
    scope-parent name is never suggested, so review decisions stick and
    re-runs are idempotent; the optional `--agent` judge (the
    ingest/eval shell contract, §19.5) filters candidates against each
    side's current claims and replies with one JSON array.

### Phase 3 — distribution and the closed loop

*Many stores, running continuously, visible to humans. Store merge
(item 14) shipped in 0.19.0, the branching convention (item 15) in
0.20.0 and the closed loop (item 16) in 0.21.0 — the human read surface
(items 17–18) remains.*

14. **`@cavelang/sync` — store merge.** Merge two append-only stores;
    §9.4 contradiction tolerance makes conflicts legal data resolved at
    query time. Requires open decision 1 first: tx semantics across
    machines and a tx-carrying interchange extension (canonical text
    deliberately omits tx today — an additive spec delta, per §19.5). —
    **Shipped in 0.19.0** (spec §28, deciding open decision 1): a row's
    UUIDv7 (one value is both `id` and `tx`) is its global identity —
    merge copies rows absent by id verbatim (side tables included) and
    skips the rest, so sync is idempotent, transitive, bidirectional and
    never re-stamps (§9.5 interchange replay); the same fact recorded on
    both machines is two rows in one series, asserted twice. The §9.1
    single-writer invariant generalizes to the store via the Lamport
    receive rule: `MAX(tx)` observed at open and merge, so post-merge
    appends outsort merged history whatever the origin clocks read —
    merged history itself interleaves by origin wall clock, stated
    honestly, with §26 precedence (not tx) the cross-actor arbiter.
    Merges append in-band records (`store/<from> SYNCED-INTO
    store/<into> @src:sync`, the verb declared on first use, nothing on
    no-ops) whose belief series is the sync log. The interchange
    extension is the `;@ <tx>` transaction annotation — a comment line
    above each claim, transparent to the grammar: `cave export --tx`
    emits it, `cave sync` replays it strictly (every claim annotated, no
    repeats, whole-file rejection otherwise), plain `cave import`
    degrades to an ordinary tx-less replay; `--current --tx` is the
    seeding move for item 15. Surfaced as `cave sync <source>` (store
    file, annotated text, or stdin; `--dry-run`, `--as`/`--into`,
    `--no-record`) and `syncDb`/`syncText`/`syncFile`; deliberately not
    an MCP tool — paths are machine-local and distribution is the
    operator's concern.
15. **Branching convention** (docs + `cave sync`): branch = separate
    store file seeded by export; merge = sync; review = git PR on
    canonical text. Accepts the full-copy divergence cost — fine at
    CAVE's scale, stated honestly. — **Shipped in 0.20.0** (spec §28.6,
    non-normative — the workflow the §28 mechanics compose into, no new
    surface): the committed text is the full `--tx` export (a complete
    replica — anyone rebuilds a working store with one sync into a
    fresh file; the store file never enters git); a branch is a git
    branch plus a private store, opened as a `--no-record` checkout
    (plumbing appends no bookkeeping) or seeded lighter from
    `--tx --current`; review is the export diff — rows are immutable
    and export order is tx order, so diffs only add lines, except that
    a derivation visibly *moves* the premise lines it cites under its
    conclusion; text-level git conflicts dissolve by re-exporting the
    union (documented one-stanza git merge driver; knowledge merges
    can't conflict, §9.4), and landing reviewed text into a live store
    is a real, recorded merge event. Shipping it surfaced and fixed a
    §28.4 round-trip bug: a row cited by several parents (shared
    premises, every rule's `VIA` row, §24.5 support cycles) used to
    export with repeated ids that `cave sync` rejected — the emitter
    now renders a row's children once and *re-states* the line alone
    under further parents, and replay unions identical re-statements
    back into one row (conflicting repeats still reject).
16. **`cave automate`** (extends `rules`/`act`; distinct from
    `connect --watch`, which is ingestion): a long-running loop — new
    claims matching patterns fire rules, actions, out-of-band hooks, or
    an agent prompt. With `connect --watch` this closes sense → decide →
    act → record on one machine. — **Shipped in 0.21.0** (spec §29,
    `@cavelang/automate`): an automation is the §24.1 line shape under a
    stable name (`automation/<name> HAS automation: `…``) — trigger
    premises on the left (no bare parameters; an automation has no
    caller), steps on the right: `action/<name>` (executed under §25.2
    semantics, parameters bound from same-named trigger variables),
    `hook/<name>` (the §25.4 configuration, trigger claims on stdin) or
    a prompt literal (the `--agent` shell contract; the CAVE reply
    appends stamped `@src:automation/<name>`, unchanged claims skipped).
    A solution fires only when it cites a row newer than the
    automation's watermark that is neither engine bookkeeping nor the
    automation's own echo — armed at declaration, the watermark append
    (the firing log) lands *before* steps run, so re-runs never
    re-notify. A settle cycle interleaves incremental §24 derivation
    with trigger evaluation until nothing fires; chains across
    automations converge because every write path is idempotent. The
    daemon polls `MAX(tx)`; `--once` is the cron mode; deliberately not
    an MCP tool, though agents declare automations through ordinary
    `cave_add` appends.
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

1. **Sync tx semantics.** *Decided (0.19.0, spec §28): keep origin tx —
   the row id is global identity — and generalize the monotonic-writer
   invariant to the store.* If rows were re-stamped on merge, repeated
   syncs would lose idempotency, so they never are; the skew horn is
   answered by the Lamport receive rule (§28.2): the generator observes
   a store's `MAX(tx)` at open and after merge, so every append outsorts
   everything already stored — new local knowledge always wins locally,
   and the wall-clock interleaving of *merged history* is stated
   honestly rather than hidden (§26 precedence, not tx, arbitrates
   cross-actor trust; per-machine attribution, when wanted, is actor
   naming — `source/<name>` policy claims — not new identity machinery).
   The merge is recorded as claims (`store/b SYNCED-INTO store/a
   @src:sync`, one series per store pair). The interchange format
   carries tx through the additive `;@ <tx>` comment-line annotation
   (`cave export --tx`), which every pre-§28 reader ignores.
2. **Alias closure vs claim-key identity.** *Decided (0.6.0, spec
   §13.6): union-of-rows.* Aliased entities keep separate belief series
   (claim keys embed the subject); closure widens matching at read time,
   never rewrites stored names, and lets disagreeing series coexist
   visibly. Cross-key belief resolution was rejected — it re-opens the
   "one fact, two names" problem §19.2 solved for inverses, this time
   without a canonical direction. The remainder — surfacing cross-series
   disagreements — shipped with `cave check` in 0.8.0 (spec §20.2).
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
