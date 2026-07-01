# CAVE — Compressed Atomic Verb Expressions

## Consolidated System Specification — v3

**Status:** v3 consolidated. Supersedes the v0.1 draft (`CAVE_idea`) and the v0.2 design document (`CAVE-v2.md`) by merging both with the v3 additive delta (inverse relations, scoped tags, inverse-aware continuation, topic layer).

CAVE is a small, line-oriented language for persisting knowledge as composable, atomic claims. It is designed to be easy for humans and LLMs to write, easy to diff, easy to store in SQLite/Postgres, and formal enough to query as an information graph.

The core idea:

```cave
subject VERB object
```

Everything else is optional metadata on that claim.

---

## 0. How to Read This Document

Every section carries one of four statuses:

| Status | Meaning |
|---|---|
| **Normative** | The committed v3 language. Parsers MUST accept it; emitters MUST produce it. |
| **Legacy** | v0.1 forms. Parsers SHOULD accept them; emitters MUST NOT produce them. |
| **Draft** | The unified-grammar layer (variables, reification, rules, temporal values). Fully designed, not yet committed to the spec. Implementation-gated. |
| **Non-normative** | System context, rationale, rejected alternatives. Informs but does not constrain implementations. |

Unless marked otherwise, a section is **Normative**.

Keyword usage follows the usual convention: MUST / SHOULD / MAY.

---

## 1. Design Goals

CAVE is:

1. **Caveman-simple.** Short, direct, low ceremony. "Thing does thing to thing."
2. **Atomic.** One claim per line. Complex knowledge decomposes into small claims.
3. **Composable.** Claims qualify other claims; claims can be linked, grouped, updated, contradicted, or superseded.
4. **Queryable.** Every claim has a stable structure: subject, verb, object or attribute/value, negation, confidence, contexts, tags, transaction time.
5. **Persistent.** Append-only by default. New evidence creates new claims or new versions of old claims. History is preserved.
6. **LLM-friendly.** Robust under extraction from messy text; tolerates partial confidence, estimates, uncertainty, and comments.

A hard constraint across all versions: **no new core syntax unless the semantics strictly require it.** Where a feature can be built from the bootstrap verbs and existing conventions, it MUST be.

---

## 2. The Model

### 2.1 Claims

Every CAVE line denotes a **claim**:

```text
claim = ⟨ subject, verb, object-or-attribute/value, negated, metadata ⟩
```

Formally, c = ⟨s, v, o, n, m⟩ where m carries confidence, contexts, tags, value uncertainty, importance, comment, and transaction identity.

Claims are **immutable**. Belief changes by appending, never by mutating (§9).

### 2.2 Language layers

| Layer | Purpose | Example |
|---|---|---|
| **CAVE-Lite** | Bare triples | `auth USES jwt` |
| **CAVE-Core** | Triples plus metadata | `auth USES jwt @production #security @ 90%` |
| **CAVE-Full** | Qualified claims, uncertainty, continuation, versioning | indented `WHEN`, `+/-`, transactions, inverse reads |

The minimum valid line is `entity VERB object`.

### 2.3 One fact, possibly two names

v3's central structural addition: a relation may declare an **inverse name** (§5.5). A stored fact then has one canonical row but is readable — and writable — under either name. Forward and inverse readings share one claim key, one belief series, one row. Inverses are query-time views, never materialized (§13.3).

---

## 3. Syntax Reference

### 3.1 Canonical line shapes

Relational claim:

```cave
subject VERB [NOT] object [qualifiers] [; comment]
```

Attribute/value claim:

```cave
subject HAS attribute: value [+/- delta [(Nσ)]] [qualifiers] [; comment]
```

Metric claim:

```cave
metric IS value [+/- delta [(Nσ)]] [qualifiers] [; comment]
```

### 3.2 Full line anatomy

```text
subject VERB object +/- delta @context #tag @ 90% ! ; comment
│       │    │      │         │        │    │     │  │
│       │    │      │         │        │    │     │  └ persisted prose
│       │    │      │         │        │    │     └ importance marker
│       │    │      │         │        │    └ claim confidence (epistemic)
│       │    │      │         │        └ tag: flat #tag or scoped #key:value
│       │    │      │         └ scope/location/time/source
│       │    │      └ value uncertainty (aleatory, default 2σ)
│       │    └ the object (or attribute: value)
│       └ relationship (UPPERCASE)
└ the subject
```

All suffixes are optional and may repeat where noted (contexts, tags).

### 3.3 Core examples

```cave
jwt IS token-format
auth/middleware USES jwt
auth/middleware HAS bug: token-expiry #security
token-expiry CAUSE reject-valid-tokens
`<=` FIX token-expiry @auth.ts:42
server IS NOT compromised @ 90%
OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @2026-Q1 @ 90%
```

Composition:

```cave
server CAUSE crash @ 80%
  WHEN load > ~1000 req/s
  WHEN NOT cache/enabled
```

Continuation (v3, §8.3):

```cave
monorepo CONTAINS packages/api
  CONTAINS packages/web
  CONTAINS packages/core
  PART-OF org/monorepos
```

Persistence:

```cave
Anthropic HAS ipo-timing: 2026-H2 @ 40%
Anthropic HAS ipo-timing: 2026-H2 @ 65% ; updated after CFO statement
Anthropic HAS ipo-timing: 2026-H2 @ 35% ; updated after market downturn
```

### 3.4 The attribute/value colon

