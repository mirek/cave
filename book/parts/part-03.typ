#import "../style.typ": note

= SQLite Storage Model
The physical design is a compact relational schema. Claims occupy the central table; contexts, tags, and claim-to-claim edges live in side tables. Full-text search indexes human-readable fields.

```cave
cave_claim(id, tx, subject, verb, negated,
           object, attribute, value_text, value_num, value_unit,
           value_approx, delta_text, delta_num, delta_unit,
           sigma_level, conf, importance, comment, raw_line, claim_key)

cave_context(claim_id, context)
cave_tag(claim_id, key, value)
cave_edge(parent_id, role, child_id)
cave_fts(claim_id, subject, verb, object, attribute, value_text, comment, raw_line)
```

The canonicalization pipeline normalizes verb casing, resolves inverse verbs, expands continuation lines, normalizes entity whitespace, parses confidence and numeric multipliers, splits tags, computes the canonical claim key, and persists side-table rows. raw_line remains available for fidelity and diagnostics.

The core current-belief query joins each claim key to its maximum transaction. As-of queries apply the same grouping after restricting rows to a transaction boundary. Inverse reads use subject and object indexes without adding rows.

#note([Portability], [Canonical CAVE text is the backup and interchange form. SQLite is the efficient working representation, not a proprietary source of truth.])


= CAVE-Q Query Language
CAVE-Q reuses the claim shape as a graph pattern language. Slots beginning with ? are named variables. An underscore is an anonymous wildcard. A plus suffix requests one-or-more transitive hops.

```cave
?x USES jwt
?x HAS bug: ?bug #security
?cause CAUSE app/crash
terrier EXTENDS+ animal
_ USES jwt
```

Filters restrict matched rows by confidence, tag, context, value, unit, transaction, or other stored fields. Inverse verbs compile to the same canonical rows as their primary direction.

```cave
WHERE conf >= 0.8
WHERE tag = security
WHERE context = production
WHERE value > 1000 req/s
WHERE tx <= 2026-01-15
```

Query modes distinguish current resolved rows from full history. --as-of reconstructs the store's belief state at a date, timestamp, or UUIDv7 transaction. --at anchors valid time. --aliases widens entity positions through the current alias closure. --resolve selects a trusted winner among competing source series.

SQL remains available for advanced analysis. CAVE-Q is the ergonomic graph layer; SQL is the transparent escape hatch.


= Aliases and Entity Resolution
ALIAS asserts that two names denote the same entity. Alias-aware querying computes an opt-in undirected transitive closure over current positive entity-to-entity ALIAS claims.

```cave
postgres ALIAS postgresql
billing USES postgres
analytics USES postgresql
```

With aliases enabled, a query for systems using postgres can match both spellings. The store does not rewrite rows or pick a canonical name. It widens matching and returns the stored spelling, preserving separate histories and making disagreements visible.

Unmerge is a retraction of the alias claim. Negated, retracted, or literal-ended ALIAS claims do not connect the closure. Values, attributes, and verbs are not subject to alias expansion.

cave suggest-alias discovers candidate pairs using explainable string and graph signals such as separator drift, segment containment, edit distance, shared rare attributes, and relation overlap. Suggestions are low-confidence questions. Human confirmation or rejection is appended as ordinary ALIAS knowledge, so the decision persists.


= Shape Expectations and Knowledge Health
CAVE records expected structure as claims rather than in an external schema language. EXPECTS declares that instances of a type should carry an attribute or participate in a relation.

```cave
EXPECTS IS verb
service EXPECTS owner
service EXPECTS repo
service EXPECTS USES
team EXPECTS PART-OF
```

Expectations apply through the IS and EXTENDS taxonomy. A direct instance of a subtype inherits expectations from ancestor types. Attribute expectations look for a positive HAS attribute claim. Relation expectations account for inverse direction.

cave check is a read-only health report. It lists unsatisfied expectations, stale beliefs, medium-confidence review candidates, alias disagreements, and aggregate coverage. Violations make the command fail; advisory sections identify the frontier without blocking normal reads.

Write gating reuses the same checks transactionally. cave add --check and actions can append, evaluate newly introduced violations, and roll back only if the operation makes health worse. Existing violations do not prevent unrelated progress.


= Ingestion from Prose
cave ingest turns files or web pages into claims using any headless agent that can either call CAVE MCP tools or return CAVE text on stdout. Domain instructions steer modeling choices while the engine owns persistence and provenance.

- One claim per line; split compound statements.
- Resolve pronouns and unstable descriptions to concrete entities.
- Prefer chosen decisions over the full debate, while retaining important rejected alternatives.
- Keep code identifiers and exact errors in backticks.
- Drop conversational wrapper and repeated explanation.
- Preserve uncertainty and source context.
- Choose granularity that supports a future query or action.

Input files are digested so unchanged content is skipped on later runs. Batching limits prompt size. A source can be a path, glob, or URL; web content is fetched and readability-extracted before the agent sees it.

```cave
cave ingest --db lore.db "docs/**/*.md" https://example.com/design \
  --instructions domain.md \
  --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"' 
```

Shell template substitutions are quoted by the implementation. Placeholders such as {db}, {prompt-file}, and {mcp-config} should be written bare so paths with spaces or shell metacharacters remain one argument.
