# @cavelang/sync

Store merge (spec §28): two append-only CAVE stores become one, by row
identity. The data model pre-solved the hard part — coexisting
contradictions are legal (§9.4), resolved at read time (§26) — so
merging valid replicas has no belief conflicts; this package settles what was left open
(spec §28): transaction semantics across stores.

```ts
import { open } from '@cavelang/store'
import { syncDb } from '@cavelang/cli/sync'

const store = open('main.db')
syncDb(store, 'laptop.db', { from: 'laptop', into: 'main' })
// → { merged: 42, skipped: 108, edges: 17,
//     record: 'store/laptop SYNCED-INTO store/main ; +42 claim(s), +17 edge(s)' }
```

Or from the CLI:

```sh
cave sync --db main.db laptop.db          # store file → merged through SQL
cave export --db laptop.db --tx --max-sensitivity restricted > l.cave
cave sync --db main.db l.cave             # text → replayed under its ids
cave sync --db main.db laptop.db --dry-run --json
```

## What merging means (§28.1–§28.4)

- **The id is the row.** Every append mints one UUIDv7 serving as both
  `id` and `tx`; merge copies rows absent by id *verbatim* (`claim_key`,
  `raw_line`, contexts, tags, FTS) and skips matching rows the target has.
  Idempotent (re-runs merge nothing), transitive (an absorbed store's
  rows travel onward under their own identity), bidirectional (`a ← b`
  then `b ← a` converges), and never re-stamped — merge is interchange
  replay, so §9.5's no-stamp rule applies.
- **One ID must keep one meaning.** Source rows must have equal `id` and `tx`
  containing a canonical lowercase UUIDv7. Invalid identities reject the whole
  source, including dry runs, before copying or receive-clock observation.
  Before copying anything, database sync
  checks overlapping rows' stored claim fields, including transaction, claim
  key, normalized values, contexts, tags, and explicit provenance. Different
  content rejects the whole source, including new lineage edges and the merge
  record. Raw spelling and metadata order may differ; sigma level omitted and
  explicit `2` are equivalent. Inferred provenance added during migration or
  sync is compatible; legacy sources without a dimension table are compared
  through their claim data and contexts. FTS is a derived index, not identity.
  `problems` reports the conflicting IDs with `line: 0` for database sources;
  CLI text and JSON both exit nonzero. Dry runs enforce the same checks.
- **Stored claims are checked before copying.** Sync decodes source history
  with its contexts and tags, checks canonical emission, and recomputes each
  claim key under the same source
  reservation as the copy. Inconsistent payload caches or semantic keys reject
  the merge with row IDs in `problems`, without copying claims, edges or a sync
  record. Preview and real sync apply the same check. Claim decoding uses bounded
  batches and reports invalid rows from the first failing batch; it does not
  repair either store. Malformed historical terms or tag text, including
  embedded line breaks, cannot be copied into a destination that would then
  fail canonical export. Diagnostics identify rows without printing their
  contents. Correct the source and retry.
- **Source relationships must be complete.** Contexts, tags and explicit
  provenance must reference claims present in the source; both endpoints of
  every source edge must also be present there. A matching claim in the target
  cannot fill a missing source endpoint. Preview and real sync reject dangling
  references with a table-level problem before copying or discarding metadata,
  leave both stores unchanged, and permit a retry after source repair.
  These checks inspect references directly, including accepted version-zero
  sources whose side tables have no declared foreign keys. Repairing the
  references permits normal merge and idempotent retry without requiring sync
  to rewrite the source schema.
  Source edge roles must be `WHEN`, `VIA`, `BECAUSE` or `QUALIFIES`. Unsupported
  roles reject the source before copying, with a redacted edge-role problem;
  correcting the role permits normal merge and canonical export.
- **Malformed provenance is rejected before copying.** A present source
  provenance table must contain nonempty text values in its dimensions. Empty
  or binary values reject the entire source with row IDs in `problems` at
  `line: 0`, including dry runs. Claims, edges, vocabulary and merge records
  remain unchanged in the target. Correcting the source permits preview and
  idempotent retry; sync does not repair the source. Legacy sources without a
  provenance table retain their context-based inference.
- **Retention travels with identity.** Sync copies retained rows verbatim,
  including retracted history and authored raw text. There is no selective
  forgetting protocol or tombstone (§9.6); never sync an affected store into
  a reviewed replacement after accidental sensitive-data ingestion.
