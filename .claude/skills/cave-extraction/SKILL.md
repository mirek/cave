---
name: cave-extraction
description: CAVE extraction guide (spec §14–§15, §21, §23) — rules for converting prose, conversations, code, and structured data into CAVE claims; granularity guide, conversation compaction, boundary cases, operating modes, worked example, deterministic structured ingestion (cave connect mapping templates, record digests, watch mode, query-time overlay). Use when "caving" text, prompting or implementing extraction (e.g. @cavelang/ingest), mapping structured data (@cavelang/connect), or reviewing extracted output.
---

# CAVE — Extraction

Part of the CAVE specification. Sections keep their spec numbers; unless marked otherwise a section is **Normative**. The language reference lives in the `cave-writing` skill (§3–§8, §11, §16, §22); storage and queries in `cave-storage-query` (§9, §12–§13); rationale in `cave-design`.

## 14. Extraction Rules

When converting text into CAVE:

1. **One claim per line.** Never combine two facts.
2. **Resolve pronouns.** Replace "it", "this", "they" with concrete entities.
3. **Decisions over discussion.** If a conversation debates A vs B and chooses A, record the decision:

   ```cave
   team USES React
   React VS Vue @framework-decision
   ```

4. **Code stays exact.** Function names, error messages, config values in backticks.
5. **Drop meta-talk.** "I think we should…", "let me explain…" — extract the fact, discard the wrapper.
6. **Merge duplicates.** Same claim stated twice emits once.
7. **Preserve uncertainty.** `@ N%` for epistemic uncertainty reflecting source reliability and evidence strength (omit only for directly observed facts); `+/-` for numeric uncertainty on estimates and projections.
8. **Temporal ordering.** If sequence matters, use `PRECEDES` or numbered scoping (`step/1`, `step/2`).
9. **Prefer standard verbs; keep comments sparse.** Comments carry rationale, source hints, or nuance that does not fit the triple.
10. **Make claims actionable.** A reader should be able to act on the claim without rereading the source.
11. **Never extract secrets or selectively erasable data.** Claim history is permanent (§9.6). Omit credentials, private keys, access tokens, and personal data whose retention policy requires later deletion; do not copy them into comments, contexts, tags, or source annotations either.
12. **Preserve audience classification.** When retained source material has an
    explicit audience, add the matching §9.7 tag to every extracted claim:
    `#sensitivity:public`, `internal`, `confidential`, or `restricted`.
    Unlabeled means `internal`; never lower an authored classification, and do
    not mistake a label for permission to ingest data prohibited by rule 11.
13. **Cite the supporting span.** When numbered source text is available, add
    the smallest one-based inclusive §9.8 anchor to every extracted claim:
    `@src:docs/design.md#L10` or `@src:docs/design.md#L10-L20`. Copy the
    provided escaped source identity exactly. Do not cite a whole document
    when one sentence or short range is sufficient, and never invent a line
    number when the source surface does not provide one.

### 14.1 Granularity guide

| | Example | Verdict |
|---|---|---|
| Too coarse | `app HAS problems` | useless — no queryable fact |
| Too fine | ``line/42 HAS char/3: `f` `` | noise |
| Right | `auth/middleware HAS bug: token-expiry #security` | actionable, queryable |

The test: **could someone query or act on this claim later without reading the source?**

### 14.2 Conversation compaction

From multi-turn conversations, extract: decisions, facts learned, actions taken, failures observed, open questions, pending tasks, important context (who/when if it matters to meaning).

Skip: greetings, acknowledgments, filler, thinking-out-loud, rephrased questions, hedging, repeated explanations, unchosen alternatives unless relevant.

Open items and tasks:

```cave
api/rate-limit NEEDS decision @ 50% ; approach unresolved
api/rate-limit VS token-bucket
api/rate-limit VS sliding-window

auth/middleware NEEDS test: boundary-cases @ 70%
```

### 14.3 Boundary cases

**No extractable content** (pure greeting, empty message):

```cave
; no extractable content
```

