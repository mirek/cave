---
name: cave-storage-query
description: CAVE persistence and query specification (§9, §12–§13, §20, §24–§32). Covers append-only belief history, claim identity, SQLite storage, canonicalization, CAVE-Q and temporal reads, EXPECTS shape checks and gates, rules, actions, resolution, aliases, sync, automations, views, cited reports, and valid time. Use when working on @cavelang/store, @cavelang/query, @cavelang/canonical, @cavelang/shape, @cavelang/rules, @cavelang/act, @cavelang/sync, @cavelang/automate, @cavelang/view, belief resolution, or SQL/CAVE-Q over a CAVE store.
---

# CAVE — Persistence, Query, Storage

Part of the CAVE specification. Sections keep their spec numbers; unless marked otherwise a section is **Normative**. The language reference (incl. `REVERSE` semantics, §5.5) lives in the `cave-writing` skill; the probabilistic implementation layer (§10) in `cave-design`.

## 9. Persistence, Versioning, Belief Evolution

### 9.1 Append-only

CAVE storage is append-only. Old claims are never mutated; new evidence appends claims with newer transaction IDs (UUIDv7 recommended — encodes timestamp and ordering).

```cave
Anthropic HAS ipo-timing: 2026-H2 @ 40% ; initial assessment
```

Later:

```cave
Anthropic HAS ipo-timing: 2026-H2 @ 65% ; updated after CFO statement
  BECAUSE cfo-statement
```

Later:

```cave
Anthropic HAS ipo-timing: 2026-H2 @ 35% ; market conditions worsened
  BECAUSE market/conditions BECOMES bearish
```

**Current belief** = the latest claim (max tx) with the same claim key.

### 9.2 Claim keys

The claim key identifies the *fact* whose belief evolves over time.

Relational claim `auth/middleware USES jwt`:

```text
subject = auth/middleware
verb    = USES
object  = jwt
negated = false
context = optional context set
```

Attribute/value claim `OpenAI HAS revenue: 20B USD/yr`:

```text
subject   = OpenAI
verb      = HAS
attribute = revenue
context   = optional context set
```

The value may change over time; the key stays about the same property.

Keys are computed on the **canonical (primary-direction) form**. A forward claim and its inverse reading share one key — one fact, two names (§5.5).

### 9.3 Retraction

Retract by zero confidence:

```cave
server IS compromised @ 0% ; retracted after clean forensic scan
```

The positive claim has no current support. To assert the opposite — stronger — use logical negation:

```cave
server IS NOT compromised @ 90%
```

### 9.4 Contradictions

Contradictory claims may coexist:

```cave
server IS compromised @ 60% @src:scanner-a
server IS NOT compromised @ 90% @src:forensics
```

CAVE stores knowledge; it does **not** require global consistency at write time. A query engine resolves current belief using latest transaction, source reliability, confidence, context, and explicit precedence rules — the resolution policy, defined in §26.

### 9.5 Actor provenance

Transaction ids answer *when*; `raw_line` answers *as written*. Actor
provenance answers *who appended this*: append surfaces SHOULD stamp every
claim that carries no `src:`-prefixed context with a source context naming
the acting surface. Recommended forms:

| Surface | Stamp |
|---|---|
| interactive CLI (`cave add`) | `@src:cli` |
| MCP client append (`cave_add`) | `@src:agent/<client-name>` (from the MCP `initialize` handshake; `@src:agent` when unknown) |
| orchestrated ingestion (`cave ingest --stdout`) | `@src:ingest` (stable across re-runs *and* source revisions, so a re-extracted fact supersedes in its belief series instead of forking a new key) |
| structured record mapping (`cave connect`) | `@src:connect/<name>/<key>` per record (§23.2) — record identity is what lets a changed record retract claims it no longer yields |

Rules:

- A claim that already names a source (any `src:` context, e.g. extraction
  anchors like `@src:path/to/file`) is never re-stamped — author-provided
  provenance wins. **Lifecycle stamps are the exception**: connect records
  (§23.2), rule conclusions (§24.3) and action effects (§25.2) stamp
  unconditionally for compatible text identity and record an explicit
  lifecycle run (§9.5.1) for ownership — an authored source is kept
  *alongside* the lifecycle context, and such multi-source rows resolve per
  §26.3.
- The stamp is applied **before the claim key is computed**. Contexts are
  key components (§9.2), so the same fact asserted by different actors
  keeps separate belief series — coexisting per §9.4, resolved at query
  time, never silently overriding each other.
- Interchange replay (`cave import` of canonical text) MUST NOT stamp:
  replayed claims keep the claim keys they were exported with, or the
  round trip would fork every unstamped series.
- To supersede or retract another actor's claim, restate it *with that
  claim's source context* (e.g. `x IS y @src:agent/claude @ 0%`) — the
  explicit context suppresses the stamp and lands in the original series.
- Stamps apply uniformly to every appended row, including qualifier
  condition rows and in-band declarations (`REVERSE`, `RENAMED-TO`, extension verbs) —
  which is what makes schema changes attributable and reviewable.

#### 9.5.1 Explicit provenance dimensions

The compact context spelling is preserved, but storage MUST NOT treat every
context as the same kind of provenance. Each row has a separate, indexed
provenance projection with four dimensions:

| Dimension | Meaning |
|---|---|
| `actor` | surface or agent that appended the row |
| `source` | physical evidence locator, with a line fragment removed |
| `run` | engine-owned lifecycle identity used for retraction and echo suppression |
| `domain` | explicit `scope:<name>` partition |

Append options provide the actor and, for lifecycle writes, the run before
compatibility `@src:` stamping. Authored `src:` contexts are physical sources;
`SourceSpan` decodes them and removes line fragments. `scope:` contexts become
domains. Connect, derive, act, and automate locate their own rows by `run`,
never by searching an authored context string, so user evidence cannot escape
engine ownership. The compatibility contexts, claim key, raw line, query
filters, and canonical export remain unchanged.

`cave_provenance(claim_id, dimension, value)` stores this projection.
`Store.provenanceOf(rowOrId)` reads all four lists and
`Store.byProvenance(dimension, value)` performs indexed lookup. Opening an
older store creates the table and conservatively backfills established actor
and lifecycle prefixes, decoded physical sources, and `scope:` domains.
Ambiguous legacy `src:` values stay sources rather than being guessed as
actors. Sync copies explicit rows when present and derives the same safe
fallback for older peers.

### 9.6 Retention and accidental secrets

CAVE claim history is permanent. There is no claim-level redact, purge, or
forget operation. Retraction (§9.3) changes current belief by appending another
row; it does not remove the earlier row, its `raw_line`, metadata, FTS content,
or appearances in full-history exports. `export --current` is a view, not a
sanitizer: a current row can itself contain the sensitive subject, relation,
value, context, comment, or authored raw text.

This is a deliberate auditability and convergence choice. A local delete
could not make a truthful forgetting guarantee across SQLite free pages and
FTS shadow tables, transaction journals, copied databases, `export --tx`
identity replays, sync peers, version-control history, backups, filesystem
snapshots, and storage-device remanence. It would also let an older peer
silently reintroduce the row under its global id. CAVE therefore chooses one
clear invariant over a partial erasure that looks safer than it is.

Consequences:

- Treat every claim, context, tag, value, comment, source line, and imported
  row as permanently retainable before ingest. Do not put credentials,
  private keys, access tokens, or data whose retention policy requires
  selective erasure into a CAVE store.
- A complete text export made with §9.7's `restricted` ceiling, an exact
  SQLite snapshot (§13.2.2), import, and sync preserve retained history.
  Encryption and access control
  protect copies; they do not change retention semantics.
- CAVE exposes no destructive claim command and therefore no misleading
  confirmation prompt or in-band tombstone. Normal operation never updates or
  deletes a belief row.

If sensitive data is ingested accidentally, rotate or revoke any credential
first, stop writers and sync, and inventory every database, export, clone,
backup, log, snapshot, and downstream copy. Build a replacement store only
from reviewed safe inputs (or a reviewed current export when its contents are
known safe), verify it independently, then explicitly destroy or expire every
affected copy using the storage provider's confirmed deletion procedure.
Secure deletion is an operating-system, backup-provider, and hardware concern;
CAVE cannot attest to it. Keep an affected copy only when incident-response or
legal requirements demand it, encrypted and access-restricted. Recovery of
non-sensitive knowledge means restoring the verified replacement or a
pre-incident safe backup — never merging an affected store back into it.

### 9.7 Sensitivity-scoped publication

A claim MAY carry an audience label as an ordinary valued tag:

```cave
release/status IS green #sensitivity:public
customer/renewal HAS risk: high #sensitivity:confidential
incident/root-cause IS credential-leak #sensitivity:restricted
```

The ordered levels are `public < internal < confidential < restricted`.
An unlabeled claim is `internal`. A flat `#sensitivity` tag, an unknown value,
or any malformed sensitivity tag is `restricted` (fail closed). If a row has
several sensitivity tags, its effective level is the most restrictive one.
The tag is metadata on each immutable row, not part of the claim key: a later
belief row may deliberately change the audience of the current belief without
forking its series.

Publication surfaces accept a maximum level and MUST omit every row above it.
Their default maximum is `internal`; the operator must explicitly select
`confidential` or `restricted`. The shared policy applies to canonical export,
the human HTTP view, and cited reports:

| Surface | Selector | Default |
|---|---|---|
| `Store.exportText` | `maxSensitivity` | `internal` |
| `cave export` | `--max-sensitivity <level>` | `internal` |
| MCP `cave_export` | `maxSensitivity` | `internal` |
| `cave serve` / `serve` and view models | `--max-sensitivity` / `maxSensitivity` | `internal` |
| `cave report` / `report` | `--max-sensitivity` / `maxSensitivity` | `internal` |

Filtering is structural, not a final text scrub. Counts, health summaries,
aliases, history, full-text search, and lineage MUST be computed only from the
visible rows; an edge is emitted or served only when both endpoints are
visible. For current-only export, current belief is resolved over the complete
history first and the selected row is then filtered. Therefore a hidden latest
row never revives an older, less-sensitive belief. Full-history export evaluates
each immutable row's own label.

Complete canonical history or a `;@` identity replica requires
`--max-sensitivity restricted`; sync itself remains an exact operator-to-operator
merge and copies all rows and labels verbatim. `--current` and a lower
sensitivity ceiling are useful views, not sanitizers or deletion (§9.6).
Sensitivity labels are routing metadata, not encryption, authentication,
authorization, or a retention boundary. Local SQL, CAVE-Q, general MCP reads,
and operator workflows are not silently narrowed (`cave_export` is the scoped
MCP exception); when their output will be published, use one of the scoped
publication surfaces or apply an equivalent explicit policy at the enclosing
boundary.

### 9.8 Source-span provenance

A source context MAY identify the exact one-based, inclusive source line or
line range that supports a claim:

```cave
auth/middleware HAS bug: token-expiry @src:docs/auth.md#L10
auth/middleware NEEDS test: boundary-cases @src:docs/auth.md#L10-L20
```

The grammar is `src:<escaped-source>[#L<start>[-L<end>]]`. `start` and `end`
are positive decimal integers and `end >= start`. The fragment is omitted when
only source identity is known. `#` is reserved for this fragment.

`<escaped-source>` is the UTF-8 source locator percent-encoded like a URI
component, while ASCII letters, digits, `.`, `_`, `~`, `-`, `/`, and `:` MAY
remain readable. A literal percent, hash, whitespace, `@`, `;`, query marker,
or other reserved character MUST be percent-encoded (`%25`, `%23`, `%20`,
`%40`, `%3B`, `%3F`, and so on). Therefore
`docs/design notes#1.md` becomes `docs/design%20notes%231.md`; parsers split a
line fragment only at the unescaped `#`.

The complete context remains ordinary claim-key metadata (§9.2), preserving
the exact evidence anchor through export, import, and sync. The underlying
source identity is the decoded locator without the line fragment. Resolution
and source reliability (§26) ignore the line fragment, so two spans from one
document retain one policy identity even though their exact claim series stay
distinct.

Surfaces:

- `SourceSpan.context`, `parse`, and `ofContexts` in `@cavelang/core` are the
  single formatter/parser. They expose `{ source, span, location, href? }`;
  HTTP(S) sources get a navigable `href`.
- `cave ingest` numbers embedded source lines and asks the extractor to cite
  the smallest supporting range using the printed escaped source context.
- `cave connect` attaches the physical source identity to mapped records and
  exact ranges for CSV/TSV records (including multiline quoted records) and
  JSONL records. JSON arrays and SQLite queries retain source identity without
  inventing line positions. The library accepts record-aligned `spans`.