The v0.1 form `OpenAI HAS revenue 20B USD/yr` is ambiguous: is the object `revenue 20B USD/yr`, or is `revenue` an attribute with value `20B USD/yr`? For query execution this MUST be explicit. Canonical CAVE therefore uses `:`:

```cave
OpenAI HAS revenue: 20B USD/yr
pool HAS max: 20 conn
auth/key HAS expiry: 3600s
```

**Legacy:** parsers SHOULD accept the colonless form; emitters MUST output the colon form.

The colon binds attribute to value **only in payload position**. Colons never appear inside verbs (§19.1) — that is a rejected design.

---

## 4. Lexical Rules

### 4.1 Entities

Entities are compact names:

```cave
auth/middleware
auth/middleware/token-check
react/hooks/use-memo
PostgreSQL
Sarah
```

Rules:

- `/` for scope. At most 3 path segments: `domain/entity/aspect`.
- kebab-case within segments.
- Proper nouns keep casing: `PostgreSQL`, `React`, `OpenAI`.
- No pronouns — resolve "it", "this", "the component" to real entities.
- Same entity → same name everywhere.

Note the `/` non-ambiguity: `/` in an entity means scope (`auth/middleware`); `/` in a unit means "per" (`USD/yr`). Units follow numbers; entities do not.

### 4.2 Literals

Backticks for exact code-like values:

```cave
expiry-check USES `<`
expiry-check NEEDS `<=`
server LOGS `ECONNRESET`
```

Double quotes for natural-language literals:

```cave
step/1 IS "install dependencies"
step/2 IS "run migrations"
```

### 4.3 Reserved characters

Outside quotes and backticks:

| Token | Meaning |
|---|---|
| `;` | comment begins |
| `@ctx` | context (no space after `@`) |
| `@ 90%` | confidence (space after `@`, ends `%`) |
| `#tag` / `#key:value` | tag, flat or scoped |
| `+/-` | value uncertainty |
| `!` | important |
| `:` | attribute/value separator (payload); key/value separator (inside a tag) |
| `~` | approximate value prefix |

If an object must contain these literally, quote it or use backticks.

---

## 5. Verbs

### 5.1 Bootstrap verbs

CAVE can begin with only two primitives. Everything else — the standard set, extensions, inverse declarations — is defined on top of them.

| Verb | Meaning | Example |
|---|---|---|
| `IS` | type, state, identity-ish relation, scalar metric value | `jwt IS token-format` |
| `HAS` | property, attribute, possession, feature | `pool HAS max: 20 conn` |

For graph quality, use standard verbs when they fit.

### 5.2 Standard verbs

**Identity and taxonomy**

| Verb | Meaning | Example |
|---|---|---|
| `IS` | type or state | `server IS production` |
| `EXTENDS` | subclass, lineage, inheritance | `terrier EXTENDS dog` |
| `ALIAS` | same entity, equivalent name | `js ALIAS javascript` |
| `LIKE` | similar but not identical | `cave-lang LIKE toki-pona` |
| `EXISTS` | bare existence assertion | `memory-leak EXISTS @production` |

Prefer `ALIAS` over `IS` for true equivalence.

**Causation and change**

| Verb | Meaning | Direction | Example |
|---|---|---|---|
| `CAUSE` | cause produces effect | cause → effect | `memory-leak CAUSE oom` |
| `FIX` | fix resolves problem | fix → problem | `` `<=` FIX token-expiry `` |
| `BECOMES` | state transition | thing → new state | `server/status BECOMES degraded` |

Causal direction MUST run cause → effect. Prefer `memory-leak CAUSE app/crash` over the ambiguous `app CAUSE crash` (app causes a crash, or app crashes?).

**Dependency and production**

| Verb | Meaning | Example |
|---|---|---|
| `NEEDS` | requires | `deploy NEEDS docker` |
| `USES` | uses, consumes, employs | `auth/middleware USES jwt` |
| `YIELDS` | produces output | `build YIELDS dist/bundle.js` |
| `ENABLES` | makes possible | `index ENABLES fast-lookup` |
| `BLOCKS` | prevents | `deadlock BLOCKS db/writes` |

**Structure and ordering**

| Verb | Meaning | Example |
|---|---|---|
| `CONTAINS` | whole contains part | `monorepo CONTAINS packages/api` |
| `PRECEDES` | temporal or procedural order | `build PRECEDES deploy` |
| `EXCEEDS` | greater than | `revenue EXCEEDS costs` |
| `VS` | contrast, comparison, unresolved choice | `sql VS nosql` |

**Qualifier verbs** — usually appear indented under another claim (§8.2):

| Verb | Meaning | Example |
|---|---|---|
| `WHEN` | condition | `WHEN cache-miss` |
| `UNLESS` | negative condition | `UNLESS cache/enabled` |
| `VIA` | means or mechanism | `VIA github-actions` |
| `BECAUSE` | evidence or rationale | `BECAUSE heap-dump` |

Canonical CAVE prefers `WHEN NOT x` over `UNLESS x`; both are accepted.

### 5.3 Informative: RDF alignment

For interoperability. Non-normative; CAVE does not depend on RDF.

| CAVE | RDF/PROV/SKOS |
|---|---|
| `IS` | rdf:type |
| `EXTENDS` | rdfs:subClassOf |
| `ALIAS` | owl:sameAs |
| `LIKE` | skos:closeMatch |
| `BECOMES` | prov:wasRevisionOf |
| `YIELDS` | prov:generated |
| `NEEDS` | dcterms:requires |
| `USES` | prov:used |
| `CONTAINS` | dcterms:hasPart |
| `PRECEDES` | time:before |
| `VS` | skos:related |
| `VIA` | prov:wasAssociatedWith |