**Code blocks.** Do not triple-ify code internals unless asked. Summarize surrounding facts:

```cave
auth/middleware CONTAINS code: `validateToken`
validateToken USES jwt
```

If exact code must be referenced:

```cave
patch HAS file: auth.ts
patch HAS line: 42
patch FIX token-expiry
```

**Structured input** (JSON/YAML/SQL): convert the structure to claims; do not echo the format.

```json
{ "service": "auth", "timeout_ms": 3000 }
```

```cave
service/auth HAS timeout: 3000ms
```

---

## 15. Operating Modes

**Extract mode** — user says "cave this", "extract triples", "compress to triples", "cave mode", `/cave`. Emit only CAVE.

**Query mode** — user asks "what do we know about auth?", "find unresolved decisions", "show low-confidence claims". Translate to CAVE-Q or SQL.

**Normal mode** — user says "stop cave", "normal mode", "explain normally". Revert to prose immediately.

---

## 21. Worked Example

Input:

> "We spent an hour debugging why the auth middleware was rejecting valid tokens. Turned out the expiry check was using strict less-than instead of less-than-or-equal, so tokens expiring in the current second got rejected. Fixed it in auth.ts line 42. We should probably add a test for boundary cases. Sarah mentioned we might want to switch to asymmetric keys, but we haven't decided yet."

CAVE output:

```cave
auth/middleware HAS bug: token-expiry #security #topic:auth-hardening
  token-expiry CAUSE reject-valid-tokens
  expiry-check USES `<`
  expiry-check NEEDS `<=`
  `<=` FIX token-expiry @auth.ts:42
auth/middleware NEEDS test: boundary-cases @ 70% ; suggested, not committed
auth/keys VS asymmetric-keys @ 50% ; Sarah proposed, no decision yet
  asymmetric-keys HAS advocate: Sarah
topic/auth-hardening CONTAINS token-expiry
```

Reads the store then supports, with no new rows:

```cave
reject-valid-tokens CAUSED-BY token-expiry   ; inverse read of the CAUSE row
token-expiry PART-OF topic/auth-hardening    ; inverse read of the CONTAINS row
```

The same store can be asked through committed CAVE-Q patterns:

```cave
?fix FIX token-expiry                     ; → `<=`
?x HAS bug: ?b #topic:auth-hardening      ; scoped-tag query
```

---

## 23. Deterministic Structured Ingestion — `cave connect`

LLM extraction (§14–§15) is for prose; structured data deserves exact,
repeatable, token-free conversion. `cave connect` maps records — CSV/TSV
rows, JSON/JSONL objects, SQLite rows, JSON/CSV URLs — through a **mapping
template** into ordinary claims, with no LLM in the loop. The same input
and mapping always produce the same claims. No new syntax: templates reuse
the CAVE-Q `?x` variable form (§12.1) inside ordinary CAVE lines, and
every produced claim flows through the standard parse → canonicalize →
append pipeline.

### 23.1 Mapping templates

A mapping is an ordinary CAVE document in which `?field` variables stand
for record fields (CSV columns, JSON keys — dotted names like
`?address.city` traverse nested JSON):

```cave
; people.map.cave

WORKS-AT IS verb ; X is employed by organization Y
WORKS-AT REVERSE EMPLOYS

?id IS person
?id HAS name: ?name
?id HAS age: ?age
?id WORKS-AT ?company
```

Top-level blocks (a line plus its indented children) split by whether
they contain a variable:

- **Prelude** — blocks without variables (verb declarations, static
  claims). Appended once per run, not per record. Declarations belong
  here, never in record templates.
- **Record templates** — blocks with variables, instantiated once per
  record.

A comment block directly above a block's first line is that line's
comment (§6.4) and belongs to the block: above a template it is
instantiated with every record, above a static claim it is appended with
the prelude. A blank line after a comment keeps it documentary. A dropped
template line takes the comment block above it along.

