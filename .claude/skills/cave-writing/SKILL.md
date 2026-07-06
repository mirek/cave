---
name: cave-writing
description: CAVE language reference (spec §3–§8, §11, §16, §22) — syntax, lexical rules, verbs and REVERSE inverses, metadata qualifiers, values/units/uncertainty, indentation and continuation, tags and topics, normative grammar. Use when writing, reviewing, emitting, or parsing CAVE lines, or when spec sections in that range are referenced.
---

# CAVE — Writing the Language

Part of the CAVE specification. Sections keep their spec numbers; unless marked otherwise a section is **Normative** (see §0 in the `cave-design` skill for status conventions). Related sections: extraction guidance in `cave-extraction` (§14–§15, §21); persistence, queries, and storage in `cave-storage-query` (§9, §12–§13); design goals, model, and rationale in `cave-design` (§0–§2, §10, §17–§19).

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

Continuation (§8.3):

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

The colonless form `OpenAI HAS revenue 20B USD/yr` is ambiguous: is the object `revenue 20B USD/yr`, or is `revenue` an attribute with value `20B USD/yr`? For query execution this MUST be explicit. Canonical CAVE therefore uses `:`:

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

Prefer `ALIAS` over `IS` for true equivalence. Merging two names for one
entity is appending `dupe ALIAS canonical`; unmerging is retracting it
(`dupe ALIAS canonical @ 0%`). Query-time resolution through `ALIAS`
links — the alias closure — is §13.6.

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

**Motivation.** CAVE stores each claim once, in one direction: `monorepo CONTAINS packages/api`. Without inverse declarations, asking "what is `packages/api` part of?" forces an object-side SQL scan with no name for the reverse relation. A verb may therefore declare its inverse, so the same stored edge is readable — and queryable — from both ends, **without storing a second row.**

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

No verb is born with an inverse. A relation without a `REVERSE` declaration simply has no reverse name; reverse reads fall back to an object-side scan with the relation un-named. Standard verbs SHOULD carry the declarations above; emitters MAY prepend them to a document or keep them in a shared prelude.

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

Storage consequences in §13.3 (`cave-storage-query` skill).

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

A flat `#security` is `key=security, value=NULL`. Scoped tags **subsume** flat tags — a flat `#tag` is simply a tag with null value.

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

There are exactly **three kinds** of indented line, distinguished by what the line starts with:

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

This makes CAVE composable without complicated syntax. (In the Draft unified grammar, these edges desugar to reified subjects — `[parent] WHEN condition` — see §17 in the `cave-design` skill.)

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

### 8.3 Inverse-aware continuation

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

## 16. Grammar (Normative Core)

Consolidated EBNF for the committed language. `REVERSE` declarations need **no grammar change** — they are ordinary claim lines whose subject and object happen to be verbs; their meaning is a semantic pass.

```ebnf
file          = { line } ;

line          = blank
              | comment_line
              | claim_line
              | indented_line ;

comment_line  = ";" text ;

claim_line    = subject space verb [space "NOT"] space payload metadata [comment] ;

indented_line = indent ( qualifier_clause
                       | continuation_clause
                       | claim_line ) ;

qualifier_clause    = qualifier_verb space qualifier_payload metadata [comment] ;
qualifier_verb      = "WHEN" | "UNLESS" | "VIA" | "BECAUSE" ;

(* bare relational verb; endpoint inherited from parent per §8.3 *)
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
tag           = "#" tag_atom [ ":" tag_value ] ;      (* optional scoped value *)
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

Terse, atomic, append-only, queryable — the whole language is normalization rules, one nullable column, and conventions layered on two bootstrap verbs.