- §30 claim JSON includes parsed `sources`; the page links HTTP(S) references.
  §31 report footnotes append the same location/link for every cited span.

A line span is a reproducible pointer into the cited source version, not a
content hash or permanent web archive. Ingest/connect digests still track
source revisions; operators that need immutable evidence must retain or
version the source itself.

---

## 12. Query Model

Two query layers: SQL over stored claims (§13.5) and **CAVE-Q**, a small graph-pattern syntax.

### 12.1 CAVE-Q patterns

```cave
?x USES jwt                       ; all systems using jwt
?x HAS bug: ?bug #security        ; all security bugs
?cause CAUSE app/crash            ; candidate causes
  WHERE conf >= 0.7
?x ?verb ?y @production           ; all production facts
terrier EXTENDS+ animal           ; transitive: one or more EXTENDS hops
```

Variables begin with `?` (`?service`, `?bug`); `_` is a wildcard:

```cave
_ USES jwt
```

Inverse verbs are valid in patterns. `?x PART-OF monorepo` and `monorepo CONTAINS ?x` compile to the same physical query against canonical rows.

### 12.2 Filters

```cave
WHERE conf >= 0.8
WHERE tag = security
WHERE context = production
WHERE value > 1000 req/s
WHERE tx > 2026-01-01
```

### 12.3 As-of resolution

Current belief (§9.1) is latest-tx-per-key over every appended row. An
**as-of query** runs the same resolution over only the rows recorded up
to a past boundary — the belief state as it stood at that moment,
reconstructed from rows that already exist (append-only storage needs no
snapshots). The boundary is one of

- a **date** — `2026-01-15` — inclusive of the whole UTC day, matching
  `WHERE tx <=` interval semantics (§12.2);
- a **timestamp** — `2026-01-15T10:30:00Z` — inclusive of that second;
- a **transaction id** — a UUIDv7 — inclusive of exactly that append.

Rows recorded after the boundary are invisible: a claim retracted later
is still believed at the boundary, a claim first recorded later is
unknown. Everything the engine resolves moves to the same instant — the
alias closure (§13.6) is computed from as-of current beliefs (entity
resolution as believed *then*; an un-anchored query uses *now*), and
transitive hops walk as-of edges. Matching the full history composes:
under `all` the query sees every row up to the boundary instead of
resolving to one per key.

Surfaces: `cave query --as-of <boundary>`, `query(store, pattern,
{ asOf })`, and the `cave_query` MCP tool's `asOf` parameter. In SQL, the
§13.5 current-belief query with the group restricted:

```sql
SELECT c.* FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim WHERE tx <= :boundary GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx;
```

---

## 13. Storage Model

### 13.1 Core table

```sql
CREATE TABLE cave_claim (
  id            TEXT PRIMARY KEY,      -- UUIDv7 or content hash + tx
  tx            TEXT NOT NULL,          -- UUIDv7 recommended

  subject       TEXT NOT NULL,          -- canonical (primary) direction
  verb          TEXT NOT NULL,          -- canonical (primary) verb
  negated       INTEGER NOT NULL DEFAULT 0,

  object        TEXT,                   -- relation object, entity, literal
  attribute     TEXT,                   -- for HAS attr: value
  value_text    TEXT,                   -- original value string
  value_num     REAL,                   -- parsed numeric value when possible
  value_unit    TEXT,                   -- normalized unit string
  value_approx  INTEGER NOT NULL DEFAULT 0,

  delta_text    TEXT,
  delta_num     REAL,
  delta_unit    TEXT,
  sigma_level   REAL DEFAULT 2.0,

  conf          REAL NOT NULL DEFAULT 1.0,
  importance    INTEGER NOT NULL DEFAULT 0,

  comment       TEXT,
  raw_line      TEXT NOT NULL,          -- exactly as written, incl. inverse form

  claim_key     TEXT NOT NULL           -- normalized key; shared by forward/inverse readings
);

CREATE INDEX idx_cave_claim_key_tx ON cave_claim (claim_key, tx);
CREATE INDEX idx_cave_subject   ON cave_claim (subject);
CREATE INDEX idx_cave_verb      ON cave_claim (verb);
CREATE INDEX idx_cave_object    ON cave_claim (object);
CREATE INDEX idx_cave_attribute ON cave_claim (attribute);
CREATE INDEX idx_cave_conf      ON cave_claim (conf);
```

### 13.2 Contexts, tags, edges, FTS

```sql
CREATE TABLE cave_context (
  claim_id TEXT NOT NULL,
  context  TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES cave_claim(id)
);
CREATE INDEX idx_cave_context ON cave_context (context);

CREATE TABLE cave_provenance (
  claim_id  TEXT NOT NULL,
  dimension TEXT NOT NULL,             -- actor, source, run, domain
  value     TEXT NOT NULL,
  PRIMARY KEY (claim_id, dimension, value),
  FOREIGN KEY (claim_id) REFERENCES cave_claim(id)
);
CREATE INDEX idx_cave_provenance_lookup
  ON cave_provenance (dimension, value, claim_id);

-- single nullable value column; flat tag == value IS NULL
CREATE TABLE cave_tag (
  claim_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,                        -- NULL for flat tags
  FOREIGN KEY (claim_id) REFERENCES cave_claim(id)
);
CREATE INDEX idx_cave_tag_key ON cave_tag (key, value);

CREATE TABLE cave_edge (
  parent_id TEXT NOT NULL,
  role      TEXT NOT NULL,             -- WHEN, UNLESS, VIA, BECAUSE, QUALIFIES
  child_id  TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES cave_claim(id),
  FOREIGN KEY (child_id)  REFERENCES cave_claim(id)
);
CREATE INDEX idx_cave_edge_parent ON cave_edge (parent_id);
CREATE INDEX idx_cave_edge_child  ON cave_edge (child_id);
CREATE INDEX idx_cave_edge_role   ON cave_edge (role);

CREATE VIRTUAL TABLE cave_fts USING fts5(
  claim_id, subject, verb, object, attribute, value_text, comment, raw_line
);
```

#### 13.2.1 Schema versions and forward migrations

Every store records an integer schema version in `PRAGMA user_version`.
Version `0` means an unversioned store written before this rule; the current
schema is version `1`. Opening a store MUST read the version before preparing
claim queries or performing any schema write.

- A version newer than the runtime supports fails immediately and names both
  versions. It is never opened by guessing at compatibility; database sync
  rejects such a source for the same reason.
- Older supported versions apply every migration in ascending order. Each
  migration, its data backfill, structural validation, and the corresponding
  `user_version` update share one `BEGIN IMMEDIATE` transaction. An
  interruption therefore leaves either the old version or the complete next
  version; reopening resumes from the committed version.
- A current-version store is validated for required tables, indexes, and
  columns. It is not silently repaired by re-running idempotent DDL.
- Migrations are forward-only. Never decrement `user_version`. Before an
  upgrade that needs an operator rollback point, stop every process using the
  store, close it, and copy the closed SQLite file. Rollback means replacing
  the upgraded store with that untouched backup under the same stopped-writer
  discipline, then using a compatible CAVE runtime.

Version 1 establishes the §13 tables and indexes and backfills the explicit
§9.5.1 provenance projection. Canonical text interchange remains independent
of SQLite schema versions; exact database sync accepts supported old versions
and preserves their rows while rejecting newer sources.

#### 13.2.2 Exact snapshot backup and restore

Canonical text is portable interchange, not an exact temporal backup: import
re-mints transaction ids. The exact path copies SQLite's complete logical
state, without a sensitivity ceiling or current-belief compaction:

```sh
cave backup --db knowledge.db --out backups/knowledge.db
cave backup --verify backups/knowledge.db --sha256 <recorded-hex>
cave restore backups/knowledge.db --db restored.db --sha256 <recorded-hex>
```

Backup uses `VACUUM INTO` on the open source connection, targeting a unique
temporary file in the destination directory. SQLite defines the completed
output as one consistent committed snapshot of the live source; WAL-contained
commits are included according to that read snapshot, and concurrent readers
and writers may remain active. CAVE then fsyncs the temporary file, requires
`integrity_check = ok`, an empty `foreign_key_check`, the current supported
schema and required structure, computes SHA-256, and atomically publishes the
verified file. An interruption can leave only an unadvertised temporary file;
an earlier destination is untouched.

The snapshot preserves every immutable claim row and its `id`, `tx`,
`claim_key`, raw line, contexts, explicit provenance, tags, edges, FTS state,
and belief history. It may be physically compacted, so "exact" means complete
logical and temporal identity rather than byte equality with the live source.

Restore first verifies the snapshot and optional recorded SHA-256, copies it
to a temporary file, fsyncs and verifies that copy again, then publishes the
same snapshot bytes atomically. The destination is required explicitly and is
never overwritten without `--force`. Restore refuses a destination with WAL,
SHM, or rollback-journal sidecars: stop every process using that path and resolve/remove stale
sidecars before retrying. On any failure, keep the last verified backup and
the prior destination; never merge a partial temporary file or copy only a
live `.db` file while ignoring its WAL.

### 13.3 Inverses are views, never rows

The store holds **one row per fact**, in canonical direction. Reverse reads are query-time views over indexes that already exist:

```sql
-- forward read (verb is primary): idx_cave_subject
SELECT object AS target, verb AS rel
FROM cave_claim WHERE subject = ?;

-- inverse read: idx_cave_object, relation named via inverse_of()
SELECT subject AS target, :inverse_verb AS rel
FROM cave_claim WHERE object = ?;
```

`inverse_of(verb)` is a lookup over the `REVERSE` declaration claims. Materializing inverses would double every row, fork the belief series per key, and double contradiction-resolution work — all avoided by keeping inverses lazy.

### 13.4 Canonicalization pipeline

Before storage:

1. Normalize verb to uppercase.
2. **Resolve a lifecycle spelling to its stable storage verb (§5.8), then if it is an inverse swap subject/object and substitute the primary verb (§5.5).**
3. **Resolve continuation lines: fill the inherited endpoint from the parent (§8.3).**
4. Normalize entity whitespace to `-`; preserve proper-noun casing.
5. Preserve `raw_line` exactly.
6. Parse confidence to decimal: `@ 90%` → `0.9`.
7. Parse approximate marker: `~20B USD/yr` → `value_approx = true`.
8. Normalize multipliers: `20B` → `20000000000`; `900M` → `900000000`.
9. Store both raw value text and parsed numeric value when possible.
10. **Split tags: `#topic:auth` → `(key=topic, value=auth)`; `#security` → `(key=security, value=NULL)`.**
11. Compute claim key **on the canonical form**.
12. Store tags and contexts in their side tables.

### 13.5 Common SQL queries

Current belief (latest tx per claim key):

```sql
SELECT c.*
FROM cave_claim c
JOIN (
  SELECT claim_key, MAX(tx) AS max_tx
  FROM cave_claim GROUP BY claim_key
) latest ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx;
```

Current high-confidence facts: add `WHERE c.conf >= 0.8`.

All facts about an entity (both directions):

```sql
SELECT * FROM cave_claim
WHERE subject = 'auth/middleware' OR object = 'auth/middleware'
ORDER BY tx DESC;
```

Tagged and scoped-tagged claims:

```sql
-- flat: #security
SELECT c.* FROM cave_claim c
JOIN cave_tag t ON c.id = t.claim_id
WHERE t.key = 'security' AND t.value IS NULL;

-- scoped: #topic:auth-security
SELECT c.* FROM cave_claim c
JOIN cave_tag t ON c.id = t.claim_id
WHERE t.key = 'topic' AND t.value = 'auth-security';
```

Production claims:

```sql
SELECT c.* FROM cave_claim c
JOIN cave_context ctx ON c.id = ctx.claim_id
WHERE ctx.context = 'production'
ORDER BY c.tx DESC;
```

Review candidates and imprecise measurements:

```sql
SELECT * FROM cave_claim WHERE conf BETWEEN 0.3 AND 0.7 ORDER BY conf;
SELECT * FROM cave_claim WHERE delta_num IS NOT NULL ORDER BY delta_num DESC;
```

Topic reads (forward and inverse of the same rows):

```sql
-- members of a topic (forward CONTAINS)
SELECT object FROM cave_claim
WHERE subject = 'topic/auth-hardening' AND verb = 'CONTAINS';

-- topics containing an entity (inverse read, relation named PART-OF)
SELECT subject FROM cave_claim
WHERE verb = 'CONTAINS' AND object = 'token-expiry';
```

Numeric threshold and comment search:

```sql
SELECT * FROM cave_claim WHERE attribute = 'weekly-users' AND value_num > 100000000;
SELECT * FROM cave_claim WHERE comment LIKE '%heap dump%';
```

### 13.6 Alias closure

`ALIAS` (§5.2) asserts that two names denote one entity. Query engines
SHOULD offer **opt-in** resolution through the *alias closure*: the set of
names connected by current positive `ALIAS` claims, read as **undirected**
edges (`ALIAS` declares no `REVERSE`, so each written direction is its own
claim key — either one asserts the link).

```cave
postgres ALIAS postgresql
billing USES postgres
analytics USES postgresql
```

With closure enabled, `?x USES postgres` matches both rows. Semantics are
**union-of-rows**: matching widens to aliased names; stored rows, claim
keys and bindings are never rewritten to a canonical name. Aliased
entities keep separate belief series — when the series disagree, the union
*surfaces* the disagreement as coexisting claims (§9.4); silent merging is
not permitted.

Merge and unmerge are ordinary appends:

- merge — `dupe ALIAS canonical`;
- unmerge — retraction, `dupe ALIAS canonical @ 0%` (per written
  direction); both histories survive intact.

Negated claims (`a ALIAS NOT b`), retracted claims, and claims with a
literal endpoint never link: aliasing is defined for **entity terms
only**, so an `ALIAS` row whose subject or object is a `"…"` text or
`` `…` `` code literal contributes no edge — two entities aliasing one
literal do not become aliases of each other. The closure is computed
from **current** beliefs even when a query runs over the full history —
it is entity resolution as believed now. A recursive CTE over the
symmetrized edge set implements it (`entity_form(t)` excludes stored
literal encodings — text that starts and ends with the same literal
delimiter, backtick or double quote):

```sql
WITH RECURSIVE alias_edge(a, b) AS (
  SELECT subject, object FROM current
  WHERE verb = 'ALIAS' AND negated = 0 AND conf > 0 AND object IS NOT NULL
    AND entity_form(subject) AND entity_form(object)
  UNION
  SELECT object, subject FROM current
  WHERE verb = 'ALIAS' AND negated = 0 AND conf > 0 AND object IS NOT NULL
    AND entity_form(subject) AND entity_form(object)
), alias_closure(name) AS (
  SELECT :entity
  UNION
  SELECT e.b FROM alias_closure s JOIN alias_edge e ON e.a = s.name
)
SELECT name FROM alias_closure;
```

The closure applies to entity positions only — values, attribute names
and verbs are not entities. Verb spellings resolve separately through
`RENAMED-TO` lifecycle declarations (§5.8).
Finding the pairs worth linking is alias *discovery* (§27).

---

## 20. Shape Expectations and Knowledge Health

Everything before this section records what *is* believed. This section
records what a store *expects to know* — schema as claims — and defines
the health checks a store runs against those expectations. No new syntax:
one meta-verb on the bootstrap, exactly like `REVERSE` (§5.5).

### 20.1 The `EXPECTS` meta-verb

`EXPECTS` declares that instances of a type are expected to carry an
attribute or a relation. It is defined in-band the way every extension
verb is, and belongs to the standard prelude:

```cave
EXPECTS IS verb ; a type expects its instances to carry an attribute or relation
```

Declarations are ordinary relational claims — subject a **type entity**,
object the expected **attribute name** (lowercase atom) or **verb**
(UPPERCASE token):

```cave
service EXPECTS owner        ; instances carry HAS owner: …
service EXPECTS repo
service EXPECTS USES         ; instances appear as subject of a USES claim
team EXPECTS PART-OF         ; instances appear where PART-OF puts them —
                             ; the object side of a stored CONTAINS row
team EXPECTS PART-OF #cardinality:one ; exactly one current parent relation
service EXPECTS latency #unit:ms      ; current value uses normalized unit ms
```

Two scoped tags add deliberately narrow value-shape constraints without a
second schema language:

- `#cardinality:one` requires exactly one current positive value or relation
  endpoint. Without it, the compatible default is `some`: one or more matches,
  preserving the original presence-only behavior. Attribute claim keys already
  exclude their value (§9.2), so an attribute normally has at most one current
  value; cardinality is chiefly useful for relation endpoints.
- `#unit:<unit>` applies to attribute expectations and requires the current
  value's normalized unit to equal `<unit>` exactly. No implicit conversions
  are performed: `s` does not satisfy `#unit:ms`; conversion policy belongs at
  an explicit typed evaluation boundary. A unitless value also fails.

The tags are ordinary claim metadata and need no grammar extension. Other tag
values retain their normal classification meaning; only
`#cardinality:one` and `#unit:<unit>` affect shape evaluation.

**Targets — binding through the taxonomy.** An entity is an *instance*
of type `T` when it carries a current positive `IS` claim whose object is
`T` or transitively `EXTENDS+` into `T`. A shape declared on `service`
therefore covers `api-gateway` through either path:

```cave
api-gateway IS service                            ; direct
microservice EXTENDS service
api-gateway IS microservice                       ; via the taxonomy
```

The `EXTENDS` taxonomy is the *only* widening mechanism — no name globs,
which would institute a shadow type system beside it. Subclass entities
themselves (`microservice` above) are not instances; expectations bind
through `IS`. Verb-token subjects are never instances — `MIGRATES IS
verb` is a declaration (§5.4), not a membership.

**Satisfaction.** An instance satisfies

- an attribute expectation `attr` when a current positive claim
  `instance HAS attr: …` exists;
- a relation expectation `V` when a current positive claim with verb `V`
  names the instance on the side `V` reads from — subject for a primary
  verb, object of the stored primary row when `V` is a declared inverse
  (§5.5). `team EXPECTS PART-OF` is met by a stored `org CONTAINS team-x`.

Negated (`VERB NOT`) and retracted (`@ 0%`) claims satisfy nothing.
When a constraint fails, the violation includes the observed match count and
units so `cave check` can distinguish missing, over-cardinality, and wrong-unit
knowledge. One `(instance, expectation)` pair remains one coverage check even
when more than one constraint is unsatisfied.

**Lifecycle.** Each expectation is its own claim key, so shapes evolve
append-only like everything else: retract with `service EXPECTS owner
@ 0%`, and the expectation stops checking; the declaration history
survives. A negated declaration (`service EXPECTS NOT owner`) never
checks — it documents a deliberate non-expectation.

Expectations do **not** constrain writes by default: §9.4 tolerance is
load-bearing, and a store must accept claims about entities it has no
shape for. Checking is a read (§20.2); enforcement is an opt-in gate at
specific append surfaces (§20.3).

### 20.2 Knowledge health — `cave check`

`cave check` reads the store against its own declared expectations and
reports, without writing anything:

| Section | What it lists |
|---|---|
| violations | (instance, expectation) pairs currently unsatisfied |
| stale | current beliefs whose tx timestamp is older than N days (UUIDv7 encodes wall-clock ms) |
| review candidates | current beliefs with `0.3 <= conf <= 0.7` (§13.5) |
| alias disagreements | cross-series conflicts inside an alias group (below) |
| coverage | aggregate stats — the §17.6 precursor |

**Alias disagreements** close the loop §13.6 left open (union-of-rows
surfaces disagreements; something must *look*): within one alias closure
group, member names keep separate belief series, and the checker reports

- **value disagreements** — two member names carry current positive
  claims with the same verb and attribute but different values
  (`postgres HAS version: 14` vs `postgresql HAS version: 15`);
- **polarity disagreements** — same verb and object, one series currently
  positive, another currently negated (`postgres IS production` vs
  `postgresql IS NOT production`).

A retracted series conflicts with nothing — absence is not disagreement.

**Coverage** measures knowledge quality intrinsically (§17.6): claim and
fact counts, retracted and negated counts, the confidence distribution of
current beliefs, the fraction of entities carrying a current `IS` type,
and the fraction of expectation checks satisfied. Low-confidence claims
and unsatisfied expectations *are* the frontier — the graph itself says
what is missing and what needs review.

Violations make the check fail (nonzero exit); stale claims, review
candidates and disagreements are advisory.

### 20.3 Write gating

The same checks, applied at an append surface instead of after the fact:
a gated append runs inside one transaction — append, check, and roll back
when the append **introduces violations that were not present before**.
Pre-existing violations never block: the gate compares, it does not
demand a clean store. `cave add --check` is the first enforcement point;
action preconditions (§25) reuse the identical mechanism — one
mechanism, two enforcement points.

### 20.4 Versioned typed-client generation

`EXPECTS` remains in-band knowledge and CAVE text/CAVE-Q remain the primary
interfaces. For applications that want compile-time ergonomics, CAVE can emit a
derived TypeScript module from the current positive expectations:

```sh
cave generate --db knowledge.db --out src/generated/cave-client.ts
```

Format version 1 maps each declared type to a deterministic PascalCase
interface and `read<Type>(store, entity)` function. Exact authored field names
are quoted properties. Attribute values retain `{ text, number, unit }`;
`#unit:<unit>` narrows the generated unit to that string literal. Relation
readers use store traversal and the effective inverse registry. The compatible
`some` cardinality emits a readonly array; `#cardinality:one` emits a scalar
and throws clearly at runtime unless exactly one current positive row exists.

The module embeds `caveClientFormatVersion`, a normalized `caveSchema` value,
and a SHA-256 digest over `{ version, fields }`. Expectations and types are
sorted by code-point order, so declaration transaction order, process locale,
and reopen do not affect bytes. A schema change changes the digest and output;
retracting it restores the earlier artifact when the normalized schema is the
same.

Generation is strict where static output would otherwise lie. It fails before
writing when:

- a type cannot map to an ASCII TypeScript identifier, or two type names map
  to the same identifier;
- duplicate current declarations for one field disagree on cardinality, unit,
  direction, or other generated semantics;
- `#cardinality` is repeated or is not `one`/`some`;
- `#unit` is repeated, empty, or attached to a relation; or
- the requested output format version is unsupported.

Surfaces: `generateClient(store, { version? })` and
`cave generate [--db] [--out] [--version] [--no-prelude]`. Generation reads
but never mutates the store. Generated files are build artifacts: regenerate
and review them when schema claims change; never hand-edit them.

---

## 24. Rules and Derivation

Everything before this section stores, checks, or asks; nothing
*concludes*. This section commits the rules subset of the Draft unified
grammar (§17.4) — the parser implementation proved it out, which is the
gate §17 set for itself. Reification, temporal values and variables in
ordinary claim lines remain Draft.

### 24.1 The rule line

```cave
?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z
?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian
?x PRECEDES ?event, ?x CONTAINS ?change => ?change CAUSE ?event @ 50%
```

`=>` is the only rule-specific token (§17.4). The left side is a
comma-separated conjunction of **premises**; the right side is one
ordinary claim line, the **conclusion**. A `=>` or `,` inside a `"…"` or
`` `…` `` literal never splits the rule.

A premise is either

- a **pattern** — a CAVE-Q pattern (§12.1): `?var` variables, `_`
  wildcards, `NOT` (matching explicitly negated claims — there is no
  negation-as-failure), inverse verbs, transitive `VERB+` hops, and
  inline `@ctx` / `#tag` filters all carry over unchanged; or
- a **constraint** — `?var op value` with `op` one of
  `= != < <= > >=`. Numeric comparison applies when both sides parse as
  numbers (a unit on the constraint demands the same unit on the bound
  value); `=` and `!=` otherwise compare text. A constraint's variable
  MUST be bound by an earlier pattern premise.

The conclusion parses as an ordinary claim whose subject, object, or
value slots may be variables; every conclusion variable MUST be bound by
some pattern premise, and `_` is not allowed. Conclusion metadata rides
along (`@ctx`, `#tag`, `!`, `; comment`); its `@ N%` is the **rule
confidence factor** (§24.2). A trailing comment is the rule's label.

**Rules are stored in-band** as ordinary attribute claims, so derived
claims can point lineage edges at them and rule lifecycle is ordinary
belief evolution:

```cave
rule/9f30ac9be4dd HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z` @src:cave-derive
```

Rule identity is the first 12 hex chars of SHA-256 over the rule's
**normalized text** (tokens single-spaced, comment dropped) —
whitespace variants of one rule share a digest, and re-declaring an
unchanged rule appends nothing. Retraction (`… @ 0%`) disables the rule;
`cave derive --retract` also retracts everything it derived. A rule is
pure data — it can only ever append claims — which is why it may live
in-band where executable content (hooks, agent commands) must not
(§19.5); derivation still runs only when explicitly invoked.

### 24.2 Firing — forward chaining over current beliefs

`cave derive` fires every current positive rule to a fixpoint. Premises
match **current, positive, non-retracted** beliefs (§12's defaults),
joined left to right: each partial binding specializes the next pattern
and runs it as an ordinary CAVE-Q query, so inverse verbs cost nothing
and the alias closure (§13.6) applies when opted in. Transitive
premises constrain bindings but contribute no premise row — no
confidence, no lineage edge.

Each solution instantiates the conclusion template and pushes it through
the ordinary canonicalization pipeline (§13.4) — an inverse-verb
conclusion lands in primary direction, on the same claim key either
spelling would produce. Derived confidence is **noisy-AND under an
explicit independence assumption** (§10.2):

```text
conf = rule-conf × Π premise-row-conf
```

When several solutions conclude the same claim key in one firing, the
**strongest derivation wins** — max, not accumulation: many weak paths
never claim more than the best single one, and cyclic premise graphs
converge. Conclusions below a floor (default 5%) are not asserted.

Surfaces: `cave derive`, and the MCP `cave_derive` tool (ROADMAP
item 12) with the same semantics (`dryRun`, `full`, `aliases`,
`minConf`, `maxPasses`). Rules are ordinary claims, so an agent declares
them through `cave_add` and fires them without leaving the protocol;
the tool writes, so a `--read-only` serving scope drops it.

### 24.3 What a derivation appends

A derived claim is an ordinary append with three §9/§13 obligations:

- **actor provenance** (§9.5): stamped `@src:rule/<digest>` and owned by the
  explicit `run = rule/<digest>` dimension — applied even when the conclusion
  template names its own `src:` (both contexts are kept), so §24.5 support
  and `--retract` always find the rule's output. A rule's output is one belief series per conclusion,
  separate from any hand-written series about the same fact — coexisting
  per §9.4, never silently overriding;
- **lineage** (`cave_edge`, §13.2): `BECAUSE` edges to the *specific
  premise rows* that fired, and a `VIA` edge to the rule's declaration
  row — evidence and mechanism, in the roles §8.2 already defines.
  Canonical export renders the whole derivation tree as indented
  qualifier lines, and import replays it;
- **append-only belief evolution** (§9.1): a re-derivation with changed
  premise confidence appends a new row to the same series; history
  survives.

### 24.4 Idempotency and incrementality

Re-running `cave derive` on an unchanged store appends **nothing** — a
conclusion equal to its current belief (same key, value, confidence) is
skipped, so watch loops never accrete identical claims.

Firing is **incremental by transaction watermark**: after a run, each
fired rule records the highest transaction it accounted for, in-band:

```cave
rule/9f30ac9be4dd HAS derive-watermark: 019f47ba-8f72-7000-… @src:cave-derive
```

A later run re-fires a rule only when some row recorded after its
watermark could extend a premise match — a *shape* test
(subject/verb/object/attribute/negation plus context and tag
membership) that deliberately ignores confidence and currency, so a
retraction row re-fires the rules its claim used to feed. Over-matching
costs a wasted evaluation; under-matching would be a missed conclusion,
so ambiguity resolves toward firing. `--full` ignores watermarks.

A watermark is trusted only when it postdates the rule's **current
declaration row**: retracting a rule retracts what it derived (§24.5),
and re-declaring the same text keeps the digest — and so the watermark
claim key — so an inherited watermark would skip every pre-existing
premise and leave the conclusions unrestored. A re-declared rule fires
from scratch, as if unmarked, then records a fresh watermark and later
runs are incremental again.

### 24.5 Support — retraction propagates

A derivation's justification must not outlive its premises. On every
firing the rule's support is recomputed from scratch: previously derived
claims the rule no longer concludes are retracted `@ 0%` (with the
standard comment convention), and while a fired rule's earlier
derivations are being re-established they are invisible to premise
matching unless re-supported. The consequence is well-founded support —
retracting a premise retracts the dependent chain, across rules, and
mutually-supporting derivation cycles cannot keep each other alive.
Retractions are ordinary appends, so cascades settle inside the same
run's fixpoint loop, and `--retract <rule>` retracts the rule's whole
output the same way.

One boundary stated honestly: hops inside a transitive (`VERB+`)
premise are walked over stored edges without suspension, so a derived
edge can keep supporting a *path* while its own support is being
re-established; `--full` recomputes everything from source beliefs.

---

## 25. Actions — the Governed Write Path

Rules (§24) conclude on their own; nothing yet lets a *caller* — a human
at the CLI, an agent over MCP — record a decision through a named,
validated write instead of a freeform append. This section commits
**actions**: write templates declared in-band, gated on current belief,
executed atomically, optionally reaching the outside world through
out-of-band hooks.

### 25.1 The action declaration

An action is declared exactly like a rule (§24.1) — one ordinary
attribute claim whose value is the action's **body**:

```cave
action/mark-deployed HAS action: `?service, ?version, ?service IS service => ?service HAS deployed-version: ?version` ; record that a service version reached production
```

The body reuses the §24.1 rule line — `left => right`, `=>` the only
special token, split outside `"…"` and `` `…` `` literals — with three
action-only deltas (additive, and confined to the `action` attribute;
rule lines are unchanged):

- a left segment that is a **bare variable** (`?service`) declares a
  **parameter** — a binding the caller supplies at execution. Everything
  else on the left is a §24.1 premise, verbatim: CAVE-Q patterns
  (inverse verbs, `VERB+`, `NOT` matching explicitly negated claims —
  still no negation-as-failure, `@ctx` / `#tag` filters) and
  `?var op value` constraints. Constraints may test parameters as well
  as pattern-bound variables. The left side may also be empty — a
  parameterless, unconditional template;
- the **right side is a comma-separated list** of one or more **effect
  templates** — ordinary claim lines whose subject, object, or value
  slots may be variables. Each effect's metadata rides along (`@ctx`,
  `#tag`, `!`); its `@ N%` is the confidence the effect is asserted with
  (default 100%). Variables cannot name attributes;
- an effect variable must be a parameter or bound by a pattern premise;
  `_` is not allowed. A parameter needs no other mention — one used only
  by the action's hook (§25.4) is legal.