- **Sync is exact, not audience-filtered.** It preserves every row's §9.7
  sensitivity label and does not enforce a publication ceiling. Producing a
  annotated export of every claim therefore requires
  `cave export --tx --max-sensitivity restricted`; lower ceilings intentionally
  create partial views that must not be treated as full replicas.
- **The receive rule.** Opening a store observes its `MAX(tx)`; merging
  observes the merged maximum — the UUIDv7 generator never mints below
  what it observed, so *everything appended after a merge outsorts
  everything merged*, whatever the origin clocks read. Merged history
  itself interleaves by origin wall clock, stated honestly: cross-machine
  recency is physical time; where trust should outrank recency, that is
  the §26 precedence policy, not tx.
- **Merge events are claims.** An effective merge appends
  `store/<from> SYNCED-INTO store/<into> @src:sync ; +N claim(s), +M edge(s)`
  (declaring `SYNCED-INTO IS verb` in-band on first use) — one claim key
  per (origin, target) pair whose belief series is the sync log. A merge
  that changed nothing appends nothing. Declaration detection uses the store's
  verb registry: a `SYNCED-INTO IS verb` condition under `WHEN`, `VIA` or
  `BECAUSE` does not suppress the top-level declaration. Dry runs roll back
  both that declaration and the merge event.
- **Text carries identity via transaction annotations.** `cave export
  --tx` precedes every claim line with a `;@ <tx>` comment at matching
  indentation. Comment lines are transparent to the grammar, so every
  existing reader takes the file unchanged and plain `cave import`
  degrades to an ordinary tx-less replay; `syncText` replays each line
  under its recorded id — and is strict about it (every claim annotated,
  no orphaned annotations, no id repeated with different content),
  because a half-annotated file would merge half idempotently and
  duplicate the rest. In strict sync, a line beginning with `;@` after optional
  indentation must be a valid annotation, even beside other valid annotations.
  Write ordinary comment prose beginning with `@` as `; @...`, with a space
  after the semicolon; malformed annotation-shaped lines reject the whole merge.
  Canonical export already inserts that space for ordinary comments, including
  comment text that resembles a transaction annotation. Such comments retain
  their text and history through annotated export and replay.
- **Re-statements make the tree carry the graph.** A row cited by
  several parents — a premise shared by two derivations, the `VIA` rule
  row every derivation of one rule shares (§24.3), a §24.5 support
  cycle — renders its children once and thereafter re-appears as the
  claim line alone under each citing parent, same `;@` id. On replay an
  identical repeat unions back into one row, each statement contributing
  its edge; a conflicting repeat rejects the file whole.
- **Text replay checks existing identities too.** Before copying rows or
  edges, every incoming ID already present in the target must match its
  canonical interchange content, preserving full stored confidence precision.
  This includes positive subnormal confidence before and after a zero-confidence
  retraction; repeat delivery preserves the three distinct history rows without
  adding duplicates. Different content rejects the whole file,
  preventing a new lineage edge from citing an existing row under a different
  meaning. Authored raw spelling and metadata ordering do not define this
  comparison; equivalent canonical restatements may add legitimate edges.
  Reordering Unicode tag names or values is also harmless, including distinct
  strings that sort equally in a locale. Replay preserves those distinct strings;
  it does not normalize them into one tag. Changing a tag value for an existing
  ID is still a conflict, and rejects the entire incoming batch, including any
  otherwise-valid new rows in it.

Annotated export preserves explicit provenance in an optional same-line payload:
` ;@ <uuid> {"provenance":{"actors":[],"sources":["manual"],"runs":[],"domains":[]}}`.
All four arrays are required, contain nonempty strings, and act as sets. The
payload appears only when contexts cannot reconstruct the stored dimensions.
Replay validates the whole file first, compares explicit dimensions against
existing identities, and installs exact dimensions only on new rows. Empty
arrays suppress inference; bare legacy annotations retain it. Unpaired Unicode
surrogates decoded from JSON escapes reject the whole input before copying,
including dry runs; valid Unicode and embedded NUL identities remain intact.
Unknown keys,
invalid JSON, or conflicting restatements reject the source. Plain imports
ignore metadata; older sync readers must upgrade to replay extended annotations.
Database sync preserves a present provenance table exactly and infers dimensions
only for unversioned legacy sources without that table. Legacy context collection
appends to one array per claim, avoiding repeated copies of earlier contexts
when a claim carries many source labels. Regression coverage checks 5,000 source
contexts, a context-free claim, dry-run rollback and idempotent retry.
Supported versioned
sources are validated against their recorded schema before copying, even when
they predate the current schema. Missing required provenance structure is an
error, not permission to infer replacement metadata. Validation does not upgrade
the source, and rejection releases the attachment without changing the target.

