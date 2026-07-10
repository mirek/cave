---
name: cave-storage-query
description: CAVE persistence and query spec (§9, §12–§13, §20, §24–§28) — append-only belief evolution, claim keys, retraction and contradiction, actor provenance stamping, CAVE-Q graph patterns and filters, as-of resolution (cave query --as-of), SQLite schema (cave_claim/cave_context/cave_tag/cave_edge/FTS5), inverse-as-view storage, canonicalization pipeline, common SQL queries, shape expectations and knowledge health (EXPECTS, cave check), rules and derivation (premises => conclusion, cave derive, BECAUSE/VIA lineage, watermark incrementality), actions (cave act, governed writes, parameters and preconditions, out-of-band hooks, generated MCP tools), contradiction resolution (precedence classes, source reliability, source/<name> policy claims, cave query --resolve, cave resolve), alias discovery (cave suggest-alias, suggested ALIAS claims, string/graph similarity signals, optional LLM judge), store merge (cave sync, row identity, the tx receive rule, SYNCED-INTO merge records, cave export --tx transaction annotations). Use when working on @cave/store, @cave/query, @cave/canonical, @cave/shape, @cave/rules, @cave/act, @cave/sync, belief resolution, or writing SQL/CAVE-Q against a CAVE store.
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

Surfaces: `cave derive`, and the MCP `cave_derive` tool (ROADMAP
item 12) with the same semantics (`dryRun`, `full`, `aliases`,
`minConf`, `maxPasses`). Rules are ordinary claims, so an agent declares
them through `cave_add` and fires them without leaving the protocol;
the tool writes, so a `--read-only` serving scope drops it.

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
   `@src:action/<name>` (§9.5; a template naming its own `src:` wins),
   `BECAUSE` edges to the premise rows of the justifying solution (the
   first, when several survive) and a `VIA` edge to the declaration
   row. Executions by different callers land in one belief series per
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
§9.4 "context" dimension made concrete: a context `src:ingest/93a0`
takes its reliability from `source/ingest/93a0` if declared, else
`source/ingest`, else `source` (the root), else the built-in default.
Prefixes are whole `/`-separated segments; precedence and reliability
match independently (the most specific declaration *of each dimension*
applies).

**Built-in defaults** (overridable by declaring the same subject):

| Entity | Covers | Precedence |
|---|---|---|
| `source/cli` | `src:cli` — a human at the CLI (§9.5) | 4 |
| `source/agent` | `src:agent/*` — MCP client appends | 3 |
| `source/action` | `src:action/*` — governed writes (§25) | 3 |
| `source` (root) | every other source — content sources, `src:connect/*`, `src:ingest/*` — and rows with no source | 2 |
| `source/rule` | `src:rule/*` — derived claims (§24) | 1 |

No reliability is built in — absent declarations, every source weighs
`1` and candidates compare on raw confidence.

Declarations are ordinary claims: they evolve append-only, retract with
`@ 0%` (falling back to the next-most-specific match), and are stamped
with their appending actor (§9.5). **Policy claims themselves resolve
under the built-in ladder alone** — bootstrapping must end somewhere,
and this is where: when two actors declare `source/ingest HAS
precedence:` differently, the built-in classes of *their* sources
decide (a `@src:cli` declaration beats a `@src:ingest/…` one), then
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
roadmap's open decision 1) is transaction semantics across stores: what
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

`cave export --tx` emits it; `cave sync` consumes it, replaying each
annotated claim under its recorded id — present ids skip, absent ids
insert, exactly §28.1 over text. Because comment lines are transparent
to the grammar (§8), every existing consumer reads an annotated file
unchanged, and plain `cave import` degrades gracefully to an ordinary
tx-less replay. The extension is honest about its strictness the other
way: `cave sync` of a text source requires **every** claim line
annotated with a well-formed UUIDv7 — a half-annotated file would merge
half a store idempotently and duplicate the rest on every re-run, so it
is rejected whole (use `cave import` for plain text).

A `--current` export with `--tx` is a *seed*: a snapshot whose rows
keep their identity, so a store grown from it merges back into the
original without duplication — the branch-and-merge workflow's opening
move.

### 28.5 Surfaces

- `cave sync [--db <target>] <source> [--as <label>] [--into <label>]
  [--dry-run] [--no-record] [--json]` — `<source>` is a CAVE store file
  (detected by SQLite header), a `;@`-annotated canonical text file, or
  `-` for annotated text on stdin. `--as`/`--into` override the origin
  and target labels in the §28.3 record; `--no-record` suppresses it;
  `--dry-run` computes the full report inside a rolled-back
  transaction.
- `cave export --tx [--current]` — §28.4 annotated canonical text.
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