### 5.4 Extension verbs

If no standard verb fits, define a new one **in-band**, as ordinary claims on the bootstrap:

```cave
MIGRATES IS verb ; X moves data/system from old platform to new platform
MIGRATES HAS domain: data-platform
MIGRATES HAS direction: source-to-target
MIGRATES LIKE BECOMES
legacy-db MIGRATES postgres
```

Rules: uppercase verbs; keep extensions rare; prefer standard verbs. More than ~3 new verbs in one extraction signals over-specialization.

### 5.5 Inverse relations — `REVERSE`

**Motivation.** CAVE stores each claim once, in one direction: `monorepo CONTAINS packages/api`. Before v3, asking "what is `packages/api` part of?" forced an object-side SQL scan with no name for the reverse relation. v3 lets a verb declare its inverse, so the same stored edge is readable — and queryable — from both ends, **without storing a second row.**

**Declaration.** Inverses are declared in-band, as ordinary CAVE claims, exactly like extension verbs:

```cave
CONTAINS REVERSE PART-OF
CAUSE    REVERSE CAUSED-BY
PRECEDES REVERSE FOLLOWS
USES     REVERSE USED-BY
NEEDS    REVERSE NEEDED-BY
ENABLES  REVERSE ENABLED-BY
BLOCKS   REVERSE BLOCKED-BY
EXTENDS  REVERSE EXTENDED-BY
```

`REVERSE` is symmetric *as a declaration*: `A REVERSE B` means B is the inverse of A and vice versa. Declaring once in either direction suffices; redeclaring the mirror is a no-op. `REVERSE` itself is defined the way every extension verb is:

```cave
REVERSE IS verb ; declares that two verbs name the same edge read in opposite directions
REVERSE HAS arity: 2
```

No verb is born with an inverse. A relation without a `REVERSE` declaration simply has no reverse name; reverse reads fall back to pre-v3 behavior (object-side scan, relation un-named). Standard verbs SHOULD carry the declarations above; emitters MAY prepend them to a document or keep them in a shared prelude.

**Canonical direction.** Each inverse pair has one **primary** verb: the one on the **left** of the first `REVERSE` declaration. In `CONTAINS REVERSE PART-OF`, `CONTAINS` is primary.

On write, a line using the inverse verb is normalized to primary form **before** the claim key is computed:

```cave
packages/api PART-OF monorepo
```

normalizes to:

```text
subject  = monorepo
verb     = CONTAINS                              ; primary
object   = packages/api
raw_line = "packages/api PART-OF monorepo"       ; preserved exactly as written
```

This is a normalization pass in the same family as verb-uppercasing and entity-whitespace rules (§14). The human's original text survives in `raw_line`; the key is computed on the canonical form.

**Same fact, two names, one key.** Because the inverse normalizes to the primary before keying, a forward claim and its inverse share one `claim_key`. They are one fact. Consequences — all intended:

- **Belief tracking is unified.** Updating confidence through either direction appends to the *same* series; latest-tx-wins resolves across both names:

  ```cave
  packages/api PART-OF monorepo @ 50%       ; tx:001
  monorepo CONTAINS packages/api @ 90%      ; tx:002 — same claim_key, current belief = 90%
  ```

- **Negation rides the single row.** `server BLOCKS NOT db/writes` is one stored row with `negated = 1`; read in reverse it is `db/writes BLOCKED-BY NOT server`. No special handling.
- **Confidence is direction-free.** `a CAUSE b @ 70%` *is* `b CAUSED-BY a @ 70%` — literally the same row read backwards. `@ N%` is a property of the fact, not of the reading direction.

Storage consequences in §13.3.

### 5.6 `NOT` — universal verb modifier

`NOT` immediately after the verb negates any relation:

```cave
server IS NOT production
deploy NEEDS NOT downtime
feature EXISTS NOT @production
server IS NOT compromised @ 90%
```

`subject VERB NOT object` claims that the relation does not hold.

Critical distinction:

- `server IS NOT compromised @ 90%` — "90% confident the server is **not** compromised." Asserts a negative fact.
- `server IS compromised @ 0%` — "the positive claim has zero support / is considered false."

Related but not identical: the first is logical negation; the second assigns zero confidence to the positive claim (§9.4).


---

## 6. Metadata Qualifiers

Qualifiers attach to a claim:

```cave
entity VERB object +/- delta @context #tag @ 90% ! ; comment
```

| Syntax | Meaning | Example |
|---|---|---|
| `@context` | time, place, source, scope | `@production`, `@2026-Q1`, `@src:filing` |
| `#tag` | flat category | `#security` |
| `#key:value` | scoped tag (claim facet) | `#topic:auth-security` |
| `@ 90%` | claim confidence | `memory-leak CAUSE oom @ 70%` |
| `+/- delta` | value uncertainty | `revenue: 20B USD/yr +/- 2B USD/yr` |
| `(Nσ)` | σ level override | `+/- 2B USD/yr (1σ)` |
| `!` | important | `auth/key HAS expiry: 3600s !` |
| `; comment` | persisted prose | `; confirmed by heap dump` |

### 6.1 Context — `@ctx`

No space after `@`:

```cave
@production
@2026-Q1
@auth.ts:42
@src:cfo-statement
@region:eu
```

Recommended context prefixes:

| Prefix | Meaning | Example |
|---|---|---|
| `@src:` | source | `@src:annual-report` |
| `@time:` | event time | `@time:2026-04-06` |
| `@loc:` | location | `@loc:eu-west-1` |
| `@scope:` | logical scope | `@scope:production` |

Bare contexts are allowed: `memory-leak EXISTS @production`. Multiple contexts per claim are allowed.

The **episodic/semantic distinction stays implicit**: episodes are just claims with `@time:` / `@src:` contexts; semantic knowledge is claims without event anchoring. No explicit layering — a deliberate rejection of added machinery (§19.3).

### 6.2 Tags — flat and scoped

A tag is `#`, a key, and an optional `:value`:

```cave
vuln HAS severity: critical #security              ; flat tag  → key=security, value=NULL
token-expiry CAUSE reject #topic:auth-security     ; scoped    → key=topic, value=auth-security
deploy NEEDS docker #env:prod #team:platform       ; multiple scoped tags
```

A flat `#security` is `key=security, value=NULL`. Scoped tags **subsume** flat tags — every pre-v3 `#tag` is a v3 tag with null value. No existing line breaks.

Disambiguation: `#` always begins a tag; the first `:` inside a tag splits key from value.

Tags classify **the claim**, not the entity, and carry no independent belief history. For entity classification with history, use an entity facet — see the two-lane rule in §11.

### 6.3 Confidence — `@ N%`

Space after `@`, ends with `%`:

```cave
memory-leak CAUSE oom @ 70%
```

| Confidence | Meaning |
|---:|---|
| `@ 100%` | directly observed; certain for practical purposes (default, omit) |
| `@ 90%` | high confidence, reliable source |
| `@ 70%` | likely, multiple signals align |
| `@ 50%` | uncertain, could go either way |
| `@ 30%` | unlikely but plausible |
| `@ 0%` | evidentially false or fully rejected |

Omitted confidence means `@ 100%`.

The `@` disambiguation is purely whitespace: `@production` is context; `@ 70%` is confidence. One character of lookahead.

### 6.4 Comments — `;`

Everything after `;` is natural language persisted alongside the claim, stored in the `comment` column, searchable via SQL `LIKE` / FTS:

```cave
auth/key HAS expiry: 3600s ; rotated quarterly per security policy
OpenAI BECOMES for-profit ; alienated early nonprofit supporters
```

Comments are the escape hatch — when a triple is too terse, the prose rides alongside it. Use them for rationale, source hints, or nuance that does not fit the triple. Use them sparingly.

---

## 7. Values, Units, Uncertainty

### 7.1 Typed values

```cave
OpenAI HAS revenue: 20B USD/yr @2026-Q1
Anthropic HAS valuation: 380B USD
ChatGPT HAS weekly-users: 900M users/wk
pool HAS max: 20 conn
claude-code HAS revenue-ramp: 10mo
latency IS 30ms
free-user-rate IS 94.5%
```

Rules:

- Simple units glue to the number: `30ms`, `3600s`, `10mo`
- Compound units use a space: `20B USD/yr`, `900M users/wk`
- `/` in units means "per": `USD/yr`, `users/wk`, `req/s`
- `%` is a unit
- `~` prefix means approximate: `~20B USD/yr`, `~30ms`
- `@timestamp` is a context (when the measurement applies), not a unit

Standard units:

| Category | Units |
|---|---|
| Currency | `USD`, `EUR`, `GBP`, `CHF`, `JPY` |
| Time | `yr`, `mo`, `wk`, `d`, `h`, `min`, `s`, `ms` |
| Multipliers | `T`, `B`, `M`, `K` |
| Common domain units | `%`, `conn`, `req`, `rps`, `tps`, `users` |

Domain-specific units pass through verbatim.

### 7.2 Value uncertainty — `+/-`

`+/-` defines a symmetric uncertainty interval around the value. Default interpretation is **2σ** (≈95% interval):

```cave
OpenAI HAS revenue: 20B USD/yr +/- 2B USD/yr
; → σ = 1B, N(20B, 1B) — "95% sure it's between 18B and 22B"
```

Explicit σ level override:

```cave
OpenAI HAS revenue: 20B USD/yr +/- 2B USD/yr (1σ)   ; σ = 2B — wider
OpenAI HAS revenue: 20B USD/yr +/- 2B USD/yr (3σ)   ; σ ≈ 0.67B — tighter
```

If the interval is Δ at kσ, then σ = Δ / k. Omitting `(Nσ)` means `(2σ)`, matching natural intuition: "20 billion plus or minus 2 billion."

### 7.3 The two uncertainties are independent

Value uncertainty is **aleatory** (the quantity itself is imprecise). Claim confidence is **epistemic** (belief in the assertion). They compose freely:

```cave
; High confidence, imprecise measurement
OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @ 95%
; "very sure it's around 20B, but could be 18-22B"

; Low confidence, precise claim
OpenAI HAS revenue: 21.3B USD/yr @ 30%
; "someone said exactly 21.3B but I doubt the source"

; Full specification
OpenAI HAS projected-loss: 14B USD/yr +/- 3B USD/yr @2026 @ 70%
; N(14B, 1.5B) with 70% belief weight
```

---

## 8. Claim Composition and Indentation

Complex facts decompose into multiple claims. Indented lines attach to the nearest less-indented claim above them (the **parent**). Indentation attaches; it does not nest arbitrarily deep.

v3 consolidates indentation into exactly **three kinds** of indented line, distinguished by what the line starts with:

| Indented line starts with | Kind | Semantics |
|---|---|---|
| Qualifier verb (`WHEN`, `UNLESS`, `VIA`, `BECAUSE`) | **Qualifier** | Edge from parent claim to a condition/mechanism/evidence claim (§8.2) |
| Bare relational verb (primary or inverse) | **Continuation** | New sibling claim inheriting an endpoint from the parent (§8.3) |
| Full triple (`subject VERB object …`) | **Grouped claim** | Independent claim, contextually grouped with the parent (§8.4) |

### 8.1 Claim-as-node semantics

Internally, every line becomes a claim node. Indented qualifiers create edges between claim nodes:

```text
parent_claim --WHEN-->    condition_claim
parent_claim --VIA-->     mechanism_claim
parent_claim --BECAUSE--> evidence_claim
```

This makes CAVE composable without complicated syntax. (In the Draft unified grammar, these edges desugar to reified subjects — `[parent] WHEN condition` — see §17.)

### 8.2 Qualifiers

```cave
server CAUSE crash @ 80%
  WHEN load > ~1000 req/s
  WHEN NOT cache/enabled
```

Meaning: `server CAUSE crash` holds under those conditions. Qualifier verbs attach as edges to the parent claim; they do **not** inherit endpoints and are unaffected by inverse declarations.

Equivalent forms:

```cave
server CAUSE crash
  WHEN NOT cache/enabled
```

```cave
server CAUSE crash
  UNLESS cache/enabled
```

Canonical CAVE prefers `WHEN NOT`.

### 8.3 Inverse-aware continuation (v3)

A continuation line starts with a bare relational verb and inherits an endpoint from the parent:

- **Primary (forward) verb** → inherits the parent **subject** as its subject.
- **Inverse verb** → inherits the parent subject, which lands in **object** position after canonicalization.

```cave
monorepo CONTAINS packages/api
  CONTAINS packages/web      ; → monorepo CONTAINS packages/web      (subject inherited)
  CONTAINS packages/core     ; → monorepo CONTAINS packages/core
  PART-OF org/monorepos      ; → org/monorepos CONTAINS monorepo     (inverse: parent is object)
```

Reads naturally — "monorepo contains web, core; and is part of org/monorepos" — and desugars in the indentation pass. The mechanical rule: the parent's subject fills the continuation's missing subject slot **as written**; if the verb is an inverse, canonicalization to the primary direction (§5.5) then flips it. The `REVERSE` declaration is exactly what disambiguates direction — without it, a bare `PART-OF` continuation is ill-formed.

Each continuation line yields an **independent claim** with its own claim key, confidence, tags, and belief history. Continuation is sugar for writing siblings, not qualification of the parent.

### 8.4 Grouped full claims

Indented full triples remain independent claims, contextually grouped with the parent:

```cave
deploy VIA github-actions
  build PRECEDES deploy
```

equals

```cave
deploy VIA github-actions
build PRECEDES deploy
```

with the second claim grouped under the first.

---

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

**v3 addition:** keys are computed on the **canonical (primary-direction) form**. A forward claim and its inverse reading share one key — one fact, two names (§5.5).

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

---

## 10. Probabilistic Layer

The math below is an **implementation layer**, not required syntax. CAVE itself only stores claims and metadata.

### 10.1 Bayesian fusion of numeric estimates

Given two estimates of the same quantity:

```cave
revenue IS 18B USD/yr +/- 3B USD/yr @ 60% @src:analyst
revenue IS 20B USD/yr +/- 0.5B USD/yr @ 95% @src:filing
```

For normally distributed estimates with `+/- Δ` at kσ: σ = Δ/k, precision = 1/σ², confidence acts as a weight multiplier.

- Weighted precision: wᵢ = pᵢ / σᵢ²
- Posterior mean: μ = Σ wᵢxᵢ / Σ wᵢ
- Posterior σ: 1 / √(Σ wᵢ)

Worked: A gives σ=1.5B, w=0.444×0.60=0.267; B gives σ=0.25B, w=16.0×0.95=15.2. Posterior μ ≈ 19.97B, σ ≈ 0.25B. The filing dominates — more precise and higher confidence.

### 10.2 Conditional confidence (noisy-AND)

```cave
server CAUSE crash @ 80%
  WHEN memory-leak EXISTS @ 60%
```

Treating conditions as independent: p_effective = p_claim × p_condition = 0.8 × 0.6 = 0.48.

The independence assumption MUST be explicit in the query engine — never silently assumed for all domains.

### 10.3 Competing hypotheses

Prefer **distinct cause entities**, so hypotheses don't collide on one claim key:

```cave
memory-leak CAUSE app/crash @ 50%
deadlock CAUSE app/crash @ 30%
oom-killer CAUSE app/crash @ 20%
```

Confidences of an exhaustive hypothesis set should sum to ~100%. When evidence arrives, redistribute by appending:

```cave
memory-leak EXISTS @ 95% ; heap dump confirms leak

memory-leak CAUSE app/crash @ 75% ; was 50%
deadlock CAUSE app/crash @ 15% ; was 30%
oom-killer CAUSE app/crash @ 10% ; was 20%
```

If subject/object genuinely coincide, differentiate by context — never by bare repetition:

```cave
app CAUSE crash @hyp:memory-leak @ 50%
app CAUSE crash @hyp:deadlock @ 30%
```

---

## 11. Classification: Two Lanes, and Topics

### 11.1 The two-lane rule

CAVE has two deliberately distinct classification mechanisms. They differ by **what they classify** and **whether the classification has its own truth over time**:

| Lane | Syntax | Classifies | Own belief history? | Stored in |
|---|---|---|---|---|
| Entity facet | `subject HAS attr: value` | the **entity** | yes — it is a claim | `cave_claim.attribute` |
| Claim facet | `… #key:value` | the **claim** | no | `cave_tag(key, value)` |

Writer's discriminator: *does this classification deserve its own history?*

```cave
auth/middleware HAS topic: security                      ; entity facet — membership can evolve, versioned
token-expiry CAUSE reject-valid-tokens #topic:auth-security  ; claim facet — files this claim, no independent life
```

Collapsing the lanes would either force claim tags to carry spurious history or strip entity memberships of theirs (§19.4).

### 11.2 Topic layer — convention, not syntax

Topics are built entirely from existing primitives. A topic is an ordinary entity, conventionally under `topic/`; membership is ordinary `CONTAINS`:

```cave
topic/auth-hardening IS topic
topic/auth-hardening CONTAINS token-expiry
topic/auth-hardening CONTAINS auth/middleware
```

Three cooperating mechanisms, all pre-existing:

1. Topic entities + `CONTAINS` membership — graph-traversable hierarchy (and `PART-OF` reads back for free via `REVERSE`).
2. Entity facets `HAS topic:` — versioned per-entity topic membership.
3. Claim facets `#topic:x` — cheap filing of individual claims.

### 11.3 Active-reconstruction interface (non-normative)

CAVE's graph maps onto the Cue–Tag–Content active-memory paradigm (Ji et al., *Memory is Reconstructed, Not Retrieved*, 2026) without new syntax:

- **Cues** — entities and tags used as query anchors.
- **Tags** — scoped tags and topic entities.
- **Content** — claims, values, and comments.
- Topic-to-member expansion (ϕτ→e) is a plain forward `CONTAINS` traversal from topic entities; member-to-container recovery (ϕv→(c,g)) is the inverse `CONTAINS` read — the exact gap `REVERSE` closes.

The reconstruction *loop* — select, route, stop — is a **policy over the graph**, not part of the language. It lives in the agent layer (§18), deliberately outside this specification.

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

**v3:** inverse verbs are valid in patterns. `?x PART-OF monorepo` and `monorepo CONTAINS ?x` compile to the same physical query against canonical rows.

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

-- v3: single nullable value column; flat tag == value IS NULL
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

Migration from the pre-v3 `cave_tag(claim_id, tag)`: rename `tag` → `key`, add nullable `value`. Every existing row is a flat tag.

### 13.3 Inverses are views, never rows

The store holds **one row per fact**, in canonical direction. Reverse reads are query-time views over indexes that already exist:

```sql
-- forward read (verb is primary): idx_cave_subject
SELECT object AS target, verb AS rel
FROM cave_claim WHERE subject = ?;

-- inverse read (the pre-v3 gap): idx_cave_object, relation named via inverse_of()
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

---

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

## 16. Grammar (Normative Core)

Consolidated EBNF for the committed v3 language. `REVERSE` declarations need **no grammar change** — they are ordinary claim lines whose subject and object happen to be verbs; their meaning is a semantic pass. The v3 grammar deltas over v0.2 are the scoped-tag production and the continuation clause.

```ebnf
file          = { line } ;

line          = blank
              | comment_line
              | claim_line
              | indented_line ;

comment_line  = ";" text ;

claim_line    = subject space verb [space "NOT"] space payload metadata [comment] ;

indented_line = indent ( qualifier_clause
                       | continuation_clause          (* v3 *)
                       | claim_line ) ;

qualifier_clause    = qualifier_verb space qualifier_payload metadata [comment] ;
qualifier_verb      = "WHEN" | "UNLESS" | "VIA" | "BECAUSE" ;

(* v3: bare relational verb; endpoint inherited from parent per §8.3 *)
continuation_clause = verb [space "NOT"] space payload metadata [comment] ;

subject       = atom | literal | code_literal ;
verb          = uppercase_atom ;

payload       = attr_value | object ;
attr_value    = attribute ":" space value ;
object        = atom | literal | code_literal | object_phrase ;

metadata      = { space metadata_item } ;
metadata_item = uncertainty | sigma_level | context | tag | confidence | importance ;

uncertainty   = "+/-" space value ;
sigma_level   = "(" number "σ" ")" ;
context       = "@" context_atom ;                    (* no space after @ *)
tag           = "#" tag_atom [ ":" tag_value ] ;      (* v3: optional scoped value *)
confidence    = "@" space percentage ;                (* space after @ *)
importance    = "!" ;
comment       = space ";" text ;

value         = [ "~" ] number [ multiplier ] [ unit_expr ]
              | date_like
              | atom
              | literal
              | code_literal ;

unit_expr     = unit { "/" unit } ;

atom            = atom_char { atom_char } ;
uppercase_atom  = uppercase_letter { uppercase_letter | "-" } ;
literal         = '"' text '"' ;
code_literal    = "`" text "`" ;
```

Disambiguation summary: `@` + space = confidence, `@` + no space = context; `#` always begins a tag, first `:` inside it splits key/value; `:` in payload binds attribute to value; `/` after a number is "per", elsewhere it is entity scope.

---

## 17. Draft Layer — Unified Grammar (Variables, Reification, Rules, Temporal)

**Status: Draft.** Fully designed; a PEG specification, `peggy` grammar file, and TypeScript AST/evaluator skeleton exist. Not yet committed to the normative spec — commitment is gated on the parser implementation proving the pieces out. Nothing here invalidates any normative line above.