Database-file sync owns its transaction and attachment lifecycle. Calling
`syncDb` (or `syncFile` for a database source) inside a caller-owned transaction
rejects before attaching or copying, including dry runs: SQLite cannot detach
a source read by the still-open outer transaction. Run it after the caller
commits, or use `syncText` with a complete annotated export when the merge must
participate in the caller's commit or rollback. Syncing a database to itself
remains a no-op, including symbolic links and hard links to the same file. File
identity is checked before SQLite attachment, avoiding a second attachment to
the database already open as the target.

Source-schema validation errors include the source filename and preserve the
original failure as `cause`. If that failure cannot be formatted, the message
uses `[unprintable thrown value]`. Validation failure occurs before row copying;
the source attachment still enters cleanup, including in dry runs.

Database sync attempts temporary-table cleanup inside its merge transaction and
source detach after the transaction settles. If an operation and cleanup both
throw, an `AggregateError` retains the operation first and as `cause`, with both
messages. Nested failures preserve the merge/drop error pair inside the outer
error paired with detach; a lone error retains its identity. If a thrown value's
message getter or string conversion throws, the combined message uses
`[unprintable thrown value]` and retains the original value in the nested error
structure. This applies to both normal merges and dry runs. Cleanup failures
inside the transaction trigger rollback. A detach-only failure after a successful
non-dry merge does not undo the committed merge. The caller still owns its open
target store. Cleanup attempts do not guarantee release when SQLite itself
refuses a drop or detach; resolve that failure before retrying on the same handle.

All three sync entrypoints require boolean `dryRun` and `record` options when
supplied. Omission means `dryRun: false` and `record: true`. Strings, null and
other values throw before merging; file sync validates them before reading the
source. Use `dryRun: true` for a preview and `record: false` to omit sync bookkeeping.

Text sync captures its dry-run decision once before entering the transaction.
That same decision controls rollback and the returned report, including when
the caller supplies a getter-backed option.
`syncFile` explicitly captures all four declared options before choosing a source
reader, preserving inherited and non-enumerable options. A dry-run request
therefore remains a preview for both database and annotated-text files.
Both direct sync entrypoints capture the merge-record choice and source/target
labels before transaction work. SQLite callbacks that mutate the caller's
options during insertion cannot omit or redirect the requested merge record.

The merge record belongs to the same transaction as copied claims, lineage and
provenance. If its insertion fails, those writes and vocabulary changes roll
back together, including during a dry run. Database sync releases its source
attachment and temporary table before returning the error, so the same target
can retry after the cause is removed.
This also applies to an incremental merge containing only new lineage edges
between already stored claims. A rejected merge record leaves those edges
unmerged; retry copies the edges, reports zero new claims, and records the
effective merge. Repeating it adds neither edges nor another merge record.
The content-detecting file entry point has the same recovery boundary: malformed
SQLite files, unannotated claims and invalid transaction annotations leave a
populated target's annotated history unchanged. Correcting the input at the
same path permits a fresh preview or merge; repeating a successful merge is
still an unchanged-input skip.

Merge-record labels normalize whitespace, comment and metadata markers, double
quotes, backticks and attribute colons to hyphens. For example, `team:blue`
becomes `team-blue`, so the colon cannot turn the destination into an attribute.
This keeps each label in its entity token and preserves the merge-count comment;
these characters in a source filename or an explicit
`--as`/`--into` label cannot change the recorded destination.
Valid Unicode labels, including emoji and explicit replacement characters,
remain unchanged. A label containing an unpaired UTF-16 surrogate cannot be
stored as UTF-8: recording the merge throws and rolls back the merge and its
vocabulary changes. Correct the label and retry; the source claims remain
available to merge normally.

The merge record uses the store's ordinary vocabulary after imported declarations
have been loaded. If `SYNCED-INTO` is declared as a reverse spelling, its stored
row uses the forward verb with swapped endpoints; queries in the original
`origin SYNCED-INTO target` direction still match. The report displays that
original direction. This is normal canonicalization, and an unchanged repeat
still appends no record.

