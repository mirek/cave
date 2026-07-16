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

= Permanent History and Sensitive Data
Retraction changes current belief by appending a zero-confidence row. It does not erase the earlier row, authored text, metadata, search index, full export, sync peer, or backup. A current-only export is a compact view, not a sanitizer: the surviving rows may themselves carry sensitive subjects, values, contexts, or comments.

CAVE deliberately provides no claim-level redact or forget command. A local rewrite could not guarantee erasure across SQLite remnants, FTS tables, transaction files, copied databases, annotated exports, version-control history, peers, backups, snapshots, and storage media; an older peer could also reintroduce the globally identified row. Keep credentials and selectively erasable personal data outside the store.

#note([Accidental secret response], [Rotate or revoke the secret first. Stop writers and sync, inventory every database/export/clone/backup/snapshot, rebuild from reviewed safe input, verify the replacement independently, then explicitly destroy or expire every affected copy using the storage provider's confirmed procedure. Never merge an affected store into the replacement.])

= Sensitivity-Scoped Publication
Claims can carry `#sensitivity:public`, `#sensitivity:internal`, `#sensitivity:confidential`, or `#sensitivity:restricted`. The order is public, internal, confidential, then restricted. Unlabeled rows are internal; flat, malformed, and unknown sensitivity labels fail closed as restricted. If several labels occur, the most restrictive wins.

Export, reports, and the human HTTP view default to an internal ceiling and can select another maximum explicitly. Filtering is structural: dashboard counts, aliases, history, search, lineage, and edges derive only from visible rows. Current belief resolves first, then the selected latest row is filtered, so a hidden update never revives an older public belief.

#note([Boundary], [Sensitivity is routing metadata, not encryption, authorization, deletion, or a retention policy. Use --max-sensitivity restricted for an exact canonical backup or transaction-annotated replica. Sync remains exact and preserves every row and label.])

= Source-Span Provenance
A source context can cite one exact one-based inclusive source line or range: `@src:docs/auth.md#L10` or `@src:docs/auth.md#L10-L20`. The source locator is percent-escaped; a literal hash is `%23`, a space is `%20`, and the unescaped hash is reserved for the line fragment.

The full context remains claim-key metadata and survives export, import, and sync. The decoded locator without its line fragment remains the underlying source identity for resolution and reliability policy. Ingest numbers embedded text so extractors can cite the smallest supporting range. Connect attaches physical source identity to every mapped record and exact lines for CSV, TSV, and JSONL. Claim APIs and report footnotes expose the same parsed location, with links for HTTP sources.

#note([Evidence lifetime], [A line span points into the cited source version; it is not a content hash or archive. Retain or version the source when evidence must remain immutable.])


= CAVE-Q Query Language
CAVE-Q reuses the claim shape as a graph pattern language. Slots beginning with ? are named variables. An underscore is an anonymous wildcard. A plus suffix requests one-or-more transitive hops.

```cave
?x USES jwt
?x HAS bug: ?bug #security
?cause CAUSE app/crash
terrier EXTENDS+ animal
_ USES jwt
```

Filters restrict matched rows by confidence, tag, context, value, unit, transaction, or other stored fields. Inverse verbs compile to the same canonical rows as their primary direction. Deprecated and preferred verb spellings declared with RENAMED-TO compile to one stable storage verb and belief history.

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
team EXPECTS PART-OF #cardinality:one
service EXPECTS latency #unit:ms
```

Expectations apply through the IS and EXTENDS taxonomy. A direct instance of a subtype inherits expectations from ancestor types. Attribute expectations look for a positive HAS attribute claim. Relation expectations account for inverse direction. The compatible default is one or more matches. `#cardinality:one` requires exactly one current match, chiefly for relation endpoints because attribute claim keys already select one current value. `#unit:ms` requires an attribute value whose normalized unit is exactly `ms`; unitless values and implicit conversions do not satisfy it.

cave check is a read-only health report. It lists unsatisfied expectations with observed counts and units, stale beliefs, medium-confidence review candidates, alias disagreements, and aggregate coverage. Violations make the command fail; advisory sections identify the frontier without blocking normal reads.

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