### 17.1 The binding-state insight

The unifying principle: **facts, queries, and rules are the same triple structure**, distinguished only by whether slots are bound or contain variables.

| Binding state | Reading |
|---|---|
| all slots bound | fact |
| some slots are variables | query |
| variables + `=>` | rule |

One grammar covers storage, querying, and inference. (Same shape as Gherkin's given/when/then and LLM inference's context/query/result.)

### 17.2 Variables — `?x`

`?` alone is anonymous; `?x` is named and binds across a rule:

```cave
?x USES jwt
? CAUSE performance-regression @production      ; open query
```

### 17.3 Reification — `[S V O]`

A triple becomes a term you can make claims about:

```cave
[server CAUSE crash] WHEN load EXCEEDS 1000 req/s
[auth/token IS jwt] ENABLES [api YIELDS 200]
```

Brackets nest, but rarely beyond depth 2 in practice. In this layer, **indentation is reification sugar**: a child line under parent T desugars to use `[T]` as its subject —

```cave
server CAUSE crash                 ; ≡  [server CAUSE crash] WHEN load > 1000 req/s
  WHEN load > 1000 req/s           ;    [server CAUSE crash] WHEN NOT cache/enabled
  WHEN NOT cache/enabled
```

— which keeps the grammar context-free while preserving readable nesting, and gives the normative `cave_edge` qualifier semantics (§8.2) a precise algebraic reading. Reconciliation note: v3 continuation lines (§8.3) are **not** reification — they desugar to sibling claims with inherited endpoints. The three-kind indentation taxonomy of §8 carries over unchanged.

### 17.4 Rules — `=>`

Left side: comma-separated conjunction of patterns. Right side: the asserted triple. Rules are just triples with variables — same file, same graph, no separate parser path. `=>` is the only rule-specific token.

```cave
; Transitivity
?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z

; Constraints in premises — rules can test values, not just match patterns
?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian

; Conditional generation
?svc HAS errors: ?e, ?e > 100, ?svc HAS no-owner => ?svc NEEDS oncall-review !
```

### 17.5 Temporal values — three layers

Progressive complexity; most claims never leave Layer 1.

| Layer | Syntax | Use |
|---|---|---|
| 1 | `revenue IS 20B USD/yr @2025` | point observation (existing CAVE, no change) |
| 2 | `revenue IS 20B -> 40B USD/yr @2025..2028` | trajectory; linear interpolation between endpoints |
| 3 | `revenue IS (t -> 20B * 1.25^(t - 2025)) USD/yr` | function; full generality |

Layer 3 examples:

```cave
users IS (t -> Logistic(900M, 1.2B, 0.3, 2026)) users/wk
cost IS (t -> Step(10B @..2025, 14B @2025..2026, 18B @2026..))
```

Layer 2 covers ~90% of cases ("it was X, it'll be Y"). Layer 3 is the escape hatch for real models — `(t -> expr)` is a lambda: familiar, parseable, composable. Time ranges use `..`: `@2025..2028`, open-ended `@..2025`, `@2026..`.

### 17.6 Iterative coverage

The payoff of unification: start with a query (triple with holes), add facts, rules fire, watch coverage converge.

```cave
; Query
? CAUSE performance-regression

; Observations
deploy/v2.3 PRECEDES regression @2026-04-10
deploy/v2.3 CONTAINS db/index-removal

; Rule fires
?x PRECEDES ?event, ?x CONTAINS ?change => ?change CAUSE ?event @ 50%

; Generated claim
db/index-removal CAUSE performance-regression @ 50%

; Confirming evidence, then confidence update
db/query-time IS 5ms -> 800ms @2026-04-10..04-11
  WHEN db/index-removal
db/index-removal CAUSE performance-regression @ 85%
```

Coverage is measurable: what fraction of `?` variables have bindings, at what aggregate confidence? Low-confidence claims and unbound variables *are* the frontier — the graph tells you what's missing.

### 17.7 Draft grammar sketch (PEG excerpts)

```peg
Arg         <- Expr TimeAnno?
TimeAnno    <- "@" TimeRange
TimeRange   <- TimePoint? ".." TimePoint? / TimePoint
TimePoint   <- [0-9][0-9-]*                    # 2025, 2026-Q1, 2026-04-16

Qualifier   <- ValueDelta / Confidence / Tag / Context / Bang / Comment
ValueDelta  <- "+/-" Quantity Sigma?
Sigma       <- "(" [0-9]+ "σ" ")"
Confidence  <- "@" " "+ Number "%"             # SPACED: @ 70%
Context     <- "@" [a-zA-Z0-9._:-]+            # UNSPACED: @production
Tag         <- "#" Identifier (":" Identifier)?
Bang        <- "!"
Comment     <- ";" (!NL .)*

Identifier  <- [a-zA-Z_][a-zA-Z0-9_-]*
```

**Known hard part:** the expression sub-grammar inside `(t -> ...)`. Everything else parses by trivial recursive descent; `Expr` needs real operator precedence, named functions (`Logistic`, `Step`, `Exp`), comparisons, and time-annotated arguments. If a corner must be cut, cut elsewhere — keep this precise.

---

## 18. System Context — Agent Layer (Non-normative)

**The agent layer is deliberately outside the language specification.** Active reconstruction is a *policy* over the graph; keeping CAVE a clean substrate means the policy can evolve or be swapped without spec churn.

**`cave-loop`** (TypeScript, strict mode) implements Ji et al.'s Algorithm 1 as a functional reconstruction loop:

