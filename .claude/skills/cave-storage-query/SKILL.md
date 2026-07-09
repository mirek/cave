---
name: cave-storage-query
description: CAVE persistence and query spec (§9, §12–§13, §20, §24) — append-only belief evolution, claim keys, retraction and contradiction, actor provenance stamping, CAVE-Q graph patterns and filters, as-of resolution (cave query --as-of), SQLite schema (cave_claim/cave_context/cave_tag/cave_edge/FTS5), inverse-as-view storage, canonicalization pipeline, common SQL queries, shape expectations and knowledge health (EXPECTS, cave check), rules and derivation (premises => conclusion, cave derive, BECAUSE/VIA lineage, watermark incrementality). Use when working on @cave/store, @cave/query, @cave/canonical, @cave/shape, @cave/rules, belief resolution, or writing SQL/CAVE-Q against a CAVE store.
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
| structured record mapping (`cave connect`) | `@src:connect/<name>/<key>` per record (§23.2) — record identity is what lets a changed record retract claims it no longer yields |

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
```

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
action preconditions (roadmap) reuse the identical mechanism — one
mechanism, two enforcement points.

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

### 24.3 What a derivation appends

A derived claim is an ordinary append with three §9/§13 obligations:

- **actor provenance** (§9.5): stamped `@src:rule/<digest>` (unless the
  conclusion template names its own `src:`), so a rule's output is one
  belief series per conclusion, separate from any hand-written series
  about the same fact — coexisting per §9.4, never silently overriding;
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