Database sync reserves the target and attached source for its validation and
copy transaction. Concurrent source writers follow their SQLite busy timeout
and may receive a database-locked error until that reservation is released.
This prevents a writer from changing source rows between identity checks and
copying. Both real merges and dry runs release the reservation and detach the
source when finished; later source writes can then be merged normally. The
regression covers WAL and rollback-journal databases, unchanged dry-run targets,
and an idempotent retry after a subsequent source write.

Annotated-text sync reserves its write transaction before refreshing vocabulary,
canonicalizing text, or validating annotations. Validation and replay therefore
use the same vocabulary snapshot, including declarations committed by another
writer before the reservation. Dry runs roll back both merged rows and the
registry refresh, and preserve the UUID generator state.

Text replay uses the store's version-aware vocabulary cache under that reservation.
Peer commits refresh it, including new inverse and renamed spellings; unchanged
local vocabulary avoids a full declaration-history replay. Database sync still
explicitly rebuilds the registry after its direct SQL copies and edge insertion.
In the isolated `scripts/text-sync-registry-bench.mjs` fixture, repeating one
already-stored fact against 3,000 unrelated declarations took a five-sample median
of 32.70 → 0.051 ms on Node 24 and 22.55 → 0.052 ms on Node 26. Fixture setup and
history-equality assertions run outside timing. This measures a small unchanged
text replay, not large-import or database-sync throughput.

The same fact recorded independently on both machines arrives as two
rows in one belief series — asserted twice, which is what happened.
Query semantics do not change: current belief is still latest-tx per
key, `--as-of` reconstructs across merged history, and `--resolve`
arbitrates cross-actor contests exactly as within one store.

Text replay caches stored identity comparisons within its reserved validation
transaction, including missing identities. Repeated references still validate
every occurrence's content and provenance; the cache is discarded before the
next sync call. This avoids repeated database reads and canonical rendering of
the same stored row, at the cost of comparison state proportional to the unique
identities in the input. It does not impose an overall replay memory budget.

A local comparison of 5,000 existing claim occurrences used six alternating
before/after pairs, discarding the first pair as warm-up. Setup and final-state
verification were outside the timed replay; both versions preserved the same
annotated export. Median milliseconds on macOS arm64 were:

| Runtime | Input | Before caching | With caching |
|---|---|---:|---:|
| Node 24.21.0 | 5,000 unique identities | 227.0 | 226.5 |
| Node 24.21.0 | 5,000 references to one identity | 214.1 | 100.6 |
| Node 26.8.1 | 5,000 unique identities | 223.4 | 217.1 |
| Node 26.8.1 | 5,000 references to one identity | 212.3 | 93.9 |

The repeated-reference benefit is visible on both runtimes; the unique-input
results are similar within these local timings. This measures replay of existing
rows with explicit provenance, not new-row insertion, arbitrary graph shapes or
peak memory, and is not a general performance guarantee.


## Branching (§28.6)

The convention that turns these mechanics into a review workflow: the
**text is the store** — commit the full annotated export, never the
SQLite file — and a branch is a git branch plus a private store rebuilt
from it:

```sh
cave export --db main.db --tx --max-sensitivity restricted --out knowledge.cave
git switch -c reorg-auth
cave sync --db work.db knowledge.cave --no-record      # checkout: plumbing, no record
cave add --db work.db …                                # ordinary appends
cave export --db work.db --tx --max-sensitivity restricted --out knowledge.cave
```

Rows are immutable and their `;@` identities remain, so review the new
annotations as the semantic additions. Physical lines can also change when
terse canonical output factors an old and new adjacent row through a shared
prefix, or when a derivation moves a cited premise into its indented block. A
valid replica has no belief conflicts; a *text* merge can, and the answer is
never to hand-merge: sync both sides into a fresh store and re-export the
union — configurable as a git merge driver
(`.gitattributes`: `*.cave merge=cave`):

```ini
[merge "cave"]
	name = CAVE store union
	driver = "sh -euc 't=$(mktemp -d); cleanup() { rm -rf \"$t\"; }; trap cleanup 0; cave sync --db \"$t/m.db\" \"$1\" --no-record >/dev/null; cave sync --db \"$t/m.db\" \"$2\" --no-record >/dev/null; cave export --db \"$t/m.db\" --tx --max-sensitivity restricted --out \"$1\"' - \"%A\" \"%B\""
```