- Injectable `CaveStore` and `Policy` interfaces
- In-memory store with inverse-aware reverse traversal (built directly on §5.5 / §13.3)
- A deterministic heuristic policy for dependency-free testing
- A commented LLM-adapter sketch for the eventual LLM-driven policy
- A runnable demo exercising the multi-hop recovery pattern central to the paper's thesis

The store contract the language guarantees the agent: forward reads via the subject index, named inverse reads via the object index plus `inverse_of()`, current-belief resolution via claim keys, and topic expansion via `CONTAINS` in both directions.

---

## 19. Design Rationale and Rejected Alternatives (Non-normative)

### 19.1 Colon-in-verb notation — rejected

`HAS:TOPIC`-style verbs are off-limits. The `:` character already carries exactly one payload meaning (attribute/value split), a hazard v0.2 solved deliberately. Putting `:` inside verbs reintroduces the disambiguation problem. Facets belong in the two lanes of §11.1.

### 19.2 Materialized inverse rows — rejected

Same-key over linked-keys: "one fact, two names" keeps belief evolution coherent — an update through either name updates one series. Linked distinct keys would let the two directions drift in confidence, incoherent for what is physically one edge. And materialization would double rows, fork belief series, and double contradiction-resolution work. Inverses are lazy views, always.

### 19.3 Explicit episodic/semantic layering — rejected

The distinction is real but already expressible: `@time:` / `@src:` contexts anchor episodes; their absence marks semantic knowledge. An explicit layer would add machinery without adding expressiveness.

### 19.4 Single classification mechanism — rejected

Entity facets and claim facets answer different questions with different lifetimes. Collapsing them forces either spurious history onto claim tags or history loss for entity memberships. Hence two lanes, kept distinct on purpose.

### 19.5 Standing principles

- New syntax only when semantics strictly demand it; build on the bootstrap otherwise (`REVERSE`, extension verbs, topics all follow this).
- Specifications evolve as strict additive deltas — no wholesale rewrites; no existing line becomes invalid.
- Prefer conventions (topic entities, context prefixes) over grammar.
- The agent stays out of the language.

---

## 20. Changelog

### v0.1 → v0.2

- **`attribute: value` colon made canonical** — resolves the object-vs-attribute ambiguity; legacy colonless form accepted on parse only.
- Causal direction fixed: cause → effect (`memory-leak CAUSE app/crash`).
- `ALIAS` preferred over `IS` for true equivalence.
- Qualifier verbs extended: `UNLESS` (accepted; `WHEN NOT` preferred), `BECAUSE` (evidence/rationale).
- Context prefixes: `@src:`, `@time:`, `@loc:`, `@scope:`.
- Negation semantics pinned: `VERB NOT` (logical negation) vs `@ 0%` (retraction of support).
- Claim keys and latest-tx current-belief resolution formalized; contradictions allowed to coexist.
- Competing hypotheses: distinct cause entities preferred; `@hyp:` context as fallback; bare same-key repetition disallowed.
- CAVE-Q query layer: `?x` variables, `_` wildcard, `WHERE` filters, `EXTENDS+` transitive hops.
- Full relational schema: `cave_claim`, `cave_context`, `cave_tag`, `cave_edge`, FTS5; canonicalization pipeline.
- Bayesian fusion and noisy-AND moved to an explicit implementation layer.

### v0.2 → v3 (strict additive delta)

| Area | v0.2 | v3 |
|---|---|---|
| Reverse traversal | SQL only, ad hoc | first-class via `REVERSE` declarations |
| Edge direction | one name per verb | two names (verb + inverse), one stored row, one claim key |
| Tags | flat `#tag` | flat `#tag` **or** scoped `#key:value` |
| Topics | absent | convention over topic entities + `CONTAINS` + facets |
| Multiline | qualifier verbs only | bare relational verbs inherit subject **or** object (inverse-aware) |
| Storage | `cave_tag(claim_id, tag)` | `cave_tag(claim_id, key, value)` — `value` nullable |
| Retrieval interface | — | CTC (cue/tag/content) mapping, non-normative; agent layer separate |

No v0.2 line becomes invalid.

### Pending (Draft, §17)

Named variables in the core grammar, reification `[S V O]`, rules `=>` with constraint premises, three-layer temporal values, expression sub-grammar. Gated on the `peggy` parser implementation.

---

## 21. Worked Example

Input:

> "We spent an hour debugging why the auth middleware was rejecting valid tokens. Turned out the expiry check was using strict less-than instead of less-than-or-equal, so tokens expiring in the current second got rejected. Fixed it in auth.ts line 42. We should probably add a test for boundary cases. Sarah mentioned we might want to switch to asymmetric keys, but we haven't decided yet."

CAVE v3 output:

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

and, once the Draft layer lands:

```cave
?fix FIX token-expiry                     ; → `<=`
?x HAS bug: ?b #topic:auth-hardening      ; scoped-tag query
```

---

## 22. Compact Spec Card

```cave
subject VERB [NOT] object                [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta [(Nσ)]] [@context...] [#tag[:value]...] [@ N%] [!] [; comment]

VERB REVERSE INVERSE-VERB                ; declare inverse; left side is primary
  parent VERB object
    VERB object2                         ; continuation: inherits parent subject
    INVERSE-VERB other                   ; continuation: parent lands in object position
    WHEN condition                       ; qualifier edge on the parent claim
```

Terse, atomic, append-only, queryable — and every v3 addition is normalization rules, one nullable column, and conventions layered on two bootstrap verbs.