A variable is a whole whitespace-delimited token beginning with `?`;
tokens inside `"…"` or `` `…` `` literals are never substituted. When a
record lacks a field (or its value is null/empty), that claim line **and
its indented children are dropped** for that record — optional columns
simply yield fewer claims.

Substituted values format deterministically by position:

1. Numbers and booleans render as written (`42`, `true`).
2. A string that is a safe atom — starts alphanumeric, contains only
   `A-Za-z0-9._/+-`, and is not verb-shaped (all-caps) or a reserved word
   (`NOT`, qualifier verbs) — inserts verbatim.
3. In payload positions, a string that parses as a CAVE value (§7.1) —
   `20B USD/yr`, `2026-Q1`, `94.5%` — inserts verbatim, so metrics stay
   metrics.
4. Anything else becomes a `"…"` literal (backticks when the value
   contains a double quote; a value containing both delimiters is an
   error for that record). Newlines collapse to spaces.

Formatting never invents names: values are inserted exactly or quoted
exactly. If entities need kebab-case identity, shape them in the source
(a slug column, or a `--sql` projection).

### 23.2 Records, digests, and record provenance

Each record gets a stable identity `connect/<name>/<key>`, where `<name>`
names the source (`--name`, defaulting to the file basename) and `<key>`
is the `--key <field>` value — or, unkeyed, the content digest of the
record's instantiated claims.

Two conventions make re-runs incremental and attributable, both reusing
§9.5 provenance mechanics:

- **The digest claim.** After a record's claims append, one bookkeeping
  claim records what was written, mirroring `ingest-digest` (§9.5):

  ```cave
  connect/people/42 HAS connect-digest: 93a01c626b3f @src:cave-connect
  ```

  The digest is computed over the record's *instantiated claim text*, so
  it changes when the data **or the mapping** changes; unchanged records
  are skipped on re-run (`--force` overrides). The prelude is digested
  the same way under `connect/<name>`.

- **The record stamp.** Every claim a record produces is auto-stamped
  `@src:connect/<name>/<key>` — a lifecycle stamp, applied even when the
  template writes its own `@src:` (both contexts are kept). The stamp is
  part of claim identity (§9.5), so each record owns its belief series —
  and a changed record can be *diffed against itself*: after
  re-appending, any current claim still carrying the record's stamp but
  no longer produced by it is *retracted* (`@ 0%`).
  Attribute claims supersede naturally (the value is outside the claim
  key, §9.2); vanished relation claims retract explicitly. With
  `--prune`, records that disappeared from the source entirely are
  retracted the same way.

Records that fail to format (rule 4 above, or a missing `--key` field)
are reported and skipped; they never poison the rest of the run.
Retraction never touches vocabulary declaration claims (`X IS verb`,
`REVERSE`, or `RENAMED-TO`): registry history is additive (§5.4, §5.5,
§5.8), even when a connector record that introduced a declaration changes.

### 23.3 Continuous and query-time reads

- **`--watch`** re-runs the pass whenever a file source changes;
  per-record digests make each pass row-level incremental. This is
  continuous ingestion scaled to one machine — a tail loop, not a
  platform.
- **Push transports stay outside the core.** A socket or webhook bridge owns
  its transport-specific authentication, retry, delivery, deduplication, and
  shutdown policy, then writes a watched file or invokes one bounded connect
  pass. CAVE does not open a resident network listener whose semantics would
  vary by source.
- **`--query '<pattern>'`** is federation-lite: the mapped claims are
  appended *inside a transaction*, the CAVE-Q pattern runs over the
  union of store and source, and the transaction **rolls back** —
  external data is consulted at query time without being extracted into
  the store. Nothing persists, not even digests.

### 23.4 Declared sources

A `cave connect` invocation MAY be persisted in-band, as ordinary attribute
claims on a `source/<name>` entity — no new syntax, and the same entity
§26.3 uses for source policy:

```cave
source/people HAS path: data/people.csv
source/people HAS map: data/people.map.cave
source/people HAS key: id
source/people HAS reliability: 80%       ; §26.3, on the same entity
source/verbs HAS path: verbs.cave        ; a .cave file needs no map
```

