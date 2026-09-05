#import "../style.typ": note, file, recap

= How Claims Are Stored

In the current implementation a store is one SQLite file with a small
relational schema; the schema is a detail behind the `cave` commands and the
package APIs, not part of the language. This chapter
describes the tables, the pipeline that turns a line of text into rows, the
one rule that makes reverse readings free, and how the schema itself is
versioned.

== The tables

Claims occupy one central table. Contexts, provenance, tags, and
claim-to-claim edges live in side tables, and a full-text index covers the
human-readable columns:

```text
cave_claim(id, tx, subject, verb, negated,
           object, attribute, value_text, value_num, value_unit, value_approx,
           delta_text, delta_num, delta_unit, sigma_level,
           conf, importance, comment, raw_line, claim_key)

cave_context(claim_id, context)
cave_provenance(claim_id, dimension, value)     -- actor, source, run, domain
cave_tag(claim_id, key, value)                  -- value NULL for a flat tag
cave_edge(parent_id, role, child_id)            -- WHEN, VIA, BECAUSE, QUALIFIES
cave_fts(claim_id, subject, verb, object, attribute, value_text, comment, raw_line)
```

`id` and `tx` are both the row's UUIDv7, which encodes its wall-clock
millisecond and sorts chronologically. `subject`, `verb`, and `object` are
stored in the canonical primary direction; `raw_line` keeps the text
exactly as written, inverse spelling and all. `value_num` and `value_unit`
hold the parsed number and normalized unit when the value is numeric, with
the original in `value_text`; a trajectory keeps `value_num` empty. An
edge's role is the qualifier that produced it, with two normalizations: an
`UNLESS` line is stored as a `WHEN` edge to a negated child, and a full
claim grouped under another line links to it with `QUALIFIES`. Indexes
cover the claim key with transaction, subject, verb, object, attribute,
confidence, each context, each tag key and value, and each edge end.

== From a line to rows

Before storage, every line goes through one canonicalization pipeline:

1. Uppercase the verb.
2. Resolve a renamed spelling to its stable storage verb; then, if the verb
   is a declared inverse, swap subject and object and substitute the
   primary verb.
3. Resolve continuation lines by filling the inherited endpoint from the
   parent.
4. Normalize entity whitespace to hyphens; keep proper-noun casing.
5. Preserve `raw_line` exactly.
6. Parse confidence to a decimal (`@ 90%` becomes `0.9`).
7. Parse the approximate marker into `value_approx`.
8. Normalize multipliers (`20B` becomes `20000000000`).
9. Keep both the raw value text and the parsed number.
10. Split tags into key and value.
11. Stamp actor provenance if the line names no source (Chapter 8).
12. Compute the claim key on the canonical form.
13. Write the row and its side-table rows in one transaction.

The ordering is the invariant the rest of the system rests on:
*canonicalize before identity*. An inverse spelling and a continuation must
have converged on the primary form before the key is computed, or one fact
would fork into several series.

== Inverses are views

The store holds one row per fact. A forward read uses the subject index; a
reverse read uses the object index and names the relation through the
inverse registry built from `REVERSE` claims:

```sql
-- forward: what does X supply?
SELECT object FROM cave_claim WHERE subject = 'la-cima' AND verb = 'SUPPLIES';

-- reverse: who supplies Y? (named SUPPLIED-BY by inverse_of('SUPPLIES'))
SELECT subject FROM cave_claim WHERE object = 'lot/huila-26' AND verb = 'SUPPLIES';
```

Materializing the reverse direction would double every row, split each
belief series in two, and double the work of contradiction resolution.
Keeping inverses lazy costs one index that exists anyway.

== Current belief in SQL

The query that everything else builds on is a join from each claim key to
its newest transaction. As-of reads restrict the inner query to a
transaction boundary; resolution ranks the rows it returns within their
groups; the alias closure is a recursive common-table expression over the
symmetrized `ALIAS` edges:

```sql
SELECT c.* FROM cave_claim c
JOIN (SELECT claim_key, MAX(tx) AS max_tx FROM cave_claim
      WHERE tx <= :boundary GROUP BY claim_key) latest
  ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx;
```

== Schema versions

Every store records an integer schema version in `PRAGMA user_version`.
Version 0 is the unversioned legacy format and version 1 is the current
schema. Opening a store reads the version before anything else. An older
supported store gets each forward migration in ascending order, and each
migration's DDL, data backfill, structural validation, and version advance
share one immediate transaction, so an interruption leaves either the old
version or the complete next one. A store newer than the runtime fails
immediately by name and is never opened on a guess; database sync rejects
such a source for the same reason. A current-version store is validated for
its required tables, indexes, and columns rather than silently repaired.

Migrations are forward-only. Before an upgrade that needs a rollback point,
stop every process using the store, close it, and copy the closed file (or
take a `cave backup`); rolling back means restoring that copy under the
same stopped-writer discipline with a compatible runtime.

#note([Two portable forms], [Canonical text is the interchange format:
readable, diffable, replayable with fresh ids. The exact snapshot from
`cave backup` is the temporal backup: every id, transaction, and side-table
row. Neither is proprietary; both are readable without CAVE.])

#recap[One `cave_claim` table in canonical direction plus context,
provenance, tag, edge, and full-text side tables. A single pipeline
uppercases, resolves renames and inverses, expands continuations, parses
values, stamps provenance, and only then computes the claim key. Reverse
reads are index views, never rows. `user_version` gates forward-only
transactional migrations.]
