= What CAVE Is
CAVE stands for Compressed Atomic Verb Expressions. It is a small line-oriented language and a local system for recording knowledge as atomic claims. A claim is easy for a person or language model to write, easy to diff in source control, formal enough to query, and persistent enough to retain changes in belief over time.

The smallest useful statement has three parts: a subject, an uppercase verb, and an object. CAVE extends that shape with attributes, values, confidence, contexts, tags, comments, uncertainty, temporal scope, and lineage. The language remains deliberately small; system behavior is built by composing claims rather than by adding unrelated syntactic forms.

```cave
subject VERB object
subject HAS attribute: value

service/auth USES jwt
auth/middleware HAS bug: token-expiry #security
server IS NOT compromised @ 90%
```

CAVE is not only a notation. The repository implements a complete loop around the notation: parsing, canonicalization, SQLite persistence, graph querying, deterministic and language-model ingestion, rules, governed actions, contradiction resolution, alias discovery, synchronization, automations, an MCP server, a read-only web view, evaluation, and cited reports.

#note([Design boundary], [CAVE targets a single-machine, inspectable knowledge system. It favors plain text, SQLite, deterministic transforms, and explicit provenance over a distributed platform or a hidden vector-only memory layer.])


= Design Principles
The system is guided by six constraints. Each constraint removes a common source of accidental complexity.

#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Principle*],
  [*Consequence*],
  [Caveman-simple],
  [Short direct statements; low ceremony.],
  [Atomic],
  [One independently useful claim per line.],
  [Composable],
  [Claims can qualify, support, contradict, or supersede other claims.],
  [Queryable],
  [Every persisted row has stable structural fields.],
  [Persistent],
  [Belief changes append; history is not overwritten.],
  [LLM-friendly],
  [Extraction can preserve uncertainty, estimates, and source context.],
)

The strongest rule is that new core syntax is added only when semantics require it. Extension verbs, shape declarations, source policy, actions, automations, and rules are represented as ordinary claims wherever possible. This keeps the grammar compact and moves policy into queryable data.

CAVE also separates three concerns that are frequently conflated: transaction time says when a store learned something; valid time says when a claim applies in the modeled world; confidence says how strongly the claim is believed. Keeping these axes distinct enables historical and temporal questions without snapshots or destructive edits.


= The Claim Model
Every CAVE line denotes an immutable claim. Conceptually, a claim contains a subject, verb, payload, polarity, and metadata. The payload is either a relation object or an attribute/value pair.

```cave
claim = <subject, verb, payload, negated, metadata>
metadata = <confidence, contexts, tags, uncertainty, importance,
            comment, transaction identity, source provenance>
```

Relational claims connect two terms. Attribute claims attach a named property to a subject. Metric claims use IS with a numeric or temporal value. The same storage and query machinery handles all three.

```cave
repo CONTAINS packages/core
pool HAS max: 20 conn
revenue IS ~20B USD/yr +/- 2B USD/yr @2026-Q1 @ 90%
```

A claim is immutable after append. The current state of a fact is resolved from its belief series. Contradictory series can coexist because CAVE treats disagreement as data rather than as a write-time error.

The implementation recognizes progressively richer usage layers: CAVE-Lite for bare triples, CAVE-Core for triples plus metadata, and CAVE-Full for qualified claims, continuation, uncertainty, history, and inverse-aware reads.


= Core Syntax
Canonical CAVE has two primary line shapes. The colon in an attribute claim is significant: it separates the attribute name from its value and prevents ambiguity with a relation object.

```cave
subject VERB [NOT] object [qualifiers] [; comment]
subject HAS attribute: value [+/- delta [(N sigma)]] [qualifiers] [; comment]
```

#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Token*],
  [*Meaning*],
  [@context],
  [Scope, source, location, environment, or valid-time context.],
  [@ 90%],
  [Epistemic confidence; the space after @ distinguishes it from context.],
  [#tag],
  [Flat tag.],
  [#key:value],
  [Scoped tag.],
  [+/-],
  [Numeric uncertainty.],
  [~],
  [Approximate value marker.],
  [!],
  [Importance marker.],
  [;],
  [Persistent human comment.],
  [NOT],
  [Explicit logical negation.],
  [->],
  [Trajectory between numeric endpoints.],
)

Entities are compact names. Slash introduces scope, kebab-case is preferred within a segment, and proper nouns retain their casing. Exact code-like text belongs in backticks; natural-language literals belong in double quotes.

```cave
auth/middleware
auth/middleware/token-check
PostgreSQL
`ECONNRESET`
"install dependencies"
```

Pronouns are intentionally poor entity names. Extraction should resolve "it" or "the component" to a stable term. Reusing the same entity spelling is more valuable than inventing stylistic variants.


= Verbs, Extensions, and Inverses
IS and HAS are sufficient to bootstrap the language. Standard verbs improve graph quality for common relations such as causation, dependency, structure, ordering, comparison, and provenance.

#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Family*],
  [*Typical verbs*],
  [Identity and taxonomy],
  [IS, EXTENDS, ALIAS, LIKE, EXISTS],
  [Causation and change],
  [CAUSE, FIX, BECOMES],
  [Dependency and production],
  [NEEDS, USES, YIELDS, ENABLES, BLOCKS],
  [Structure and ordering],
  [CONTAINS, PRECEDES, EXCEEDS],
  [Evidence and qualification],
  [BECAUSE, VIA, WHEN, UNLESS],
)

Domain verbs are declared in-band. A declaration is itself a claim, which means vocabulary changes are attributable, reviewable, and append-only.

```cave
WORKS-AT IS verb ; X is employed by organization Y
WORKS-AT REVERSE EMPLOYS
```

REVERSE declares two readable names for one fact. Only the primary direction is stored. A write or query using the inverse is canonicalized by swapping endpoints and substituting the primary verb. Forward and inverse readings share one claim key, one history, and one physical row.

```cave
team/acme EMPLOYS alice      ; input form
alice WORKS-AT team/acme      ; canonical stored form
```

#note([Why inverses are views], [Materializing both directions would double rows, split belief histories, and duplicate contradiction work. Query-time inverse views preserve one fact with two human-readable directions.])