Naming: the subject is `action/<name>` by convention, and the *name* —
not a content digest — is the identity: redeclaring appends to the same
claim key, so an action has exactly one current definition and its
evolution is an ordinary belief series (§9.1). Retraction (`… @ 0%`)
disables the action; effects of past executions are recorded knowledge
and are **not** retracted with it — they were true when executed
(contrast §24.5, where a derivation's justification is its rule).

The declaration comment is the action's description. Two optional
companion claim shapes refine it — documentation and reference only,
never semantics:

```cave
action/mark-deployed/service IS param ; the service that was deployed
action/mark-deployed/version IS param ; the version now running
action/mark-deployed HAS hook: deploy-notify
```

`action/<name>/<param> IS param` documents a parameter (its comment is
the description, surfaced by `cave act --list` and MCP schemas);
`HAS hook:` **names** an out-of-band hook (§25.4). Like rule text, an
action body is pure data — it can only ever describe claims to append —
which is why it may live in-band where executable content must not
(§19.5); the hook *name* is in-band, the hook *command* never is.

### 25.2 Execution

`cave act <name> param=value …` (or the generated MCP tool, §25.5):

1. The current positive `action/<name> HAS action:` declaration is
   resolved and its body parsed.
2. Arguments are validated: every parameter supplied, no unknown names.
   Values format exactly like §23.1 record fields — token-safe atoms
   verbatim, anything else as a quoted literal, numbers and dates bare
   in payload position; formatting never invents names.
3. Premises evaluate left to right over **current, positive,
   non-retracted** beliefs with parameters pre-bound — each pattern is
   specialized by the bindings so far and runs as an ordinary CAVE-Q
   query (§24.2's join), so inverse verbs cost nothing and the alias
   closure (§13.6) applies when opted in. **A premise with no solution
   fails the action**: nothing is appended, and the report names the
   first premise that found no match. This is precondition validation.
4. Premise-bound variables used in effects must bind **uniquely** across
   the surviving solutions — an ambiguous binding fails the action
   (contrast §24.2, where a rule fires once per solution: an action
   executes once, deterministically, or not at all).
5. Effects instantiate through the ordinary canonicalization pipeline
   (§13.4) and append **atomically** — one transaction, all or nothing;
   any canonicalization problem rolls the whole execution back. Effect
   confidence is the template's own — **not** noisy-AND over premise
   rows (§24.2): an action is the caller's assertion, and its premises
   are gates, not evidence.
6. Appended rows carry the §24.3 obligations: stamped
   `@src:action/<name>` and owned by explicit `run = action/<name>` provenance
   (applied even when the template names its own `src:`, both kept: execution
   attribution is mandatory), `BECAUSE` edges to the premise rows of the justifying
   solution (the first, when several survive) and a `VIA` edge to the
   declaration row. Executions by different callers land in one belief series per
   effect key — the action, not the caller, is the acting surface.
7. Execution is **idempotent** (§24.4's convention): an effect equal to
   its current belief — same key, value, confidence — appends nothing
   and reports `unchanged`.

### 25.3 The gate — second enforcement point

§20.3 promised it: execution runs inside the shape gate **by default** —
effects append and the store re-checks its `EXPECTS` declarations in one
transaction, rolled back when the append introduces violations that were
not present before. Pre-existing violations never block. One mechanism,
two enforcement points: `cave add --check` opts *in*, actions opt *out*
(`--no-check`) — the governed path is governed until told otherwise.

### 25.4 Hooks — reaching the outside world

A decision recorded in CAVE should be able to reach the outside world;
executable content must never live in the store (§19.5). Hooks resolve
the tension by construction: the action claim **names** a hook, and the
command template lives out-of-band in configuration —

```json
{ "deploy-notify": "curl -sf -X POST https://ops.example/deploys -d @-" }
```

— supplied per run (`cave act --hooks hooks.json`, `cave mcp --hooks`,
or `$CAVE_HOOKS`). After an execution **commits** having appended or
updated at least one claim, a named-and-configured hook's template runs
as a shell command: `{action}` and `{<param>}` placeholders substitute
first — every value **shell-quoted**, never spliced raw — and the
appended claims arrive as canonical CAVE text on stdin (the data
channel; placeholders are for routing).

Hook outcomes are honest and asymmetric by design:

- the store never lies: the hook runs strictly *after* commit, and a
  failing hook cannot un-happen recorded knowledge — the failure is
  *reported* (nonzero exit; `isError` over MCP) with the claims intact;
- a hook that is named but not configured is reported as not fired —
  running without hook configuration is a legitimate, side-effect-free
  mode, not an error;
- idempotent no-op executions (nothing appended, nothing updated) and
  dry runs never fire hooks — a watch loop must not re-notify the world
  about claims that did not change.

### 25.5 Serving — the governed write vocabulary

`cave mcp` generates one tool per current positive action —
`act_<name>` (the name after `action/`, characters outside the MCP tool
alphabet mapped to `_`) — description from the declaration comment plus
its parameters, preconditions and effects; input schema from the
parameters (`IS param` comments as property descriptions, all
required). The served set is computed per `tools/list`, so an action
declared mid-session appears without reconnecting.

Serving scope (0.10.0) composes unchanged: action tools write, so
`--read-only` drops them all; `--tools` may list them by name, and an
`act_`-prefixed scope entry is validated at call time rather than
startup — it scopes whichever actions exist when asked. Agents get
exactly the write vocabulary the operator serves — parameters, validated
preconditions, atomic appends, provenance — instead of freeform
`cave_add`; MCP clients surface the calls through their ordinary
tool-permission prompts, which is where a human confirms.

---

## 26. Contradiction Resolution

§9.4 tolerates contradictions at write time and promises the other half:
"a query engine resolves current belief using latest transaction, source
reliability, confidence, context, and explicit precedence rules". Until
now only latest-tx-per-key existed — which resolves *within* one belief
series but says nothing when several series assert the same fact: actor
stamps fork series on purpose (§9.5), content sources fork them by
authorship, negation forks them by polarity, and aliased names keep
separate series by design (§13.6). Latest-tx across those series would
make the most *recent* claim win, not the most *trusted* — an ingest
re-run after a manual correction would silently re-override it. This
section commits the **resolution policy**: an explicit, configurable
rule for picking one winner per fact among coexisting current beliefs.

Resolution is a **read mode**, strictly opt-in. Default reads keep §9.4
coexistence untouched — contradictions remain visible data; nothing is
ever rewritten, merged, or deleted. A resolved read filters, it does not
edit: the winner is a stored row, returned verbatim.

### 26.1 The resolution group — one fact, many voices

Rows compete only when they answer the same question. The **resolution
group** of a current row is its claim key (§9.2) with

- every `src:` context **removed** — sources say *who* asserted the
  fact, not *which* fact it is; and
- the negation flag **dropped** — `server IS compromised` and
  `server IS NOT compromised` are opposite answers to one question, the
  §9.4 example (§9.3's "assert the opposite — stronger").

Everything else stays: subject, verb, payload part (the object of a
relation, the attribute name of an attribute claim), and the non-source
contexts. Claims scoped to different non-source contexts
(`@production` vs `@staging`) are *different facts*, never contested
against each other; claims differing only in source or polarity are one
contested fact.

Under the alias closure (§13.6, opt-in as everywhere), groups widen:
subject and relation-object entities resolve to their closure group, so
`postgres HAS version: 14 @src:a` and `postgresql HAS version: 15
@src:b` contest one group. The winner still keeps its stored spelling —
union-of-rows semantics carry over; resolution picks among rows, it
never rewrites names.

**Candidates** are the current row (latest tx) of each series in the
group, excluding retracted rows: a series at `@ 0%` has no current
support (§9.3) and neither wins nor blocks. Negated rows are candidates —
polarity is the contest. A group whose candidates are all retracted
resolves to *unknown*: no row survives.

### 26.2 The policy — precedence, reliability, recency

Among a group's candidates the winner is decided by comparing, in
order:

1. **Precedence class** — an integer per source, higher outranks. A
   row's class is the **maximum** over its `src:` contexts' classes (a
   claim is as authoritative as its strongest backer); a row with no
   source context takes the root class.
2. **Effective confidence** — the row's stored confidence times its
   **reliability**, a `0..1` weight per source (default `1`). A row's
   reliability is the **minimum** over its `src:` contexts' weights (a
   chain of provenance is as reliable as its weakest link). The stored
   row is returned unmodified — reliability ranks, it never rewrites
   `conf`.
3. **Latest transaction** — the §9.1 rule, now the tiebreaker. Two
   candidates never tie beyond it (tx is unique per row).

The class hierarchy is why a human correction survives an ingest
re-run: the re-run appends a newer row in the machine-tier series, but
the human-tier series outranks it regardless of recency. Recency still
governs *within* a tier — and within one series, exactly as before.

### 26.3 Declaring the policy — `source/…` claims

Precedence and reliability are knowledge about sources, so they are
declared **in-band** as ordinary attribute claims, no new syntax. The
subject is the source context's name under the `source/` entity prefix
(context `src:cli` ↔ entity `source/cli`; the bare entity `source` is
the root, covering every source and unstamped rows):

```cave
source/cli HAS precedence: 4              ; the built-in default ladder,
source/agent HAS precedence: 3            ; written out — declaring it
source/action HAS precedence: 3           ; is redundant
source HAS precedence: 2
source/rule HAS precedence: 1

source/scanner-a HAS reliability: 60%     ; discount one scanner
source/ingest HAS reliability: 80%        ; discount all LLM ingestion
```

**Matching is by path prefix, most specific declaration wins** — the
§9.4 "context" dimension made concrete: a context `src:agent/claude`
takes its reliability from `source/agent/claude` if declared, else
`source/agent`, else `source` (the root), else the built-in default.
Prefixes are whole `/`-separated segments; precedence and reliability
match independently (the most specific declaration *of each dimension*
applies).

**Built-in defaults** (overridable by declaring the same subject):

| Entity | Covers | Precedence |
|---|---|---|
| `source/cli` | `src:cli` — a human at the CLI (§9.5) | 4 |
| `source/agent` | `src:agent/*` — MCP client appends | 3 |
| `source/action` | `src:action/*` — governed writes (§25) | 3 |
| `source` (root) | every other source — content sources, `src:connect/*`, `src:ingest` — and rows with no source | 2 |
| `source/rule` | `src:rule/*` — derived claims (§24) | 1 |

No reliability is built in — absent declarations, every source weighs
`1` and candidates compare on raw confidence.

Declarations are ordinary claims: they evolve append-only, retract with
`@ 0%` (falling back to the next-most-specific match), and are stamped
with their appending actor (§9.5). **Policy claims themselves resolve
under the built-in ladder alone** — bootstrapping must end somewhere,
and this is where: when two actors declare `source/ingest HAS
precedence:` differently, the built-in classes of *their* sources
decide (a `@src:cli` declaration beats a `@src:ingest` one), then
confidence, then tx. An ingested document can therefore never elevate
its own batch above the humans and agents it is answerable to, unless
nothing above its tier has spoken. Reliability values accept `N%` or
`0..1`; declarations whose value does not parse as a number in range —
or whose precedence is not a number — are ignored.

One §9.5 caveat carries over honestly: provenance is *claimed*, not
proven — the explicit-context supersede path (writing into another
actor's series by naming its `src:` context) also lands in that
series' precedence class. The history records exactly who wrote what;
resolution trusts the recorded contexts.

### 26.4 Surfaces

- `cave query --resolve` / `query(store, pattern, { resolve: true })` /
  the MCP `cave_query` tool's `resolve` parameter: the pattern matches
  over resolved winners instead of all current beliefs. A positive
  pattern whose fact resolved to a negated winner matches nothing — the
  overridden assertion is invisible, which is the §9.4 payoff.
  Composes with `aliases` (groups widen through the closure, §26.1) and
  `asOf` (candidates, policy declarations and the closure all
  reconstruct at the boundary, §12.3); incompatible with `all`, which
  asks for the unresolved history.
- Store traversal (`forward`, `reverse`, topic reads) and the MCP
  `cave_about` / `cave_neighbors` tools accept the same `resolve`
  opt-in.
- `store.resolvedBeliefs()` — the winners, one row per group;
  `store.contested()` — groups where more than one candidate spoke,
  each candidate scored (class, effective confidence) and ranked, the
  fusion feed (§10.1 fuses a contested group's numeric estimates
  instead of picking);
  `store.resolutionPolicy()` — the effective merged policy entries.
- `cave resolve` — the human view of the same: contested facts with
  their ranked candidates, `--policy` for the effective policy table.

In SQL terms, resolution is one window over §13.5's current-belief
query — rank per group by class, effective confidence, tx — with the
group key computed from `claim_key` (drop the negation element, filter
`src:` members from the context array) and the class/reliability of a
row looked up by longest-prefix match over the declared-or-built-in
entries. Retraction, negation and §12 filters then apply to the
surviving winners exactly as they always did.

---

## 27. Alias Discovery

§13.6 made merge and unmerge one-line appends; this section covers
*finding* the pairs worth merging. Under LLM extraction the same person
arrives as `maria`, `grandma-maria` and `Grandma_Maria` across batches —
naming drift makes discovery, not merge mechanics, the entity-resolution
bottleneck. Alias discovery is a **read** that proposes: it scores
same-entity candidates by deterministic, explainable signals and emits
*suggested* `ALIAS` claims at low confidence for review. It never merges
anything itself, and it never re-opens a pair somebody decided.

### 27.1 Candidates — who can be suggested

Candidates are entity names appearing in current believed claims
(subject or relation-object position). Never candidates:

- verb tokens and literals — not entities (§13.6 carries the same rule);
- system entities under `rule/`, `action/`, `source/` and `connect/`
  (§24–§26, §23) and ingestion bookkeeping records (subjects carrying
  `ingest-digest:`) — infrastructure, and digest-shaped names are
  string-similar by construction.

A pair is **excluded** — whatever the evidence — when:

- any `ALIAS` row between the two names exists in the history, in either
  direction and whatever its current state: positive (already merged),
  negated (rejected) or retracted (deliberately unmerged). Review
  decisions stick; re-runs never nag.
- both names are already in one §13.6 closure group (transitively
  merged);
- a current claim relates the two directly (`a CALLS b`) — a claim
  relating two names treats them as distinct entities;
- one name is a scope prefix of the other (`auth` vs `auth/middleware`)
  — a scope parent names a scope, not an alias.

### 27.2 Evidence — signals and score

Two signal families. **Generating** signals make a pair a candidate;
the strongest one is the base score:

| Signal | Score | Example |
|---|---|---|
| names equal ignoring case and separators | 1.0 | `Long-Street` / `long_street` |
| same name segments, reordered | 0.9 | `maria-grandma` / `grandma-maria` |
| one segment set inside the other (shorter ≥ 3 chars) | 0.7 | `maria` / `grandma-maria` |
| one normalized name prefixes the other (shorter ≥ 4) | length ratio | `postgres` / `postgresql` → 0.8 |
| edit similarity ≥ 0.75 (shorter ≥ 5) | similarity | `anlytics` / `analytics` → 0.89 |
| a shared **rare textual** attribute value | 0.8 | both `HAS orcid: 0000-0002-1825` |

Guards keep the signals honest: names differing **only in digits**
(`api-v1` / `api-v2`) are versions, not drift — no prefix or edit
signal; edit similarity requires the *differing segments* themselves to
be spelling variants, so `grandma-mria` drifts but `north-tower` /
`south-tower` (a differing word) does not; a shared value identifies
only when it is textual (numeric values never do — two towers with the
same height are not one tower), at least 4 characters, and carried by
**exactly the two candidates** — a value shared more widely is a common
category value (`status: active`), not an identity.

**Boosting** signals strengthen a candidate but never create one:
each shared relation neighbor — same verb, same other end, same side —
adds 0.1 (at most 0.2). Topology alone must not suggest: siblings share
both parents without being one person.

The pair's score is the strongest generating signal plus boosts, capped
at 1; pairs below the threshold (default **0.6**) are dropped.

### 27.3 The suggested claim

A suggestion is emitted as an ordinary `ALIAS` claim — no new syntax:

```cave
grandma-maria ALIAS maria #suggested @ 35% ; segments of maria within grandma-maria
```

- Direction is a readability convention, not a semantic (§13.6 reads
  `ALIAS` undirected): the better-established name — more current rows,
  then the shorter, then lexicographic — is the object.
- **Confidence is half the score**, clamped to 0.3–0.5: a suggestion is
  a question, not an answer — never above 50%, and always inside the
  §20.2 review band, so `cave check` surfaces pending suggestions.
- The `#suggested` tag finds them (`byTag`, §13.5); the comment carries
  the evidence.

Discovery **emits text by default** — review it, edit it, pipe it into
`cave add`. Opting into writing (`--write`) appends the suggestions
stamped `@src:suggest/alias` (§9.5; root precedence class under §26.3 —
declare `source/suggest HAS precedence:` to move the tier). A written
pair has `ALIAS` history, so re-runs append nothing.

One consequence stated honestly: a written suggestion is a current
positive claim, and the §13.6 closure links on any positive confidence —
belief is graded, and an opted-in `aliases` read honors a 35% link
exactly as it honors a 100% one. Review is therefore part of the
workflow, and both moves are one append:

- **confirm** — assert the link yourself: `dupe ALIAS canonical`
  (lands in the reviewer's own series, at full confidence);
- **reject** — retract the *suggestion's* series:
  `dupe ALIAS canonical @src:suggest/alias @ 0%`. Contexts are part of
  claim identity (§9.2), so a plain `@ 0%` append would start a new
  series and leave the suggested link standing — rejection must name
  the suggestion's source context (§9.5's explicit-context supersede
  path). Either way the pair stays decided and is never re-suggested.

### 27.4 The judge — optional, out-of-band

An LLM can filter candidates before a human sees them. Per §19.5 the
model stays outside the language and the engine: the judge is a shell
agent template (the `cave ingest` / `cave eval` `--agent` contract —
prompt on stdin and `{prompt-file}`, reply on stdout). The prompt shows
every suggestion with its evidence and each side's current claims; the
reply is one JSON array of the suggestion numbers that really are the
same entity (`[1, 3]`; `[]` for none). Replies parse leniently — the
last well-formed array wins, out-of-range and duplicate entries drop —
but agent *errors* propagate as failures. The judge filters; it never
raises a confidence and never writes.

### 27.5 Surfaces

- `cave suggest-alias [--min <score>] [--limit <n>] [--agent <template>]
  [--write] [--json]` — suggestions as CAVE text (default), JSON with
  scores and signals, or appended claims;
- `suggestAliases(store, { minScore?, limit? })`, `writeSuggestions`,
  `judgePrompt` / `parseJudgeReply` — the same engine programmatically
  (`@cavelang/shape`, beside the §20 health checks it feeds).

---

## 28. Store Merge

Everything so far assumes one store. Knowledge does not: two machines,
a laptop and a server, a store and its air-gapped copy each accumulate
claims, and eventually one must absorb the other. §9.4 already made the
hard part legal — coexisting contradictions are data, resolved at read
time (§26) — so merging can never *conflict*. What was left open (the
spec §28's central decision is transaction semantics across stores: what
happens to `tx`, and how identity survives the trip. This section
decides both.

### 28.1 Row identity — the id travels

Every appended row is minted one UUIDv7 serving as both `id` and `tx`
(§13.1). That value is the row's **global identity**: merging copies
rows that are absent *by id* — verbatim, keeping `id`, `tx`,
`claim_key`, `raw_line` and the side tables byte for byte — and skips
rows whose id the target already has.

Everything else follows from identity preservation:

- **idempotent** — re-running a sync merges nothing;
- **transitive** — after `b` absorbs `c`, syncing `b` into `a` carries
  `c`'s rows under their original identity, and a later direct
  `c → a` sync finds them present;
- **bidirectional** — `a ← b` then `b ← a` converges both stores to the
  same row set (each keeps its own bookkeeping series, §28.3);
- **conflict-free by construction** — the same fact recorded
  independently on both machines arrives as two rows in one belief
  series (two ids, one claim key): asserted twice, which is what
  happened. Nothing is rewritten; §26 resolution and §10.1 fusion apply
  at read time exactly as within one store.

Rows are never re-stamped on merge — re-minting ids would fork identity
and break all four properties (re-syncs would duplicate every row).
Actor provenance is likewise untouched: merge is interchange replay, so
the §9.5 no-stamp rule applies. Per-row *machine* attribution is
deliberately not recorded — `src:` stamps answer *who* asserted a
claim, which is the dimension resolution ranks (§26.2); when machine
identity matters, give each machine its own actor name (`cave mcp
--src agent/laptop`, per-machine `source/<name>` policy claims) and it
becomes ordinary provenance, ranked by the ordinary policy.

### 28.2 The receive rule — the store is the monotonic authority

§9.1's model assumes a single writer whose transaction ids only grow.
Merged rows carry origin timestamps, so a store that just absorbed a
fast-clocked machine holds rows *ahead* of its own wall clock — and a
naive next append would sort **before** them, silently losing currency
to the merged past. The fix generalizes §9.1's invariant from the
writer to the store:

> **Every append to a store receives a tx greater than every tx already
> in it.**

Implementations MUST apply the Lamport receive rule to the UUIDv7
generator: opening a store observes its `MAX(tx)`, merging observes the
maximum merged tx, and the generator never mints below what it has
observed (same-millisecond appends increment the v7 sequence field).
Consequences, stated honestly:

- **local appends always win locally** — anything appended after a
  merge is newer than everything merged, whatever the origin clocks
  did;
- **merged history interleaves by origin wall clock** — within one
  belief series (same claim key, e.g. the same actor writing on two
  machines), the merged past orders by origin timestamps, and clock
  skew between machines skews that ordering. Cross-machine recency is
  physical time, not causality; where trust should outrank recency,
  that is precedence (§26.2), not tx;
- **tx drifts ahead of the wall clock only under skew** — after
  absorbing a future-stamped row, new appends mint just above it until
  real time catches up. Staleness measures (§20.2) read such rows as
  fresh; acceptable, bounded by the skew.

### 28.3 The merge record — sync events are claims

A merge that changed anything is knowledge, recorded in-band as an
ordinary claim in the *target* store (the verb declared on first use,
like every extension verb):

```cave
SYNCED-INTO IS verb ; an origin store's rows were merged into a target store
store/laptop SYNCED-INTO store/main @src:sync ; +42 claim(s), +17 edge(s)
```

Store labels are supplied by the caller (defaulting to file basenames):
CAVE stores have no intrinsic identity, and the label names the
*relationship*, not a machine — one claim key per (origin, target)
pair, whose belief series is the sync log (each effective merge appends
one row; tx answers *when*, the comment carries the batch counts). The
record is stamped `@src:sync` (§9.5, root precedence class under
§26.3). A sync that merged nothing appends nothing — the §24.4
idempotency convention; watch loops never accrete records.

### 28.4 Interchange — transaction annotations

Canonical text (§2.2) deliberately omits `tx`: interchange replay mints
fresh ids, which is right for restoring and wrong for merging. The
**transaction annotation** is the additive extension that lets text
carry identity — a full-line comment immediately above each claim line,
at the same indentation:

```cave
;@ 01980a5e-4c2d-7000-8a3f-2b1c9d4e5f60
auth USES jwt @ 90% @src:cli
  ;@ 01980a5e-4c2e-7000-b7d2-8e3a1f6c9b04
  BECAUSE security-review
```

`cave export --tx` emits annotations for its §9.7-selected rows;
`--max-sensitivity restricted` makes that selection complete. `cave sync`
consumes the text, replaying each
annotated claim under its recorded id — present ids skip, absent ids
insert, exactly §28.1 over text. Because comment lines are transparent
to the grammar (§8), every existing consumer reads an annotated file
unchanged, and plain `cave import` degrades gracefully to an ordinary
tx-less replay. The extension is honest about its strictness the other
way: `cave sync` of a text source requires **every** claim line
annotated with a well-formed UUIDv7 — a half-annotated file would merge
half a store idempotently and duplicate the rest on every re-run, so it
is rejected whole (use `cave import` for plain text).

Edges form a graph; text forms a tree. The reconciliation is the
**re-statement**: the emitter renders a row's own children exactly once
— at its first appearance — and every further appearance (a premise row
cited by several derivations, the `VIA` rule row every derivation of
one rule shares, §24.3; a §24.5 support cycle, which has no top-level
member at all) is the claim line alone under the citing parent,
carrying that one edge and the same `;@` id. On replay a repeated id
whose content matches is the same row re-stated — it unions back into
one row (the §28.1 rule applied within a file), each statement
contributing its edge — while a repeated id with *different* content
forks identity and rejects the file whole. Under plain `cave import`
a re-statement degrades to the same claim asserted twice: two rows in
one belief series, which §9.4 already makes legal.

A `--current` export with `--tx` is a *seed*: a snapshot whose rows
keep their identity, so a store grown from it merges back into the
original without duplication — the branching convention's (§28.6)
opening move for a working copy that doesn't need the past.

### 28.5 Surfaces

- `cave sync [--db <target>] <source> [--as <label>] [--into <label>]
  [--dry-run] [--no-record] [--json]` — `<source>` is a CAVE store file
  (detected by SQLite header), a `;@`-annotated canonical text file, or
  `-` for annotated text on stdin. `--as`/`--into` override the origin
  and target labels in the §28.3 record; `--no-record` suppresses it;
  `--dry-run` computes the full report inside a rolled-back
  transaction.
- `cave export --tx [--current] [--max-sensitivity <level>]` — §28.4
  annotated canonical text. Exact replicas require `restricted`.
- Programmatic: `@cavelang/sync` — `syncDb(store, path, options)`,
  `syncText(store, text, options)`, both returning
  `{ merged, skipped, edges, record }`.
- Sync is an operator command, deliberately not served over MCP: store
  files are machine-local paths, and distribution is the operator's
  concern — an agent's write surface stays the governed §25 vocabulary.

Merging with the query layer: nothing changes. Current belief stays
`MAX(tx)` per key (§13.5), as-of reconstruction works across merged
history (§12.3, boundaries compare origin timestamps), and resolution
(§26) arbitrates cross-actor contests exactly as before — the policy,
not the merge, decides who outranks whom.

### 28.6 The branching convention (non-normative)

§28.1–§28.4 are mechanics; this section is the workflow they compose
into — how a store branches, gets reviewed, and merges, with git doing
what git already does. Nothing here adds semantics or surface; it
fixes the moves so tooling and habits agree.

**The text is the store.** What enters version control is the full
annotated export — `cave export --tx --max-sensitivity restricted > knowledge.cave` — never the
SQLite file. The §28.4 round trip is complete (rows, contexts, tags,
edges, in-band declarations, transaction identity), so the committed
text *is* a replica: anyone rebuilds a working store from it with one
sync into a fresh file. The file is generated — regenerate it before
every commit, never edit it by hand.

**A branch is a git branch plus a private store file.** Opening one
is a checkout, not a merge event, so rebuild with `--no-record` —
plumbing appends no bookkeeping:

```sh
git switch -c reorg-auth
cave sync --db work.db knowledge.cave --no-record
```

(`cave export --tx --current --max-sensitivity restricted` seeds a *lighter* working copy —
current beliefs only, history left behind — when the branch doesn't
need the past; it merges back identically.) Work is then ordinary
appends — `cave add`, `cave derive`, `cave act` — and the §28.2
receive rule guarantees everything appended on the branch outsorts
everything seeded, whatever machine the seed came from.

**Review is the diff of the export.** Re-export before committing —
`cave export --db work.db --tx --max-sensitivity restricted > knowledge.cave` — and the PR diff is
the appended claims, annotations included: claim rows are immutable
and export order is transaction order, so a later export never
rewrites or reorders the lines an earlier one contained. One
presentational exception, stated honestly: §24.3 lineage rendering
nests a premise line under the first conclusion that cites it, so a
derivation *moves* the lines it consumed into its indented block —
verbatim, annotation and all (further citations only add §28.4
re-statements) — and the diff shows that move.

**Merge is union; conflicts dissolve.** A *knowledge* merge can never
conflict: rows union by identity (§28.1), contradictory claims
legally coexist (§9.4) and resolve at read time (§26). A *text* merge
can — two branches appending at the file's end collide in git. Never
hand-merge the export; rebuild it as the union the two texts already
are:

```sh
t=$(mktemp -d)
cave sync --db $t/m.db ours.cave --no-record
cave sync --db $t/m.db theirs.cave --no-record
cave export --db $t/m.db --tx --max-sensitivity restricted --out knowledge.cave
```

Git can run that as a merge driver (`.gitattributes`:
`*.cave merge=cave`):

```ini
[merge "cave"]
	name = CAVE store union
	driver = sh -euc 't=$(mktemp -d) && cave sync --db $t/m.db $1 --no-record >/dev/null && cave sync --db $t/m.db $2 --no-record >/dev/null && cave export --db $t/m.db --tx --max-sensitivity restricted --out $1 && rm -rf $t' - %A %B
```

The ancestor (`%O`) is deliberately unused: union by identity needs
no three-way — full annotated exports never lose a row; a line only
ever gains siblings or moves into the block that first cites it.

**Landing is a sync.** After the PR merges, any live store absorbs
the merged text — `cave sync --db main.db knowledge.cave --as
reorg-auth` — present rows skip, the branch's appends arrive, and
this one *is* a merge event: let it record (§28.3); the sync log is
the distribution history. Refreshing a stale branch is the same move
pointed the other way, as a checkout: `git show
origin/main:knowledge.cave | cave sync --db work.db - --no-record`,
then re-export.

**Costs, stated honestly.** A branch is a full copy of the store —
no shared structure, no copy-on-write; a thousand cheap branches is a
git workflow, not a CAVE one. Divergence between the committed text
and anyone's live store is bounded by the next sync, not prevented.
Both are the right trade at CAVE's scale: one machine, one SQLite
file, plain text as the escape hatch.

---

## 29. Automations — the Event-Driven Loop

Every kinetic surface so far waits to be invoked: rules fire when
`cave derive` runs (§24), actions when a caller executes them (§25),
`cave connect --watch` re-maps when a *file* changes (§23). Nothing
watches the *store*. This section commits **automations**: in-band
declarations that pair a trigger pattern with named steps, and
`cave automate`, the loop that evaluates them whenever belief changes —
new claims matching patterns fire rules, actions, out-of-band hooks, or
an agent prompt. With `connect --watch` feeding one end, sense → model →
conclude → act → record closes on one machine, unattended.

### 29.1 The automation declaration

An automation is declared exactly like a rule (§24.1) and named exactly
like an action (§25.1) — one ordinary attribute claim under a stable
name, whose value is the **body**:

```cave
automation/page-on-spike HAS automation: `?svc IS service, ?svc HAS error-rate: ?r, ?r > 0.05 => action/open-incident, hook/page, "error rate reached ?r on ?svc — investigate and record findings"` ; page and investigate error-rate spikes
```

The body reuses the §24.1 rule line — `left => right`, `=>` the only
special token, split outside `"…"` and `` `…` `` literals:

- the **left side is the trigger**: §24.1 premises verbatim — CAVE-Q
  patterns (inverse verbs, `VERB+`, `NOT` matching explicitly negated
  claims — still no negation-as-failure, `@ctx` / `#tag` filters) and
  `?var op value` constraints. At least one pattern premise is
  required, and — unlike an action — a bare-variable segment is an
  error: an automation has no caller, so every binding comes from the
  trigger;
- the **right side is a comma-separated list** of one or more
  **steps**, each one of
  - `action/<name>` — execute the §25 action, its parameters bound
    from same-named trigger variables;
  - `hook/<name>` — fire the out-of-band hook `<name>` from the same
    §25.4 configuration actions use;
  - a `"…"` or `` `…` `` literal — an **agent prompt template**, fired
    through an out-of-band shell-agent command (§29.3).

Like rule text and action bodies, an automation body is pure data —
patterns, names and prose, never commands (§19.5): the hook *commands*
and the agent *command* live in configuration; the claim only ever
names or phrases what to run. Identity is the *name* (§25.1's rule):
redeclaring appends to the same claim key, the newest current row
across actor series is the definition, retraction (`… @ 0%`) disables
the automation, and the declaration comment is its description.

### 29.2 Triggering — solutions citing event rows

The trigger evaluates exactly as rules and actions do: premises join
left to right over **current, positive, non-retracted** beliefs
(§24.2's join; the alias closure applies when opted in). What makes an
automation *event-driven* is one extra test — a solution **fires** only
when it cites at least one **event row**: a premise row newer than the
automation's **watermark**, excluding

- engine bookkeeping and declaration plumbing — rows carrying a
  `src:cave-automate`, `src:cave-derive` or `src:cave-act` context —
  which would otherwise wake automations forever (a watermark append
  must not be an event); and
- the automation's **own output** — rows stamped
  `src:automation/<name>` (its agent replies, §29.3) or
  `src:action/<x>` for any `action/<x>` among its steps (its own
  effects). An automation is deaf to its own echo; *another*
  automation's output triggers normally, which is how automations
  chain.

The watermark is an in-band bookkeeping claim, the §24.4 convention:

```cave
automation/page-on-spike HAS automate-watermark: 019f47ba-8f72-7000-… @src:cave-automate ; fired 1 solution(s), 3 step(s)
```

An automation arms at **the later of its stored watermark and its
current declaration row's transaction**: it watches from the moment
it is declared, whether or not a loop was running — rows recorded
before the declaration are state, never events. The declaration floor
is what keeps that rule true across re-declaration: retracting an
automation leaves its watermark claim current, and trusting that
stale mark would fire the re-declared automation once over every row
recorded while it was retracted. This is §24.4's staleness rule
pointed the other way — a re-declared rule re-fires over pre-existing
rows, a re-declared automation must not. Because matching is over
current beliefs, the semantics follow §12 throughout: a retraction fires
nothing (the fact stops matching), an unchanged re-assertion appends
no row and so fires nothing, a value update fires (the new row is the
current row), and a solution built entirely from old rows is state,
not an event. A transitive (`VERB+`) premise cites its **supporting
edge rows** — the current positive edges of its verb on some path
between the matched endpoints — so a new, re-asserted or updated edge
is an event exactly for the solutions whose connection it backs, with
the exclusions above applied per edge row. Only edge rows are support:
under the alias closure a new `ALIAS` row widens matching but is not
itself an event. Rules are unchanged (§24.2: no confidence, no lineage
edge from transitive premises — automations account for their events,
derivations for their evidence).

### 29.3 Firing — the watermark first, then the steps

When at least one solution fires, the automation records the batch
**before acting on it**: one watermark append (value = the highest
transaction the evaluation could see; the comment carries the counts,
so the watermark series is the firing log), then every step runs for
each firing solution, in declaration order. The ordering is the §25.4
asymmetry pointed the other way, stated honestly: a crash between the
two loses that batch's outside-world steps instead of replaying them —
re-runs must never re-notify the world, and the store never lies about
what it accounted for. Step failures are reported (nonzero exit under
`--once`), never fatal to the loop, and never roll back the watermark
or other steps.

- **`action/<name>`** executes the action under §25.2 semantics,
  verbatim: arguments are the action's declared parameters bound from
  same-named trigger variables (a parameter the trigger did not bind
  fails the step); the action's own premises still gate; the §25.3
  shape gate applies by default; effects are idempotent; the action's
  own `HAS hook:` fires per §25.4. Nothing is bypassed — an automation
  is just an unattended caller.
- **`hook/<name>`** runs the named command template from the §25.4
  hook configuration: `{automation}` and `{<var>}` placeholders
  substitute shell-quoted (trigger bindings; unknown placeholders
  stay), and the solution's premise rows arrive as canonical CAVE text
  on stdin. A hook that is named but not configured is reported as not
  fired — running without hook configuration is a legitimate,
  side-effect-free mode (§25.4).
- **a prompt literal** goes to the agent: bound `?var`s substitute
  into the template (unbound `?tokens` pass through — prompts are
  prose), and the engine wraps it with the automation's name and
  description, the solution's premise rows as canonical CAVE, and
  reply instructions. The agent is an out-of-band shell command — the
  `cave ingest` / `cave eval` `--agent` contract (§19.5): prompt on
  stdin and `{prompt-file}`, reply on stdout. The reply parses
  leniently as CAVE and appends stamped `@src:automation/<name>`, with
  the §24.4 idempotency convention applied per claim: a reply claim
  equal to its current belief appends nothing, so an agent restating
  its trigger cannot wake anything twice. No agent configured → the
  step is reported as not fired; agent errors are step failures.

### 29.4 The settle cycle

One **cycle** runs passes until no automation fires (a `maxPasses`
guard bounds runaways, §24.2's convention). Each pass first fires the
store's rules — §24 derivation, incremental by its own watermarks, so
a pass over an unchanged store costs almost nothing (`--no-derive`
opts out) — then evaluates every current automation. Steps append; the
next pass sees those rows; derived conclusions trigger automations and
action effects trigger other automations. Chains converge because
every write path is idempotent — derivation (§24.4), action effects
(§25.2), the agent-reply guard (§29.3) — so belief stops changing
unless something genuinely new keeps arriving; a pair of automations
whose agents keep answering each other with fresh values is a design
error the pass guard bounds per cycle, stated honestly, not prevented.

### 29.5 Surfaces

- `cave automate [--db <path>]` — the long-running loop: one settle
  cycle at startup, then a cheap `MAX(tx)` poll every `--interval`
  seconds (default 2) and a cycle whenever it moves. A cycle captures
  its boundary *before* settling and re-settles until `MAX(tx)` is
  unchanged across one, so a write landing mid-cycle is processed by
  that cycle, never marked seen unprocessed. One machine, one SQLite
  file — polling, not a bus, stated honestly.
- `cave automate --once` — exactly one settle cycle, exit code
  carrying step failures and declaration problems: cron replaces the
  daemon.
- `--declare [file…]` / `--list` / `--retract <name>` — the §25.1
  lifecycle moves (non-declaration lines are prelude); declarations
  are stamped `@src:cave-automate`.
- `--hooks <file>` / `$CAVE_HOOKS` (§25.4, shared with actions),
  `--agent <template>` + `--timeout` (the shell contract), `--aliases`
  (§13.6 on premise matching), `--no-derive`, `--no-check` (forwarded
  to action steps, §25.3), `--max-passes`, `--json`.
- Programmatic: `@cavelang/automate` — `declareAutomations`,
  `listAutomations`, `retractAutomation`, `settle(store, options)`
  (one cycle, full report).
- Deliberately **not** an MCP tool (§28.5's reasoning): the loop is a
  process the operator runs, not a call an agent makes. The
  *declarations*, though, are ordinary claims — an agent declares an
  automation through `cave_add`, and a running loop serves it from the
  next cycle without restarting.

## 30. The Human Read Surface (non-normative)

Everything before this section serves programs: CAVE-Q answers
patterns, MCP serves agents, `cave export` emits text. Nothing lets a
person *look at* the graph. This section commits `cave serve` — one
static, self-contained HTML page over the store, strictly read-only —
and, being a convenience surface, it is non-normative throughout: every
semantic it renders is defined elsewhere (§9, §11–§13, §20, §24), and
the view never reinterprets them. What it does promise is trust
properties: read-only, local, self-contained.

### 30.1 One page, no dependencies

The page is a single HTML document with inline style and script — no
build step, no framework, no external script, stylesheet, font or
image, so it renders offline and a strict `Content-Security-Policy`
(`default-src 'none'`, connections to self only) is enforceable: the
browser can render the store but cannot call out anywhere. Claims
render from *structured* row data — the stored columns plus context and
tag side tables — never by re-parsing text, so no second grammar exists
to drift out of sync (§16's single-source stance); the stored
`raw_line` is shown where the authored text is itself the point. Every
entity name, claim key and row id links onward: the whole store is
reachable by clicking. Source contexts also expose §9.8's parsed source and
line range; HTTP(S) locations link to the cited fragment.

### 30.2 The views

- **Dashboard** — the §20.2 report rendered: coverage stats, then the
  frontier — shape violations, review candidates (conf 0.3–0.7), stale
  beliefs, alias disagreements — plus topics (subjects of current
  positive `CONTAINS` claims, §11.2) and the latest appends. The §17.6
  story on a screen: what is missing and what needs review, read from
  the graph itself.
- **Entity 360** — one name's current picture: its types (current
  positive `IS` objects), object-less facts (attributes, metrics, bare
  existence), relations in both directions — stored rows shown
  verbatim, with the declared inverse name annotated on the object side
  (§13.3) — topics, and the §13.6 alias closure on an explicit toggle
  (opt-in here because it is opt-in everywhere). Underneath, the
  activity feed: the newest rows about the name, superseded and
  retracted included.
- **Belief history** — one claim key's series (§9.1), oldest first,
  with per-row confidence, provenance and timestamps: the "stack of
  cards" as a timeline. The last row is current belief; retraction and
  supersession are visible instead of destroyed.
- **Lineage** — the §13.2 edge table walked both ways from one row:
  *cites* (outgoing `BECAUSE` premises, `VIA` rules, `WHEN`
  conditions — why this is believed, §24.3) and *cited by* (incoming
  edges — what depends on it). Edges form a graph and the render is a
  tree, reconciled exactly as §28.4 reconciles export: a row reached
  again re-states without children, so shared premises and §24.5
  support cycles terminate. The walk is depth-capped, and the cap is
  honest: a node whose further edges it cut off is marked *truncated*
  (never posing as a leaf), with the row's own lineage as the way to
  keep walking.
- **Search** — the store's FTS5 index (§13.1) over subjects, objects,
  values, comments and raw lines, newest first.

### 30.3 Surfaces and the read-only promise

- `cave serve [--db <path>] [--port <n>] [--host <a>]
  [--max-sensitivity <level>]` — serves until interrupted; the default port is
  2283 ("cave" on a phone keypad) and the §9.7 ceiling defaults to `internal`.
- The JSON the page reads is plain GET endpoints (`/api/overview`,
  `/api/entity?name=`, `/api/topic?name=`, `/api/history?key=`,
  `/api/lineage?id=`, `/api/search?q=`, with `&aliases=1` where the
  closure applies) — scriptable with `curl`, though CAVE-Q (§12) stays
  the query language; the endpoints only ever serve the §30.2 views.
- **Read-only, structurally**: only GET/HEAD are answered (anything
  else is 405) and no endpoint writes — recording knowledge stays with
  `cave add`, the MCP tools and the kinetic layer (§24, §25, §29).
  Every request reads the live store, so a running `cave automate`
  loop's appends show on the next refresh.
- **Local by default**: binds `127.0.0.1` — the store is one person's
  knowledge on one machine; `--host` widens deliberately, and what it
  shares is the selected §9.7 view, read-only. There is no authentication
  layer and none is planned (multi-tenant access control is a
  permanent non-goal) — wider serving belongs behind the operator's
  own transport.
- Programmatic: `@cavelang/view` — `serve(store, { maxSensitivity, ... })` plus the
  view models (`overview`, `entity`, `topic`, `history`, `lineage`,
  `search`) as plain functions over a store, no server needed.
- Deliberately **not** an MCP tool (§28.5's reasoning): agents read
  through `cave_query`/`cave_about`; the page is for the human outside
  the loop.

## 31. Reports — Cited Deliverables (non-normative)

`cave query` prints bindings; `cave export` prints claims; `cave serve`
(§30) renders the graph. None of them produces the thing knowledge work
actually ships: a *document* — a status report, an inventory, a briefing
— whose every stated fact can be traced back to the claim that supports
it. This section commits `cave report`: templated markdown rendered from
CAVE-Q results, with claim keys as citations. Like §30 it is a
convenience surface and non-normative throughout — every semantic it
renders is defined elsewhere (§9, §12, §13.6, §26) — but the template
contract below is fixed so templates stay portable.

### 31.1 The template

A report template is an ordinary markdown document. Two constructs bind
it to the store; everything else — headings, prose, tables, hand-written
footnotes, fenced code in any *other* language — passes through
verbatim. The template is a document, not knowledge: it lives out of
band as a file, like a §23 mapping or a hook configuration, never in the
store.

**A query block** is a fenced code block whose info string is `cave-q`:

````markdown
## Service ownership

```cave-q
?svc HAS owner: ?who
- **?svc** is owned by ?who [^?]
```
````

The block's first line is a CAVE-Q pattern (§12.1); immediately
following lines starting with `WHERE` are filters (§12.2); everything
after — leading blank lines dropped, the rest verbatim — is the
**fragment**, a markdown template rendered once per solution with each
`?var` replaced by that solution's binding (entities and values exactly
as stored). The rendered instances replace the block, joined line by
line, so a fragment shaped like a bullet renders a list, one shaped like
`| ?svc | ?who [^?] |` renders table rows under a hand-written header,
and one shaped like a paragraph (keep a trailing blank line) renders
prose. An unbound `?token` passes through untouched — fragments are
prose, the §29.3 convention — and a query with no solutions renders
nothing, which is the honest shape of an empty section (a frontier
report *wants* its violations block empty). A block with no fragment
renders the default one: each solution as `cave query` prints it —
bindings when the pattern has variables, the claim line otherwise —
as a cited bullet.

**An inline splice** is an inline code span `` `cave-q: <pattern>` ``
for the single value a sentence needs:

```markdown
Revenue reached `cave-q: OpenAI HAS revenue: ?v` in the latest belief.
```

The span follows Markdown's usual code-span rules, delimiter length
included — write `` ``cave-q: ?who HAS default: `null` `` `` when the
pattern itself carries a backtick code literal (and a span that merely
*quotes* the construct, `` `cave-q: …` `` inside longer delimiters,
stays literal). The pattern must bind **exactly one variable** and
match **exactly one solution**; the span is replaced by the bound value
followed by its citation. No match renders `*(no match)*`, several render
`*(ambiguous: N matches)*` — both are report problems (nonzero exit):
prose splices are deterministic or nothing, §25.2's principle. When
several sources contest the fact, ambiguity is working as intended —
resolution (§26) is the knob: `cave report --resolve` renders the
policy's winner.

### 31.2 Citations

Every rendered solution that matched a stored row cites it. The marker
is a markdown footnote reference — placed at the fragment's `[^?]`
placeholder when present, appended to the fragment's last line
otherwise (inline splices always append) — and the definitions land at
the end of the document, one per cited row, repeats sharing a number:

```markdown
[^c1]: `auth/middleware USES jwt @ 90% @src:cli` — 2026-07-01, claim
key `["e:auth/middleware","USES",0,"r:e:jwt",["src:cli"]]`
```

The definition is the row's **canonical line** (the §16 emitter over
the stored columns and side tables — exactly what `cave export` prints,
actor stamps included, so provenance a `raw_line` abbreviation would
hide stays visible; its code span widens its delimiter past any
backtick run the line carries), the tx **date** (when), and the
**claim key**
(§9.2) — the identity of the belief series, so a reader can pull the
full history behind any sentence (`cave query --all`, the §30
timeline) — followed by every §9.8 source-span location, linked for HTTP(S).
Labels are `c1, c2, …` in order of first citation, a
namespace hand-written footnotes won't collide with. Transitive
(`VERB+`) solutions carry no row (§24.2's rule) and cite nothing —
their `[^?]` placeholders are dropped.

### 31.3 Surfaces

- `cave report [--db <path>] [template.md …] [--out <file>]
  [--aliases] [--resolve] [--as-of <t>] [--at <t>]
  [--max-sensitivity <level>] [--no-prelude]` —
  stdin when no file; rendered markdown to stdout or `--out`. The query
  options are the §9.7/§12.3/§13.6/§26.4/§32.4 opt-ins, applied to every
  query in the template — resolution stays opt-in here exactly because
  it is opt-in everywhere (§26). Problems (unparseable queries, empty or ambiguous
  splices) are reported to stderr with template line numbers and exit 1;
  the rendered document still emits, problems marked in place.
- Programmatic: `report(store, template, options)` in `@cavelang/view`
  (the §30 package — the browsable surface and the printable one are
  one read layer) returning `{ markdown, problems }`.
- Deliberately **not** an MCP tool (§28.5's reasoning): templates are
  machine-local files, and an agent composing prose already reads
  through `cave_query` — the report is the *human's* reproducible
  deliverable: the template under version control, the store evolving,
  `cave report` re-rendering the document from current belief on
  demand.

---

## 32. Temporal Values — Trajectories and Valid Time

Everything before this section is anchored in **transaction time** —
when the store learned something (§9.1), reconstructable with `--as-of`
(§12.3). This section adds the other axis: **valid time** — when a
claim applies *in the world*. It commits the §17.5 **layer-2** subset of
the Draft temporal design (the layer-1 point observation `revenue IS
20B USD/yr @2025` was always ordinary CAVE): trajectory values with
linear interpolation, time-range contexts, and the `at` query anchor.
Layer 3 — `(t -> expr)` function values — stays Draft, gated as §17.5
demands.

No new context grammar: a time range is an ordinary context atom
(§6.1 already admits `.` in contexts), *interpreted* by the engine —
the same move as `REVERSE` (§5.5) and `EXPECTS` (§20.1), declarations
that are ordinary lines until a semantic pass reads them. The one
grammar addition is the trajectory value form (§16 `value`), exactly
the syntax §17.5 designed.

### 32.1 Time points name periods

A **time point** is a date-like atom naming a whole calendar period,
read as a UTC interval `[start, end)`:

| Point | Period |
|---|---|
| `2025` | the year |
| `2026-04` | the month |
| `2026-04-10` | the day |
| `2026-Q1` | the quarter (Jan–Mar) |
| `2026-H2` | the half (Jul–Dec) |
| `2026-W15` | the ISO week (weeks start Monday; week 1 contains Jan 4) |

Whole-period reading matches the `WHERE tx` interval semantics (§12.2)
and the `--as-of` boundary (§12.3): naming a period means all of it.
Out-of-calendar points (`2026-02-30`, `2026-13`) are not time points —
they stay opaque context text.

### 32.2 Time contexts — points and ranges

A context is a **time context** when its body — bare, or after a
`time:` prefix (§6.1) — is a time point or a **range**: two points
joined by `..`, either end omissible.

```cave
revenue IS 20B USD/yr @2025                     ; point (layer 1, unchanged)
alice WORKS-AT acme @2020..2023                 ; closed range
alice WORKS-AT initech @2024..                  ; open end: since 2024
cost IS 10B USD/yr @..2024                      ; open start: until end of 2024
db/query-time IS 5ms -> 800ms @2026-04-10..04-11
```

A range covers `[start(A), end(B))` — **whole periods at both ends**:
`@2020..2023` runs from 2020-01-01 through the last instant of 2023.
Consequently adjacent spans must not repeat the boundary period —
`@..2024` and `@2025..2026` and `@2027..` tile cleanly; `@..2025` and
`@2025..2026` overlap during 2025, and both claims apply then (§9.4
coexistence — legal, resolved by the reader). A closed range must be
non-empty: `2028..2025` is not a time context.

The end point of a closed range MAY abbreviate by dropping *leading*
numeric segments, inherited from the start point: `@2026-04-10..04-11`
and `@2026-04-10..11` both read as April 10th to the 11th. `Q`/`H`/`W`
points are always written in full (`@2026-Q1..2026-Q3`).

Time contexts are ordinary contexts everywhere else: stored in
`cave_context`, part of the claim key (§9.2), emitted verbatim. A
context that fails to parse as time is simply opaque — the
robust-extraction default (§1.6), never an error.

### 32.3 Trajectory values — `A -> B`

A **trajectory** is a value with two numeric endpoints and one unit —
"it was X, it'll be Y" (§17.5 layer 2):

```cave
revenue IS 20B -> 40B USD/yr @2025..2028
acme HAS headcount: 100 -> 400 @2025..2027
db/query-time IS 5ms -> 800ms @2026-04-10..04-11
```

Each endpoint is a number with an optional multiplier; the unit is
shared — glued per endpoint (`5ms -> 800ms`) or spaced after either
side (`20B -> 40B USD/yr`), and endpoints naming *different* units do
not form a trajectory (the text degrades to an atom, §1.6). `~`
prefixes the whole value. Trajectories appear in metric and attribute
payloads; claim keys exclude values (§9.2), so re-estimating a
trajectory under the same contexts appends to the same belief series —
`revenue IS 20B -> 60B USD/yr @2025..2028` supersedes, and `--as-of`
reconstructs the earlier estimate.

A trajectory **interpolates linearly** over the claim's single closed
range context, in real calendar time:

- endpoint values anchor at the **start instants** of the periods that
  name the range: `20B -> 40B @2025..2028` is 20B at 2025-01-01 and
  40B at 2028-01-01;
- between the anchors the value is linear in elapsed time;
- through the end period's tail the value **holds at the end value** —
  "40B *in* 2028" is true all of 2028;
- outside the range the claim does not apply at all (§32.4 filtering —
  the range is still a context like any other).

Interpolation requires exactly **one closed range** among the claim's
contexts: none, an open range, or several ranges mean the trajectory
stays textual — the claim still matches, nothing is evaluated. A
trajectory is deliberately **not one number**: `value_num` stays NULL
in storage (numeric `WHERE value` filters never match trajectories),
fusion (§10.1) skips them, and CAVE-Q value slots bind the stored text
unless an `at` anchor evaluates it. `value_unit` carries the shared
unit; `value_text` carries the form as written, which is what
re-parses on read — no schema change.

Step functions need no new machinery — they are consecutive scalar
claims with tiling range contexts (§17.5's layer-3 `Step` collapsed
into layer 1 + §32.2):

```cave
cost IS 10B USD/yr @..2024
cost IS 14B USD/yr @2025..2026
cost IS 18B USD/yr @2027..
```

### 32.4 The `at` anchor — valid-time queries

`at` anchors a query at an **instant**: a time point (read as its
*start* instant — `2026` is 2026-01-01T00:00:00Z; name a finer period
to anchor inside one) or a `T` timestamp, exact.

Two effects, in order:

1. **Filter.** A claim applies at the instant when it carries no time
   context (timeless knowledge — most claims), or when *any* of its
   time contexts covers it (a point covers its period, a range covers
   `[start(A), end(B))`, missing ends are unbounded). Claims whose
   time contexts all miss the instant are invisible — relational
   claims included: `alice WORKS-AT ?org` answers differently at
   `--at 2021` and `--at 2026`.
2. **Evaluate.** A matched claim whose value is a trajectory with one
   closed range interpolates at the instant (§32.3). The evaluated
   value surfaces alongside the match — and substitutes into
   value-slot variable bindings (`?n` in `acme HAS headcount: ?n`
   binds the interpolated `250`, not the stored text) — while the
   stored row is returned untouched. Metric `IS` values stay unbound
   by variables (§10.1); a payload-less pattern (`revenue IS`) reaches
   them, the evaluation riding the match.

`at` is orthogonal to `asOf` (§12.3): `asOf` picks which rows are
*believed* (transaction time), `at` picks *when in the world* the
claims apply (valid time). Set both for the bitemporal question —
"what did we believe on 2026-01-15 about 2028?" It composes with
`all`, `aliases` and `resolve` the same way — a row universe first,
then the valid-time pass. Transitive patterns (`VERB+`) reject `at`:
hop edges are not valid-time filtered, and a silently unfiltered
closure would be a wrong answer.

### 32.5 Surfaces

- `cave query <pattern> --at <t>` — filtered matches; interpolated
  trajectory rows print `; at <t>: <value>` after the canonical line,
  and value bindings carry the evaluated text.
- `query(store, pattern, { at })` — each match gains
  `at?: { num, unit?, text }` when its row evaluated; `text` is
  canonical value text in the trajectory's own style (multipliers
  re-compressed, glued units kept glued, 4 significant digits).
- The MCP `cave_query` tool's `at` parameter — same semantics, so
  agents ask time-anchored questions through the same governed surface.
- `cave report --at <t>` / `report(store, template, { at })` — every
  query in the template anchors, so one template renders "the plan as
  of mid-2026" or "the 2028 projection" from the same store (§31).
- An unparseable anchor is an error, not an empty result — `--at
  someday` fails loudly, mirroring the `--as-of` boundary rule
  (§12.3).
