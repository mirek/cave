---
name: cave-storage-query
description: CAVE persistence and query spec (§9, §12–§13) — append-only belief evolution, claim keys, retraction and contradiction, actor provenance stamping, CAVE-Q graph patterns and filters, SQLite schema (cave_claim/cave_context/cave_tag/cave_edge/FTS5), inverse-as-view storage, canonicalization pipeline, common SQL queries. Use when working on @cave/store, @cave/query, @cave/canonical, belief resolution, or writing SQL/CAVE-Q against a CAVE store.
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

CAVE stores knowledge; it does **not** require global consistency at write time. A query engine resolves current belief using latest transaction, source reliability, confidence, context, and explicit precedence rules.

### 9.5 Actor provenance

Transaction ids answer *when*; `raw_line` answers *as written*. Actor
provenance answers *who appended this*: append surfaces SHOULD stamp every
claim that carries no `src:`-prefixed context with a source context naming
the acting surface. Recommended forms:

| Surface | Stamp |
|---|---|
| interactive CLI (`cave add`) | `@src:cli` |
| MCP client append (`cave_add`) | `@src:agent/<client-name>` (from the MCP `initialize` handshake; `@src:agent` when unknown) |
| deterministic/orchestrated ingestion | `@src:ingest/<digest>` (content-derived, so identical re-runs stay key-stable) |

Rules:

- A claim that already names a source (any `src:` context, e.g. extraction
  anchors like `@src:path/to/file`) is never re-stamped — author-provided
  provenance wins.
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
  condition rows and in-band declarations (`REVERSE`, extension verbs) —
  which is what makes schema changes attributable and reviewable.

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
2. **If verb is an inverse: swap subject/object and substitute the primary verb (§5.5).**
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

Negated claims (`a ALIAS NOT b`) and retracted claims never link. The
closure is computed from **current** beliefs even when a query runs over
the full history — it is entity resolution as believed now. A recursive
CTE over the symmetrized edge set implements it:

```sql
WITH RECURSIVE alias_edge(a, b) AS (
  SELECT subject, object FROM current
  WHERE verb = 'ALIAS' AND negated = 0 AND conf > 0 AND object IS NOT NULL
  UNION
  SELECT object, subject FROM current
  WHERE verb = 'ALIAS' AND negated = 0 AND conf > 0 AND object IS NOT NULL
), alias_closure(name) AS (
  SELECT :entity
  UNION
  SELECT e.b FROM alias_closure s JOIN alias_edge e ON e.a = s.name
)
SELECT name FROM alias_closure;
```

The closure applies to entity positions only — values, attribute names
and verbs are not entities (verb lifecycle is a separate concern).