A source's name is **one path segment**: `source/team/admin` would also be
record `admin` of source `team`, whose digest entity and stamp it would
share, so a nested name is refused. A source is declared by a current
positive `path`; the other attributes
mirror the options one-to-one — `map`, `key`, `format`, `delimiter`,
`table`, `sql`, `records` — and are read from the same entity's current
beliefs. A `.cave` path (or `format: cave`) is a **mapping-free source**:
the file is its own template, all prelude, and it is treated as a
lifecycle unit, so claims it no longer says are retracted when it changes.
Retracting the `path` (`… @ 0%`) removes the source; superseding it moves
it. Paths resolve against the **store's directory** (the SQLite file's, or
the text file's; the working directory for `:memory:`), never the working
directory: a store and its sources travel together.

A `.cave` source that becomes empty still says something — nothing — and
every claim it owned retracts. A followed `.cave` source may declare
sources the store does not, or re-declare ones it does — a newer path, or
just a new mapping or key, a delta over the current declaration; the
declarations are re-read after every followed source, the
current declaration is what runs, and a source whose declaration changed
runs again (its earlier claims retracted by the ordinary diff), until
nothing changes. An overlay or dry run applies the same rule to what it
discovers, so a preview agrees with the pass.

**Naming.** A declared source stamps `@src:<name>/<key>` on record claims
and `@src:<name>` on its prelude, and keeps its digests under
`source/<name>/<key>` and `source/<name>`, instead of the ad-hoc
`connect/<name>/<key>` of §23.2. The stamp context and the entity that
describes the source therefore mirror each other exactly as §26.3
prescribes (`src:people/42` ↔ `source/people`), so
`source/people HAS reliability: 80%` applies to what the source yields
with no further declaration. Digest, diff-on-change retraction, `--prune`,
`--force`, source spans, and the rest of §23.2 carry over unchanged; the
lifecycle run is the stamp.

**Surfaces.**

- `cave connect [--db <path>]` with no source runs one pass over every
  declared source, sources declared by a followed `.cave` source included,
  until none is left; `--name <n>` selects one together with what it
  declares in turn; `--force`, `--prune`,
  `--dry-run`, `--watch` (every declared local file and mapping, the set
  refreshed after each pass) and `--query` (an overlay of all of them,
  §23.3) apply as for a single source. The overlay and the dry run load
  every source first, URLs included, and read what a followed `.cave`
  source declares in turn from its text, so they see the sources a real
  pass would follow without appending anything; `--list` prints each
  declaration as the equivalent invocation.
  Per-source options (`--map`, `--key`, …) are rejected without a source:
  they belong on the entity.
- A CAVE text file used as `--db` (§13.7) **follows its declared sources
  on every open**: the file and what it declares are one store, assembled
  in memory. The root file itself is never re-read as a source, so a file
  that declares itself, directly or through a cycle, is loaded once (one
  file declared under several names, with different mappings say, is
  followed under each); a source that fails to load fails the open, as
  unparsable text does. URL sources are skipped during assembly, not
  errors — fetching cannot be synchronous — and `cave connect` follows
  them, a `.cave` URL included.
- `cave query --sources` overlays the store's declared sources inside a
  transaction that rolls back (§23.3), loading them first, URLs included.
  A text store followed its local sources on open — a source counts as
  followed when its prelude or any of its records carries a digest — so
  only what assembly could not follow, URL sources and what they declare,
  is loaded. The
  overlay exists for one invocation, so the answer is whole: pages are
  followed inside the transaction and `--cursor` does not apply.
- Programmatic: `@cavelang/connect` — `Declared.declaredSources(store)`,
  `Declared.prepare`/`prepareSync`, `Declared.run`, `assemble(store, root)`
  (the `openAt` assembler), and `declaredNaming(name)`.

Declared sources are data: a store received through `cave sync` may name
paths on the receiving machine, and following them is always the explicit
act of a command run there — a `cave connect` pass, an overlay, or opening
a text file as a store.