The driver value is quoted for Git's configuration parser; its escaped quotes
then protect shell paths, including a temporary directory containing spaces.
The exit trap removes that directory on success or failure. Both input syncs
must succeed before export replaces our side, so invalid incoming annotations
leave our input unchanged and report a failed merge to Git.
The final `export --out` stages and flushes its output before replacement, so
an output write failure also preserves our input.
The CLI regression suite exercises this configuration in temporary Git
repositories: valid divergent branches produce a merge commit preserving the
union of claim IDs; invalid incoming text leaves Git's conflict stages unresolved.

Landing is a sync — `cave sync --db main.db knowledge.cave --as
reorg-auth` — and this one is a real merge event: let it record. The
honest cost: every branch is a full copy of the store; fine at CAVE's
scale, and stated rather than hidden.

## API

- `syncDb(store, sourcePath, options?)` — merge a store file (SQL
  `ATTACH`, one transaction).
- `syncText(store, text, options?)` — merge §28.4 annotated canonical
  text (ordinary canonicalization pipeline, explicit ids).
- `syncFile(store, sourcePath, options?)` — sniff the SQLite header and
  route; origin label defaults to the file's basename stem.
- Options: `from` / `into` (record labels), `record: false` (skip the
  merge record), `dryRun` (full report inside a rolled-back transaction,
  without advancing the process UUID clock). Reports:
  `{ merged, skipped, edges, dryRun, record?, problems }`.

Callers must handle both reported problems and thrown errors.

| Outcome | How to handle it |
| --- | --- |
| Report with `problems` | Zero merge counts and no record mean the rejected content did not change target history. Correct the source. |
| Operation exception | File, decoding or database errors may leave CLI JSON stdout empty. Read the diagnostic before retrying. |
| Cleanup failure | A nonzero CLI status can follow a committed merge. Inspect the report and stored history. |

Invalid text syntax, annotations and conflicting row identities return a report with nonempty
`problems`, zero merge counts and no record; the source is rejected as a whole.
Parser diagnostics append iteratively, so large malformed sources do not exceed
JavaScript's function-argument limit. A 130,000-error regression checks full
source line reporting and atomic rejection in both merge and preview modes,
followed by corrected, idempotent replay. Input and diagnostics remain in memory.
File access, UTF-8 decoding, incompatible database schemas and SQL execution
failures throw instead of returning a report. A returned report alone therefore
does not imply success: check `problems` before treating the merge as accepted.
These failure paths also apply to `dryRun`; previewing does not suppress errors.
For an initialized destination, the same history-preservation behavior applies
with the CLI's default verb registry. The standard prelude supplies an in-memory canonicalization base;
`--no-prelude` selects an empty base registry. It is a vocabulary choice, and
is not required to preserve history after a rejected sync source.
For `cave sync --json`, accepted reports and rejected claim/annotation content
are JSON on stdout; inspect both the exit status and `problems`. A source-access,
UTF-8, database or other operation error before a report is produced exits nonzero with a diagnostic
on stderr and empty stdout. `--json` does not wrap thrown errors in a JSON report.
Automation must handle that empty-output path before parsing JSON. These rules
also apply to `--dry-run`; fixing the source permits preview and retry.
If final store closure fails after a report is produced, stdout retains that
JSON, stderr adds the cleanup diagnostic, and status is nonzero. A completed
merge may already be committed even when the command exits with a failure.
Database attachment and initial schema-inspection failures retain their original
exception as `cause` and include its safely formatted diagnostic. A valid source
held under an exclusive lock is therefore reported as a locked source, rather
than incorrectly classified as a non-SQLite file. A missing `cave_claim` table
still has its separate not-a-CAVE-store diagnostic. Busy sources reject the
merge without copying rows or recording an event; after the competing
transaction ends, the same target can preview and retry normally. Regression
checks also verify that a failed reservation releases the target for writes
while the competing source transaction remains open.

Text files passed to `syncFile` must be valid UTF-8. Invalid byte sequences throw
a source-located error before parsing or merging, including in dry runs, so a
transaction identity cannot be paired with silently repaired claim text. Existing
target history stays unchanged and a corrected file can be previewed and merged
normally. SQLite sources continue through the binary database path.

Sync is an operator surface, deliberately not served over MCP: store
files are machine-local paths, and an agent's write surface stays the
governed §25 vocabulary.
