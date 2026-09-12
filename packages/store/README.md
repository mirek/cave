# @cavelang/store

CAVE persistence through an explicit synchronous SQLite adapter. The default
Node entry uses the builtin `node:sqlite` with no native dependencies; browser
runtimes can inject a WASM implementation. Implements the spec §13 storage model: the exact §13.1/§13.2
schema (`cave_claim`, `cave_context`, `cave_provenance`, `cave_tag`, `cave_edge`, `cave_fts`
full-text index), append-only belief series, and inverse-aware reads.

```ts
import { open } from '@cavelang/store'

const store = open('knowledge.db')          // or open() for in-memory
store.ingest(`
packages/api PART-OF monorepo @ 50%
monorepo CONTAINS packages/api @ 90%
`)
store.currentBeliefs()                       // one row — one fact, one key, conf 0.9
store.reverse('packages/api')                // [{ verb: 'CONTAINS', rel: 'PART-OF', source: 'monorepo' }]
store.exportText({ current: true })          // canonical text through internal
store.exportText({ maxSensitivity: 'restricted' }) // complete portable history
```

The native runtime requires Node 24.16.0+ within 24.x or 26.1.0+ within
26.x. Older bindings, including Node 22, truncate returned TEXT at embedded
NUL characters even though SQLite retains all stored bytes. The adapter checks
text decoding once before opening any caller database and rejects a truncating
runtime with an upgrade message. It neither strips characters nor rewrites
stored identities. `node scripts/check-sqlite-text.mjs` isolates the native
round-trip independently of CAVE.
Probe verification is cached only after both decoding and probe close succeed.
A failed attempt leaves caller database paths unopened and runs the probe again
on the next attempt. Simultaneous probe-read and close failures are retained in
`AggregateError`, with the read error as cause and first entry; a close-only
failure propagates directly. Each created probe receives one close attempt.

Claim appends require well-formed Unicode strings. `ingest` and `insertResult`
reject an unpaired UTF-16 surrogate with `TypeError` rather than letting SQLite's
UTF-8 conversion silently replace it with `�`. The batch preflight checks claim
columns, raw text, contexts, tags and explicit provenance before allocating or
observing transaction IDs; rows and vocabulary remain unchanged on rejection.
This storage check also applies to lenient ingestion and the browser adapter.
Valid surrogate pairs (including emoji), accented text and embedded NUL remain
supported. Direct SQL through the exposed database handle is outside this
claim-append validation path.

Direct search and lookup arguments also reject unpaired surrogates with
`TypeError` before SQLite binding. This covers entity and alias traversal,
topics, tags, contexts, provenance and belief-key lookups, as well as provenance
and edge reads by ID. Invalid text cannot silently select a record containing
`�`; explicitly authored replacement characters remain valid lookup text.
Search validates malformed Unicode even with a zero result limit or raw full-text
syntax. Rejected reads leave history unchanged and subsequent valid reads work
on both native and browser adapters. Direct SQL remains outside this validation.

The upstream byte-length conversion is in
[Node PR #61954](https://github.com/nodejs/node/pull/61954), shipped in
[Node 24.16.0](https://nodejs.org/en/blog/release/v24.16.0) and
[Node 26.1.0](https://nodejs.org/en/blog/release/v26.1.0). Boundary-runtime
checks reproduce truncation on 24.0.0 and 26.0.0 and preserve complete text on
24.16.0 and 26.1.0. A general SQL rewriting adapter was not introduced: it would
need to preserve arbitrary result types, duplicate column names and statement
semantics to avoid creating a second compatibility problem.

Runtime selection is explicit at non-Node composition boundaries:

```ts
import { openWith, type SqliteAdapter } from '@cavelang/store/adapter'

declare const adapter: SqliteAdapter
const store = openWith(adapter, ':memory:')
```

Adapter result columns remain own data properties even when their names are
`__proto__`, `constructor` or `toString`. Repeated output names retain the last
column value. The shared native/WASM contract checks `get`, `all` and JSON
serialization so adapter composition does not silently lose named results.

`SqliteAdapter` declares the SQL statement surface plus immediate/savepoint
transactions, FTS4 or FTS5, optional extension loading, and optional exact
snapshot support. The concrete Node adapter is also available from
`@cavelang/store/adapter/node`. The shared adapter contract suite runs against
both Node SQLite and the website's SQL.js/WASM adapter.
Statement `run()` discards result rows and completes the statement before
reporting `changes` and `lastInsertRowid`, including writes with a `RETURNING`
clause. Use `all()` or `get()` when the returned rows themselves are needed.
Each statement call supplies fresh positional bindings: omitted parameters are
`NULL`, and excess parameters fail before a write executes. The shared contract
checks reuse after failure and preserves empty and binary blobs independently
of later changes to the caller's input buffer.

## Resource lifecycle

`ingest.strict` must be a boolean when supplied and is captured before parsing;
malformed flags cannot fall back to a partial, lenient import. The shared append
`lifecycle` flag on `ingest` and `insertResult` likewise requires a boolean,
captured before claims are appended. Omitted flags remain false.

Append operations capture replay IDs, contexts, source/lifecycle settings and
provenance fields before preparing a batch, copying their arrays. Changing
getters cannot substitute an unvalidated replay ID or change metadata between
claims in that batch.
Identity allocation and row insertion iterate the prepared claims, so a changing
claim-collection getter cannot replace or discard the batch after preparation.
Canonical-result edges also capture their parent index, role and child index
before insertion, so replay duplicate checks and writes use the same fields.
Claims capture their declared fields and nested terms, values, contexts and tags
before storage projections are derived. Columns, emitted text and semantic keys
therefore use the same values even when structured input contains getters.

Combined operation/cleanup errors retain each underlying diagnostic in their
message as well as in `AggregateError.errors`. This applies to transaction
rollback, final store cleanup, file descriptors, native text probes and backup
verification/removal. Backup cleanup errors retain the temporary path and any
already-published destination status. Existing causes and lone-error identities
are preserved, so message-only CLI output and programmatic inspection both carry
the failure details. If a thrown value cannot be converted to text, its message
uses `[unprintable thrown value]`; the original value remains available in
`AggregateError.errors`.

Call `store.close()` when finished. Components that retain resources derived
from a store can register synchronous cleanup with `store.onClose(callback)`;
the returned function unregisters only that registration. Registering the same
callback more than once creates independent subscriptions; calling one unsubscribe
function repeatedly is harmless. Cleanup runs before the SQLite connection closes, and reentrant or repeated successful closes do not repeat it.
Registering cleanup during or after a successful close throws. Returning a
Promise or thenable reports a synchronous-cleanup error; it is not awaited.
Native Promise rejection is observed without invoking a custom thenable's work,
and remaining cleanup callbacks and the database close are still attempted.
This cannot cancel work already started by the callback; callers must finish
asynchronous work before closing the store.

Every registered callback and the database close are attempted even if cleanup
throws. A single error is rethrown; multiple errors are reported in an
`AggregateError`. If the database close itself fails, another `close()` retries
it without repeating callbacks that were already attempted. Closing the raw
`store.db` bypasses store-owned cleanup; use `store.close()` for normal ownership.
Combined callback and database-close failures retain callback errors first and
the database error last. A failed database close leaves cleanup registration
available for the retry; newly registered callbacks run once on that retry.

## Composable query SQL

`QuerySql` is the public source of truth for semantics shared by store,
CAVE-Q, shapes, generated clients, and views:

```ts
import { QuerySql } from '@cavelang/store'

const boundary = QuerySql.asOfBoundary('2026-07-16')!
const currentThen = QuerySql.current(QuerySql.claims(boundary))
const rows = store.db.prepare(`SELECT * FROM (${currentThen}) WHERE conf > 0`).all()
```

`current()` selects latest tx per claim key without filtering negation or
retraction; consumers add those predicates for their read mode. `aliasEdges`,
`aliasPairs`, `aliasClosure`, and `aliasSame` implement entity-only current
positive ALIAS semantics. `transactionBounds` and `asOfBoundary` use
`Time.parseBoundary` for shared whole-period/whole-second semantics
(offset-less timestamps are UTC) and exact-transaction rules. Transaction periods
are clipped at the Unix epoch: wholly earlier periods are empty, while periods
crossing 1970-01-01 retain their overlap with UUID transaction time. Fragments own no
ordering or outer filtering, so consumers can extend them without copying
semantic clauses.

## External records

Database rows (`Row.t`, snake_case columns) are the storage-oriented API and
may evolve with the schema. Use `store.recordOf(row)` for serialized or
cross-process data. It returns `cave.claim/v1`: transaction identity (`id`,
`tx`, `key`), canonical CAVE text, the semantic `Claim.t`, and explicit
provenance dimensions. `Record.encode`/`Record.decode` own the JSON contract.
Record construction and decoding require `id = tx` as one canonical lowercase
UUIDv7. This matches append and sync identity (§28.1). Both also recompute
the claim key, including its context set, and reject disagreement with the stored
or supplied key. Construction captures `id`, `tx` and `claim_key` once. The
decoder additionally compares emitted canonical text with the supplied text.
Construction captures and validates provenance before returning a record,
rejecting empty or malformed entries and unknown dimensions. This also rejects
empty or binary historical provenance read through `store.recordOf(row)`;
repairing that data permits structured JSON encode/decode again. Its captured arrays
preserve valid ordering and duplicates and are independent of the caller's
provenance arrays. It likewise captures the semantic claim before computing its
key and canonical text. Construction and decoding share the claim field checks,
including boolean flags, raw text, terms, payloads and optional metadata. Invalid
programmatic claims are rejected before a record is returned. Claim getters are
read during capture and later edits
to caller-owned terms, values, contexts or tags cannot invalidate the returned
record. Constructor claim and provenance inputs must be structured-cloneable.
It operates on the
record alone, without consulting a store. Use `store.recordOf(row)` on a row
from the intended store when you need that store's evidence.

Object input is structured-cloned before validation, so decoded nested values
are independent of caller-owned arrays and objects. Enumerable getters are read
during capture; validation and the returned record use that captured data.
Object inputs must be structured-cloneable data; functions and proxies are not
accepted. JSON text is parsed into independently owned data directly. The result
is not frozen, so callers can still deliberately edit their decoded copy.

Construction and decoding apply these field checks before accepting the record:

| Field | Required representation |
|---|---|
| Format and version | `cave.claim`, version `1`; unknown versions are rejected. |
| Claim flags and authored text | Boolean `negated` and `importance`; string `raw`. |
| Subject and relation object | Term kind `entity`, `text` or `code`, with string `text`. |
| Payload | Kind `relation`, `attribute`, `metric` or `none`; attributes have string names. |
| Attribute, metric and uncertainty values | Supported value kind, string `raw`, Boolean `approx`; supplied units are strings and numeric scalars/endpoints are finite numbers. |
| Contexts | Dense arrays of strings; empty arrays are valid. |
| Provenance | Exactly the four enumerable own dimension fields, containing dense arrays of nonempty strings without unpaired UTF-16 surrogates; empty arrays are valid. |
| Tags | Objects with string `key` and optional string `value`; flat tags omit `value`. |
| Optional sigma level | Positive finite number; canonical export preserves tiny and large magnitudes as plain decimals. |
| Optional comment | String. |

Record provenance uses the same validation as `Provenance.parse`, while retaining
the order and duplicates of valid input arrays. Array holes, empty or non-string
entries, malformed Unicode and unknown dimensions are rejected for both object
and JSON input. Matching canonical text cannot compensate for malformed field
types. Attribute, metric and uncertainty values are reparsed from `raw` with
the core value parser (or the text/code literal constructor). Their kind,
approximation, numeric scalar, trajectory endpoints and unit must agree with
that result. Numeric projections remain absent when parsing cannot represent
the authored number as a finite JavaScript number. Provenance dimensions are
validated structurally rather than derived from contexts.
Uncertainty deltas additionally require a positive finite scalar, matching the
authored `+/-` rule; zero, negative values, trajectories and literals are rejected.
The checked-in v1 fixture is the compatibility baseline for
future decoders.

## Text stores

`openAt(path, { intent })` opens what a `--db` path names, by content (spec
§13.7): a SQLite file, `:memory:` fresh, and any other file as CAVE text
replayed into an in-memory store with `cave import` semantics — no actor
stamp, so the claims are the ones importing the file would store. Transaction
IDs and provenance payloads in annotations are ignored under these import
semantics; use `cave sync` to materialize an annotated replica. `intent:
'read'` never touches the filesystem: SQLite opens read-only (a
write-protected store serves), an older schema is reported with the command
that migrates it instead of being migrated, and a missing path throws instead
of creating a database. The only files SQLite may still create are the `-wal`
and `-shm` sidecars of a store an operator switched to WAL journaling, which
readers and writers need to coordinate; an `immutable` open would avoid them
only by risking stale reads under a concurrent writer. `intent: 'scratch'` is for dry runs that append inside
a rolled-back transaction: writable, but it creates and migrates nothing
either. `intent: 'write'` (the default) creates a missing SQLite store,
migrates an older one, and throws on a text file with the materialization
hint, since nothing appended in memory would outlive the process. A text file
with a line that fails to parse fails the load, naming every line.
Text-store files must also be valid UTF-8. Invalid bytes raise `LocateError`
before an in-memory store is created or the assembler runs, rather than silently
changing claim text during decoding. The source file stays untouched; correcting
it allows normal replay, including explicit replacement characters and emoji.
If replay or source assembly fails after the in-memory store opens, that store
is closed before the failure is returned. If its cleanup also throws, an
`AggregateError` retains the load failure as cause and first entry and the
cleanup failure second. Both appear in the diagnostic, with unprintable values
retained in the error entries. Correcting assembly permits a fresh load; the
source text file is never rewritten by this cleanup.
`kindOf(path)` returns `memory | sqlite | text | missing`, `isStoreFile(path)`
is the SQLite-header check, `openText(path)` replays a text file directly, and
`open(path, { access })` exposes the same `read-only | no-migrate | migrate`
choice to callers that already know the file is SQLite.
Direct opens require access to be `read-only`, `no-migrate` or `migrate`.
Unsupported values, including `null`, throw `TypeError` before calling the
SQLite adapter; they cannot silently open a writable connection. An omitted
or `undefined` access retains the `migrate` default.
`openAt` captures its declared options explicitly, including inherited and
non-enumerable properties. A supplied base registry reaches memory, SQLite,
text and newly created stores; an assembly callback runs for text stores only.
Option storage style does not silently remove vocabulary or source assembly.
An explicitly supplied intent must be `read`, `scratch` or `write`; unsupported
values throw `TypeError` before file detection, opening or assembly. They are
not coerced into a mode. An omitted or `undefined` intent retains the `write`
default. Correct the intent and retry without changing the source store.
Header detection accumulates short reads until all 16 SQLite signature bytes
are available or EOF is reached. An incomplete signature is treated as text;
a complete signature still identifies SQLite regardless of the filename.
Header detection attempts descriptor close once. If reading and closing both
fail, an `AggregateError` preserves the read error as cause and first entry and
the close error second; a close-only failure propagates directly. Detection does
not classify the file or open a database after either failure. Snapshot hashing,
file syncing, and header detection share this descriptor ownership contract.

```ts
import { openAt } from '@cavelang/store'

const notes = openAt('notes.cave', { intent: 'read' })
notes.currentBeliefs()                       // the file's claims, assembled in memory
```

## Semantics

- **Schema upgrades are explicit** (§13.2.1): `PRAGMA user_version` records
  the local format (current version 2; version 0 is the unversioned legacy
  baseline). `open()` rejects newer stores, applies every older migration in
  order with its backfill and version update in one `BEGIN IMMEDIATE`
  transaction, then validates required tables, indexes, and columns (a view
  with matching columns cannot substitute for a required table, and the search
  index must be a virtual table exposing the hidden FTS search column).
  Validation also requires the `cave_claim(id)` primary key and the ordered
  `cave_provenance(claim_id, dimension, value)` primary key, with binary
  comparison for every key column. Case-insensitive or trailing-space-insensitive
  keys can collapse distinct provenance values; matching column names alone do
  not guarantee claim identity or provenance deduplication. Required secondary
  indexes must belong to the expected table, cover the ordered columns with
  binary collation, and be non-unique and non-partial. A same-named unique
  subject index, for example, would prevent ordinary claims about one subject.
  Required text fields in ordinary tables must have SQLite TEXT affinity;
  equivalent declarations such as `VARCHAR` and `CLOB` are accepted. Numeric
  affinity can turn source identities `001` and `1` into the same integer and
  silently deduplicate them. This check excludes virtual FTS columns and does
  not validate the types of individual historical rows.
  Numeric claim fields must have INTEGER, REAL or NUMERIC affinity. TEXT or
  untyped/BLOB declarations can change range-comparison semantics; for example,
  a text-affinity numeric projection can exclude 10 from `value_num > 3`.
  Compatible numeric declarations retain fractional values and numeric ordering.
  For STRICT tables, fraction-bearing `value_num`, `delta_num`, `sigma_level`
  and `conf` fields must be REAL: STRICT INTEGER fields reject fractional
  writes. STRICT ANY has no numeric coercion and is not a compatible numeric
  declaration. The standard generated schema remains non-STRICT.
  Validation reports the incompatible definition instead of silently replacing
  it. With
  `access: 'read-only'` or `'no-migrate'` it validates only and reports an
  older version instead of migrating it. A crash
  leaves a resumable old or complete new version—never a committed half-step.
  Migration errors identify the version step and retain the original failure
  in `Error.cause`. Unprintable adapter failures use a safe placeholder after
  rollback is attempted, preserving the cause for inspection and retry.
  If rollback also throws, an `AggregateError` retains the migration and rollback
  failures in that order, with the migration failure as its cause. This includes
  SQLite reporting that it already rolled back; a combined error alone does not
  mean the transaction remains active. Direct `Schema.init` callers own recovery
  or closure of their connection; a failed `open()` closes its owned database.
  Migrations are forward-only; make rollback points by closing all users and
  copying the closed SQLite file before upgrade.
  Version 2 adds `idx_cave_tx` on `cave_claim(tx)` for global and bounded
  transaction-head reads. The 1→2 migration preserves claims and metadata;
  read-only and no-migrate opens of version 1 report the required upgrade.
- **Exact backup is an online SQLite snapshot** (§13.2.2): `backup()` runs
  `VACUUM INTO` to a temporary sibling, verifies integrity, foreign keys and
  schema, fsyncs it, computes SHA-256, and atomically publishes it. WAL-visible
  committed rows and concurrent readers/writers are safe. `restoreBackup()`
  verifies the source and temporary copy before atomic publication and refuses
  destination WAL/SHM/journal sidecars. `verifyBackup()` supports independent checks.
  This verification covers SQLite structure, schema and the supplied checksum.
  A structurally valid snapshot can preserve semantic damage, including an
  inconsistent claim key or empty provenance value. That permits an exact copy
  to be retained before diagnosis and repair. Run `cave doctor` on the restored
  copy to check semantic health before using it for export or sync; repairing
  the copy leaves the original source and snapshot unchanged.
  Expected SHA-256 values must be exactly 64 hexadecimal characters, with either
  letter case accepted. Verification and restore validate them before inspecting
  source or destination paths; whitespace, including a trailing newline, is invalid.
  Verification attempts database close once. If validation and close both fail,
  an `AggregateError` retains validation as its cause and first entry and close
  failure second; a close-only failure propagates directly. Failed verification
  does not return checksum metadata or authorize publication. Hashing and file
  syncing also attempt descriptor close once and preserve simultaneous operation
  and close failures in an `AggregateError`, with the operation error first and
  as cause. A descriptor-close failure alone propagates directly.
  If backup or restore fails and temporary-file removal also fails, both errors
  are retained in the same order, with the operation failure as cause. The error
  message names the temporary path for cleanup after resolving the filesystem
  problem. Failure before publication preserves an existing destination; a
  failed removal can leave the temporary file behind.
  If atomic publication succeeds but subsequent cleanup throws, the error says
  `snapshot published to <destination>` and retains the cleanup error as its
  cause. Its message also includes the underlying failure details, including both
  errors if directory synchronization and descriptor closure fail together.
  The new snapshot remains at that destination; the operation does not
  roll publication back. Verify that destination before deciding whether to
  retry. If the outer temporary-removal attempt also fails, its aggregate error
  includes the publication diagnostic in its message and retains it as the
  operation cause.
  Directory synchronization tolerates unsupported-operation errors (`EINVAL`,
  `ENOTSUP`, `ENOSYS`), Windows directory-open restrictions (`EPERM`, `EACCES`,
  `EISDIR`) and sync `EPERM`, and AIX read-only-directory sync `EBADF`.
  Other directory-open/sync errors, including `EIO` and `ENOSPC`, are reported
  after publication; simultaneous sync and descriptor-close errors are retained.
  This distinction follows the [POSIX fsync error categories](https://pubs.opengroup.org/onlinepubs/009695399/functions/fsync.html)
  and the [documented AIX portability limitation](https://www.gnu.org/software/gnulib/manual/html_node/fsync.html).
  An unsupported directory sync does not establish durability across power loss.
  Backup destinations cannot be the live source's main file or WAL/SHM/journal
  files, even with `force`. Source/destination identity checks include hard links
  and resolved parent directories, so missing sidecars cannot bypass protection
  through alternate directory spellings. Restore also rejects hard links to its
  source snapshot.
  Verification requires a standalone source with no WAL/SHM/journal sidecars.
  Otherwise SQLite could report rows from a WAL that the main-file checksum
  and restored bytes do not contain. Use `backup()` on a live store first;
  verify and restore the snapshot it produces.
  Publishing a backup also requires a destination without SQLite sidecars;
  `force` permits replacing the main file, but does not bypass this check.
  Backup and restore check destination sidecars both before preparation and
  immediately before publication. If sidecars appear during preparation, they
  retain the destination and remove the temporary snapshot. These checks do not
  lock out another process: keep all destination users stopped throughout the
  operation, including publication.
  Backup and restore capture write options at entry, so adapter callbacks or
  changing getters cannot alter the replacement decision before publication.
  Replacement requires the literal boolean `force: true`. Other values, including
  the string `"true"` and boxed booleans passed by JavaScript callers, behave as
  `false`; they are not coerced and cannot enable replacement.
  Without `force`, a destination created during snapshot preparation is retained
  and publication fails instead of replacing it.
  Restore destinations cannot be sidecar paths of the source snapshot.
  Verification and restore accept schema versions 1 through the current version,
  validating each version's structure without migrating either file. Restoring
  an older snapshot preserves its checksum and schema version; a later writable
  open migrates the restored copy. Unversioned and newer snapshots are rejected.
- **Startup owns connection cleanup**: a failed open closes its database even
  when failure occurs before or during schema setup or during later statement preparation
  and vocabulary loading. A successful close preserves the original exception;
  a failed close produces an `AggregateError` containing both failures and their
  messages, with initialization as its cause. A later open can retry normally.
- **Append-only** (§9.1): `ingest` only inserts; every row carries a
  monotonic UUIDv7 in `id` and `tx`, so `MAX(tx)` per `claim_key` is the
  current belief. Each ingest call is one SQLite transaction; each newly
  minted row receives its own UUIDv7, with `id = tx` for that row. Outer writes
  reserve SQLite's write lock and re-observe `MAX(tx)` before minting, so
  concurrent processes allocate in commit order; lock contention waits for
  up to five seconds before surfacing `SQLITE_BUSY`. Explicit replay IDs must
  be canonical lowercase UUIDv7 strings. `insertResult` validates every used
  ID before insertion or receive-clock observation, so a rejected batch cannot
  change stored history or advance the generator. A UUID-generation failure
  during insertion rolls back the entire batch, including vocabulary changes,
  and the same store can retry after the failure clears. IDs successfully minted
  before a transaction rolls back may leave sequence gaps; transaction rollback
  does not rewind the process-wide generator shared by other stores.
- **Canonicalization shares the write reservation** (§13.4): `ingest` checks
  SQLite's `data_version` inside the transaction and refreshes the registry
  when another connection has committed. Inverse and lifecycle spellings
  therefore use committed vocabulary even on an already-open store. Local
  appends reuse the registry; rollback restores both the registry and its
  version marker. Callers supplying a pre-canonicalized `insertResult` remain
  responsible for their result's vocabulary snapshot; raw SQL writers must
  call `reloadRegistry` after changing declarations.
- **Transaction ownership**: `store.transaction(({ outermost }) => …)`
  requires a synchronous callback. Returning a promise or thenable throws and
  rolls back writes made before the callback returned. Promises from the current
  JavaScript realm are recognized even if an own `then` property is non-callable
  or throws when read. Native promise rejection
  is observed without calling a custom thenable’s `then` method, so rejecting
  a thenable does not start its work after rollback. This does not cancel
  already-started asynchronous work or include its later writes. Finish async
  work before calling `transaction`, then perform all transactional writes
  synchronously. The callback context
  reports whether the callback owns the database commit or only a nested
  savepoint. Existing callbacks that take no argument remain valid. Releasing
  a nested savepoint leaves its writes subject to the caller's rollback;
  the outermost scope commits only after its callback returns successfully.
  A commit error still throws and triggers rollback. The shared adapter contract
  exercises a deferred foreign-key failure at commit, verifies that claims and
  vocabulary are restored, and successfully retries on the same connection.
  The context works with both Node SQLite and the browser adapter.
  If rollback cleanup also throws, an `AggregateError` retains the original
  error as its cause and first entry, with the cleanup error second. In-memory
  vocabulary and transaction ownership are restored even in that case. Native
  and browser regressions exercise SQLite automatic rollback from outer and
  nested scopes and verify a later successful write. Other cleanup failures do
  not establish the database's transaction state; close and reopen the store
  before retrying when that state is uncertain.
- **History is permanent** (§9.6): retraction appends a `0%` row; it never
  erases the earlier row, `raw_line`, metadata, FTS text, export, backup, or
  peer copy. The store has no row-level redact/forget API because local
  deletion cannot guarantee erasure across SQLite remnants and distributed
  copies. Keep secrets and selectively erasable data out of CAVE; recover
  from accidental ingestion by quarantining every copy and rebuilding from
  reviewed safe input.
- **Publication is sensitivity-scoped** (§9.7):
  `#sensitivity:public|internal|confidential|restricted` labels each immutable
  row; unlabeled means `internal`, while flat, malformed and unknown labels
  fail closed as `restricted`. Export defaults to a maximum of `internal`.
  Export reads `current`, `maxSensitivity` and `tx` once each; changing getters
  cannot switch the selected history, sensitivity ceiling or annotation mode
  during the operation. Shared adapter tests verify the resulting claim content
  and transaction annotations, including grouped canonical output.
  Select `restricted` explicitly for complete portable text history. This is routing metadata,
  not encryption, access control, erasure or a retention boundary.
- **One row per fact** (§13.3): inverse writes are canonicalized before
  keying (`@cavelang/canonical`), inverse *reads* are query-time views —
  `forward()` uses the subject index, `reverse()` the object index with the
  relation named via the registry's `inverseOf`. Nothing is materialized.
- **Registry persistence is in-band**: `REVERSE`, `RENAMED-TO`, and `X IS verb` claims are
  ordinary rows; on open the store replays them (in tx order) on top of the
  initial registry, which defaults to the standard §5.5 prelude pairs. The
  replay predicate mirrors the canonicalizer exactly — qualifier-condition
  rows never declare, and `X IS verb` needs a verb-shaped subject — so the
  registry after reopen equals the registry at close.
  Appending WHEN, VIA or BECAUSE edges to existing declaration rows refreshes
  the live registry in the same transaction, since those rows become qualifier
  children. Rollback restores both the edges and the previous registry. Edges
  to ordinary premise rows do not require declaration replay.
  `appendEdges` captures the batch's parent IDs, roles and child IDs once before
  its transaction. SQL insertion and vocabulary refresh use the same captured
  values, including when callers supply getters.
  Both `appendEdges` and structured `insertResult` reject roles other than `WHEN`,
  `VIA`, `BECAUSE` and `QUALIFIES` with `TypeError`. Structured `append` also
  requires safe integer parent/child indices within its claim batch. These
  checks finish before inserting any rows or observing replay transaction IDs;
  invalid batches leave claims, edges and the live registry unchanged.
  A later edge constraint failure or vocabulary-refresh failure rolls back the
  entire batch and restores the previous registry. The full annotated history
  remains unchanged, and a corrected batch can be retried on the same store.
  Vocabulary rebuilds construct a replacement before updating the live cache.
  An interrupted `reloadRegistry` retains the previous registry and version
  marker; callers can retry without reopening or losing the loaded inverse names.
  Opening captures the configured registry and access mode once. Current
  vocabulary, explicit reload and `registryAsOf` share that same base registry;
  changing option getters cannot give historical reads a different configuration.
  Replay filters ordinary `IS` facts in SQL: only `IS verb` can declare a
  verb. This avoids materializing unrelated type facts during frequent action
  refreshes while retaining transaction ordering and qualifier exclusions.
- **Verb renames preserve history** (§5.8): after `OLD RENAMED-TO NEW`,
  either spelling writes the stable `OLD` storage verb and therefore the same
  claim key. `NEW` is preferred for authors while `OLD` remains compatible;
  declaration replay on reopen and `registryAsOf` preserve the same
  transaction-time boundary semantics as inverse declarations.
- **Traversal defaults**: `forward`/`reverse`/`topicMembers`/`topicsOf`
  read *current beliefs* and skip negated (`VERB NOT`) and retracted
  (`@ 0%`) rows; opt back in with `{ negated: true, retracted: true }`.
  Contradictions still coexist as rows (§9.4) — resolution belongs to the
  query layer. The traversal flags `negated`, `retracted`, `aliases` and
  `resolve` must be booleans when supplied; each is captured once and validated
  before query construction. Omission retains the false default.
- **Alias closure is opt-in** (§13.6): `{ aliases: true }` on traversal
  (and on `claimsAbout`) matches the entity through every name linked by
  current positive `ALIAS` claims, read as undirected edges;
  `aliasesOf(entity)` returns the closure itself. Union-of-rows semantics:
  matching widens, stored names come back untouched, and disagreeing
  belief series surface side by side rather than merging silently. Unmerge
  is retraction — `dupe ALIAS canonical @ 0%`.
  `claimsAbout` captures its `aliases` option once and requires a boolean when
  supplied; strings, numbers and null are errors rather than disabled alias
  matching. It still returns full history, newest first, including prior belief
  revisions. It is not a current-belief lookup. The alias flags on
  `resolvedBeliefs` and `contested` likewise require booleans and are captured
  once before resolution reads.
- **Actor provenance is caller-supplied** (§9.5): `ingest`/`insertResult`
  accept `{ source }` and stamp `@src:<source>` on every appended claim
  that carries no `src:` context — *before* the claim key is computed, so
  the stamp is part of claim identity and the same fact asserted by
  different actors keeps separate belief series (§9.4). A written `@src:`
  always wins; `raw_line` stays as authored. Interchange replay (`cave
  import`) passes no source, preserving exported keys.
- **Provenance dimensions are explicit** (§9.5.1): every row projects
  actor, physical source, lifecycle run, and `scope:` domain into indexed
  `cave_provenance` entries. Contexts and keys remain the compatibility text
  representation. Lifecycle systems use `run` lookup rather than authored
  `src:` strings; resolution reads actor/source. Opening old stores backfills
  only established actor/run prefixes, decoded sources, and explicit scopes.
  Backfill collects contexts once per claim without repeatedly copying prefixes;
  the native and browser migration contract checks 5,000 source contexts,
  context-free claims, retained row identities and repeat initialization.
  Annotated export preserves dimensions that compact contexts cannot encode:
  an optional JSON payload on `;@ <tx>` carries all four dimension sets.
  `Provenance.normalize` provides a stable set representation;
  `Provenance.parse` requires exactly the four named enumerable own fields
  (`actors`, `sources`, `runs`, `domains`); a hidden required field cannot mask
  an unknown enumerable dimension. It validates the complete object for replay, rejecting
  unpaired UTF-16 surrogates in every dimension before UTF-8 storage can replace
  them. Valid astral characters, embedded NUL and literal replacement characters
  remain valid provenance text.
  Parsing captures each dimension and its entries once, so accessors and later
  changes to caller-owned arrays cannot replace the values being validated.
- **Source spans retain source identity** (§9.8):
  `@src:docs/design%20notes.md#L10-L20` carries a one-based inclusive range;
  `SourceSpan` owns escaping and parsing. The exact context remains in the
  claim key, while resolution/reliability strip the line fragment before
  policy matching. `AppendOptions.contexts` lets connectors attach structured
  spans before keying without rewriting generated CAVE text.
- **Contradiction resolution is opt-in** (§26): `{ resolve: true }` on
  traversal reads only the winners — coexisting series about one fact
  (claim key modulo `src:` contexts and polarity) collapse to the row the
  policy picks: precedence class (max over the row's sources), then
  reliability-weighted confidence (min over sources), then tx. The policy
  merges a built-in ladder (`cli` 4 > `agent`/`action` 3 > root 2 >
  `rule` 1) with in-band `source/<name> HAS precedence:` /
  `HAS reliability:` claims, matched to `src:` contexts by longest
  segment prefix; the declarations themselves resolve under the built-ins
  alone, so ingested text cannot self-elevate. Declaration-source precedence
  is accumulated iteratively, so a large provenance list does not exceed
  JavaScript's function-argument limit. Contexts still reside in memory during
  policy lookup; this is not a provenance-size budget. Policy identities preserve
  embedded NUL characters: declaration keys use structured tuples, SQL literals
  retain complete UTF-8 text, and segment matching uses byte lengths so SQLite
  text functions cannot truncate a prefix. Native and WASM regressions check
  exact, descendant and non-matching sibling sources. Physical source contexts
  use the canonical escaping provided by `SourceSpan.context`. Actor compatibility
  stamps use `Context.source`, retaining the actor name verbatim. Resolution
  includes an actor only when that exact stamp is present; an authored source
  can suppress an ordinary actor stamp while actor provenance remains recorded.
  Up to 16 policy entries use SQL `VALUES`; larger policies use one materialized
  JSON table to reduce SQL preparation cost and avoid repeated JSON decoding
  during source matching. Native tests cover 33,000 entries and the strategy
  boundary; SQLite WASM tests cover more than 1,000 in-band declarations. The
  complete policy still resides in memory, and matching still scans candidate
  prefixes; this is not a general policy-size or execution-time budget.
  Ranked precedence is projected as a floating-point value, matching the
  JavaScript numeric API. Finite values outside the safe-integer range, such as
  `10000000000000000`, remain readable without a SQLite integer-conversion error;
  positive and negative values retain their ordering.
  Winners come back
  verbatim — resolution filters, it never rewrites — and it composes with
  `aliases`, which widens groups through the closure (the §13.6
  pick-a-winner story). Alias-aware grouping preserves complete subject and
  object names, including embedded NUL and Unicode characters; sharing the text
  before a NUL does not make two names aliases. Only the declared alias closure
  combines their resolution groups.
  `resolvedBeliefs`, `contested` and traversals with `resolve: true` hold one
  deferred read snapshot across policy lookup and claim selection. Concurrent
  policy and claim commits become visible together on the next call. These
  reads work on read-only connections and nest inside caller transactions.
  Traversals capture their four boolean options once before reading; traversals
  without resolution do not add this policy snapshot. Reverse reads always hold
  a snapshot across their vocabulary check and fact selection, so a concurrent
  inverse rename cannot label new facts with an old inverse name.
  If both a read and snapshot release fail, the aggregate message includes both
  diagnostics, with the original errors retained and the read failure as cause.
  Canonical export uses the same cleanup and reporting behavior. A release-only
  failure preserves that error itself.

## API

| Method | Spec | Purpose |
|---|---|---|
| `ingest(text, {strict, source})` | §13.4 | parse → canonicalize → append; lenient by default |
| `insertResult(result, {source})` | | append a pre-canonicalized `@cavelang/canonical` result |
| `currentBeliefs({minConf})` | §13.5 | latest row per key; optional inclusive threshold must be a finite number in 0..1, captured once and validated before querying |
| `currentBelief(key)` / `history(key)` | §9.1 | one fact's belief series |
| `provenanceOf(rowOrId)` / `byProvenance(dimension, value)` | §9.5.1 | inspect or filter actor/source/run/domain |
| `resolvedBeliefs({aliases})` | §26 | one winner per resolution group |
| `contested({aliases})` | §26.4 | contested groups, candidates ranked winner-first — the fusion feed |
| `resolutionPolicy()` | §26.3 | effective policy: built-ins merged with in-band declarations |
| `claimsAbout(entity, {aliases})` | §13.5 | both directions, all rows |
| `forward(entity)` / `reverse(entity)` | §13.3 | named traversal, inverse-aware |
| `aliasesOf(entity)` | §13.6 | the entity's alias closure |
| `byTag(key, value?)` | §13.5 | flat (`value` omitted → `IS NULL`) or scoped |
| `byContext(ctx)` | §13.5 | context filter |
| `topicMembers(t)` / `topicsOf(e)` | §11.2 | topic layer over `CONTAINS` |
| `search(q, {raw, limit, maxSensitivity, currentOnly})` | §13.2 | adapter full-text search; literal phrase by default, `limit` caps in the query; optional current-only and sensitivity filters |
| `edgesOf(id)` | §13.2 | qualifier/grouping edges with roles |
| `toClaim(row)` | | reconstruct the canonical claim + side tables |
| `registry()` / `baseRegistry()` | §5.5 | current registry and its configured pre-declaration base |
| `recordOf(row)` | | map a storage row to the stable `cave.claim/v1` JSON contract |
| `exportText({current, tx, maxSensitivity})` | §9.7 | emit sensitivity-scoped canonical CAVE text (default maximum `internal`); `tx` includes replayable `;@` row identities; `current` compacts, never sanitizes; complete portable history requires `restricted` |
| `backup(store, path)` / `verifyBackup(path)` / `restoreBackup(snapshot, path)` | §13.2.2 | exact verified SQLite snapshot lifecycle |
| `openAt(path, {intent, registry})` / `openText(path)` / `kindOf(path)` / `isStoreFile(path)` | §13.7 | open a `--db` path by content: SQLite (read-only for `read`, unmigrated for `scratch`), CAVE text replayed into memory; only `write` creates or migrates |
| `adapter` / `db` | | selected adapter capabilities and its raw structural database handle |

### Search history or current knowledge

Use historical search to find evidence across revisions. Set `currentOnly` when
the result should contain only the latest positive-confidence rows. Retraction
removes a fact from current-only results while keeping its history searchable:

```ts
import { open } from '@cavelang/store'

const store = open()
try {
  store.ingest('auth HAS provider: legacy')
  store.ingest('auth HAS provider: modern')

  console.log(store.search('auth').map(row => row.value_text))
  // ['modern', 'legacy']
  console.log(store.search('auth', { currentOnly: true }).map(row => row.value_text))
  // ['modern']

  store.ingest('auth HAS provider: modern @ 0%')
  console.log(store.search('auth', { currentOnly: true }).length) // 0
  console.log(store.search('auth').length) // 3
} finally {
  store.close()
}
```

Both modes return newest matches first. A `limit` applies after the selected
history scope; `maxSensitivity` independently sets the audience ceiling when
supplied. CLI, MCP and viewer searches retain their historical behavior.

## Storage decisions

The exported `Resolve.rankedSql(entries, currentSql)` and
`Resolve.resolvedSql(entries, currentSql)` helpers accept an empty explicit
policy. With no entries, every source has precedence `0` and reliability `1`,
so confidence and then recency choose the winner. Store methods obtain the
built-in ladder plus declarations through `resolutionPolicy()`.
Partial explicit policies apply those defaults to each unmatched source
before taking maximum precedence and minimum reliability. For example, a
source assigned precedence `-1` and an unmatched source together give a claim
precedence `0`.

- **Terms are stored formatted**: entities as plain text (so the spec's
  `WHERE subject = 'auth/middleware'` queries work verbatim), literals with
  their delimiters (`` `<=` ``, `"…"`) so they never collide with
  same-spelled entities and reconstruct losslessly.
- **`value_text` is the value as written** (including `~`, multiplier
  letters and literal delimiters); `value_num`/`value_unit` hold the
  normalized §13.4 forms. Same for `delta_*`.
- **Confidence keeps its stored numeric value** through canonical export and
  import, including positive subnormal values and computed probabilities.
  A zero-confidence retraction remains distinct from a later positive
  reassertion, even at `Number.MIN_VALUE`. Import assigns fresh transaction
  identities; annotated text sync preserves identities and skips repeated rows.
- **`id` doubles as `tx`** by default: a UUIDv7 is both unique and
  time-ordered, and per-row tx ids keep same-document belief updates
  ordered by line. Allocation is database-serialized across processes;
  nested store transactions remain savepoints.
- **`search()` phrase-quotes by default** — SQLite full-text syntax would parse
  `token-expiry` as a column filter; `{ raw: true }` opts into full MATCH
  syntax.
  A supplied `limit` must be a non-negative safe integer; zero returns no rows,
  and omission leaves search uncapped. Invalid limits throw `TypeError` before
  querying, including on an empty store. Search includes historical beliefs by
  default. `{ currentOnly: true }` selects positive-confidence current rows
  before applying the limit, so revisions and retractions cannot crowd out
  current matches. The option must be a boolean when supplied.
  `currentOnly` is a programmatic store option used by ingestion context.
  CLI `search`, MCP `cave_search` and viewer search retain historical results;
  their public inputs do not expose this option.
  The returned-row limit does not cap SQL work; see the
  [current-search trial](#current-search-trial) for measurements and query-plan tradeoffs.
  Search captures `raw`, `limit`, `currentOnly` and `maxSensitivity` once before validation and
  SQL construction. Getters cannot change the cap or sensitivity ceiling between
  validation and execution.
  Supplied `raw` and `currentOnly` values must be booleans; malformed switches
  raise `TypeError` instead of silently choosing another search mode.
  Literal phrase quoting accounts for FTS4 versus FTS5, including embedded
  quotation marks. `{ raw: true }` passes syntax directly to the selected
  engine; it does not translate between their query languages.
  Both modes reject NUL characters in query text with `TypeError` before database
  access, including when `limit` is zero. SQLite's MATCH parser can otherwise
  silently truncate a raw query at NUL or report an unterminated literal phrase.
  Empty or punctuation-only literal phrases return no matches.
- **Current-only export remaps edge endpoints** to the current row of each
  endpoint's claim key: a superseded qualified parent keeps its `WHEN`
  attached to the surviving belief, and orphaned condition claims are never
  promoted to top-level facts.
- **Sensitivity filtering follows current resolution**: the latest row is
  selected before its audience is checked, so a hidden current belief never
  revives an older visible row. Full-history export checks each row. Edges with
  either endpoint hidden are omitted.

`registryAsOf` bounds qualifier parents as well as declaration rows. A parent
recorded later cannot exclude an older verb, inverse, or rename from a past
snapshot; date and timestamp intervals use the same boundary on both sides.

Live connections refresh vocabulary after another SQLite connection commits.
`store.registry()`, query compilation, and inverse reads therefore see new
verb and lifecycle declarations without reopening or writing. The read path
works on read-only connections and reuses its registry cache while SQLite's
data-version counter is unchanged. Raw SQL writes on the same connection still
require `reloadRegistry`; precompiled SQL retains their supplied vocabulary.

Canonical export may include `@claim` for qualifier claims with verb `NOT` or
to distinguish reserved entity subjects
from qualifiers or continuations. The marker changes no stored identity or
context, including in annotated exports. Readers of those exports must support
the explicit-claim syntax (§8.6).

## Structured appends

A supplied `source` must be a string. The value is captured once and validated
before stamping or deriving actor/run attribution, even for empty batches.
Omit it (or use `undefined`) to preserve interchange claim identity without a
source stamp.

The optional `provenance` container must be an object when supplied; null,
primitives, functions and arrays are rejected before any fields are read.
An empty object is supported, and omission or `undefined` keeps inferred
provenance behavior. Supplied `actor` and `run` must be strings; every entry
in `sources` and `domains` must also be a string. Validation happens before
row insertion, including for empty batches. Empty strings retain their existing
meaning of no explicit value.

Append option collections (`ids`, `contexts`, `provenance.sources`, and
`provenance.domains`) must be arrays when supplied. They are captured once and
validated before copying, including for empty batches; strings, sets, null and
array-like objects are rejected. Omitted or `undefined` collections keep their
existing defaults.

`insertResult` accepts a canonicalization result and prepares every claim before
observing replay IDs or inserting rows. It validates canonical emission even
when the caller supplies raw text. If a claim fails that check, the batch
rejects without appending earlier valid claims. Context and tag collections must
be arrays before capture: strings, sets and array-like objects are rejected
rather than being converted into a different collection.

The [emitter's validation rules](../canonical/README.md#structured-claim-validation)
reject non-string term/value text, unsupported term kinds, non-boolean negation or importance, malformed verb tokens, embedded LF in claim fields, text/code literals containing their own
closing delimiter, and entity subjects that do not represent one non-metadata
atom. Contexts and tags must retain their metadata tokens, and tags must keep
the same key/value split. The rendered body must not open a comment or leave
a literal delimiter unmatched. Literal subjects and multiline comments remain
supported.

This validation prevents the listed malformed fields from entering through new
structured appends. It does not validate every possible programmatic claim,
rewrite historical rows, or govern low-level SQL writes. Existing malformed
rows may still fail canonical export. When an included row cannot be decoded or
emitted, export reports its claim ID and retains the validation error as `cause`.
The diagnostic applies to full/current and annotated/plain exports. It does not
modify rows or return a partial export. Row validation is repeated only after an
emission failure, so successful exports avoid an extra validation pass.
Export reads claims, metadata, lineage and provenance within one deferred read
snapshot, including on read-only connections. A peer commit cannot add its edges
to an export that omitted its claims; the next export sees the committed state.
If an included claim has an edge whose other endpoint is missing from storage,
export fails instead of silently dropping that relationship. Claims excluded by
sensitivity remain valid endpoints and retain the existing filtering behavior;
edges with neither endpoint included are outside this export's diagnostic scope.
The error contains no claim text, export leaves storage unchanged, and corrected
relationships are checked again on retry. This applies to plain/annotated and
historical/current exports, including current revision remapping.
The snapshot nests inside caller-owned transactions without committing them.
Release is attempted on success and failure. If both the read and release fail,
an `AggregateError` retains the read error first and as `cause`; a lone release
error propagates unchanged. A failed SQLite release may require caller recovery
before reusing the connection.

Export captures `current`, `maxSensitivity` and `tx` at entry, before database
reads and row decoding. Adapter callbacks that change the caller's options cannot
remove requested transaction annotations midway through an export. The shared
adapter contract checks this with native SQLite and browser SQLite.
With `tx: true`, every included row must have a canonical lowercase UUIDv7
identity with `id = tx`; a mismatch fails with the affected claim ID before
annotation emission. Plain semantic export does not carry row identities.
Annotated export also recomputes each included claim's key, including its
contexts, and rejects disagreement with the stored key. This prevents replay
from silently assigning the same transaction to a different belief series.
The error identifies the affected claim and preserves its cause; export leaves
the database unchanged for repair and retry.
Annotated export also validates explicit stored provenance against the replay
contract: each value must be a nonempty Unicode string. Historical empty or
binary values fail with the affected claim ID and an underlying cause instead
of producing annotations that sync would reject. Validation occurs only for
included rows; narrower sensitivity exports can still succeed. Export does not
repair stored data. After the malformed provenance is corrected, annotated
export and identity-preserving replay can proceed normally.
`cave doctor` checks for empty and non-text provenance values under `store.rows`
without printing the values or claim identities and without changing the database.
The same check recomputes historical claim keys from their semantic claims and
stored contexts, detecting disagreement before an annotated export is attempted.
It also checks canonical emission with the stored tags, diagnosing historical
claim text that export cannot emit while keeping the data unchanged for repair.
Stored edge roles outside `WHEN`, `VIA`, `BECAUSE` and `QUALIFIES` also fail
`store.rows`. Diagnosis leaves those relationships unchanged, redacts their
values and checks them again after repair.

The optional `current` and `tx` switches must be booleans when supplied. Export
captures them once and rejects malformed values with `TypeError` before querying,
including on empty stores. A string such as `"true"` cannot silently select
historical output or omit transaction annotations.

`search` and `exportText` also reject invalid supplied `maxSensitivity` values
with `TypeError`, including `null`, unknown strings and non-string values.
Omitting the option retains each method's existing scope: search includes all
levels, while export defaults to `internal`. Stored malformed sensitivity tags
continue to be treated as `restricted`; they are distinct from invalid API options.

Sensitivity filtering precedes row decoding and emission: malformed restricted
rows do not break a public-only export or disclose their claim IDs in its output.
When the requested sensitivity includes those rows, the same row-specific error
applies. Regressions cover newline-corrupted historical subjects, objects,
contexts and tag values across full/current and plain/annotated exports, with
stored claims, metadata and edges unchanged after failure.

Export also rejects stored edge roles other than `WHEN`, `VIA`, `BECAUSE` and
`QUALIFIES` when both endpoints are included.
The error identifies both endpoint IDs. Edges omitted by sensitivity filtering
do not expose their endpoints through this diagnostic. Invalid roles previously
emitted text that could re-import without its original edge; export now fails
without changing the store, and repairing the role restores export.

Self-referential edges are retained, including edges whose historical endpoints
resolve to the same current row. The canonical emitter re-states the claim once
under its own edge; annotated export gives both appearances the same transaction
ID. This preserves the graph relation without recursively expanding the cycle.
Syncing that annotated export into a fresh store restores one row and one
self-edge for each of the four supported roles; repeating the sync adds neither
another row nor another edge. Current export uses the current row's identity
for both endpoints when it remaps an older revision.

Row-to-claim conversion also rejects conflicting payload columns: an object
cannot coexist with an attribute or value, and an attribute requires a value.
These malformed historical or low-level SQL rows previously lost fields during
conversion. Export now reports their claim ID when the sensitivity scope includes
them, without changing stored data; correcting the row permits export again.
The stored `negated`, `importance` and `value_approx` flags must each be exactly
numeric 0 or 1.
Other values are diagnosed during claim conversion instead of being coerced
into a negation or importance marker, or silently ignoring an invalid
approximation flag. Native and browser SQLite share this check.

Claim-specific export failures retain the affected claim ID and the original
thrown value in `Error.cause`, even if an adapter throws a value whose message
cannot be read or converted to text. Such diagnostics use
`[unprintable thrown value]`; the export read snapshot is still released and a
corrected read can be retried without changing stored history.

Conversion also checks `value_num`, `value_unit`, `value_approx`, `delta_num` and
`delta_unit` against the parsed authored value and uncertainty text. A mismatch
fails with the field name; export adds the claim ID and leaves the database
unchanged. Correcting the cached columns permits conversion and export again.
This conversion check does not validate every row before SQL filtering.
`cave doctor` separately streams all stored history through the row decoder to
check authored values and their cached projections before export is attempted.
That scan also requires a canonical lowercase UUIDv7 identity with `id = tx`
for each row; SQLite integrity and matching search contents alone do not prove
that identity invariant.
Doctor holds a read transaction across its SQLite checks, so concurrent commits
do not mix database states within a report; a later invocation sees those commits.
In rollback-journal mode, the read snapshot can temporarily block a competing
writer's commit. Closing doctor's connection releases the read lock, including
after an invalid-row report. WAL and rollback-journal regressions exercise these
different concurrency behaviors using a second live connection.
If closing the owned connection fails, doctor retains the database checks and
adds a redacted `store.cleanup` failure instead of exposing the thrown value.
For an existing current-schema SQLite file, `cave doctor` reports these payload
and flag problems through `store.rows` before export is attempted. The same check
rejects nonnumeric or out-of-range confidence and nonnumeric, nonpositive or
infinite sigma levels; a null sigma level retains the legacy default of 2. It checks
stored history without changing it and omits claim contents and identifiers
from the diagnostic. This targeted check is not a complete semantic audit of
every historical field.

## Tests

```
pnpm --filter @cavelang/store test
```

Covers the §9.1 belief series, §5.5 one-fact-two-names invariants
(unified belief through either name, negation riding the row, no
materialized inverses), every §13.5 query, the §13.6 alias closure
(merge, unmerge by retraction, opt-in traversal, union semantics), the
§9.5 provenance stamping (written `@src:` wins, per-actor series,
cross-actor retraction, stamped round-trips), the §26 resolution policy
(human-over-ingest precedence, reliability weighting, longest-prefix
specificity, polarity contests, no self-elevation, alias-widened
groups, contested ranking), the §11.2 topic reads, edge persistence,
registry and lifecycle rebuild across reopen and historical qualifier-parent boundaries, transactional strict ingest and export
round-trips, ordered schema migration, newer-version rejection, transactional
rollback/retry, and closed-file backup recovery.

## Empty scoped-export trial

When sensitivity filtering selects no claims, export returns empty text before
reading lineage or building historical-to-current identity maps. The scoped claim
query still runs inside the read snapshot, validates the sensitivity ceiling and
determines that nothing is visible. This does not make empty exports constant-time.

Run `node scripts/empty-export-bench.mjs` from the repository root. The fixture
contains restricted claims with qualifier edges and exports at the public ceiling,
with transaction annotations enabled. Setup and output checks are outside timing;
each result is the median of five calls after one warm-up. A local macOS ARM64
trial with 10,000 claims and 5,000 edges measured:

| Export mode | Node 24.16.0 before → after | Node 26.5.0 before → after |
|---|---|---|
| Full history | 6.89 → 3.46 ms | 6.86 → 3.45 ms |
| Current only | 21.09 → 10.62 ms | 20.96 → 10.69 ms |

These figures describe this empty-output fixture, not exports containing visible
claims. Existing adapter tests cover empty sensitivity scopes and snapshot cleanup.

## Current-export history trial

Current export resolves edge endpoints directly when they are selected current
rows. It builds the historical ID/key map only when an endpoint needs remapping,
restricts it to IDs referenced by stored edges, and shares it across the remaining
endpoints within the same read snapshot.
An export without edges does not build it. Historical qualifier edges still
remap to the current rows, preserving their conditions.
Plain and annotated current exports first validate the semantic keys of all
selected current rows. This also prevents a corrupted newer claim from taking
another claim’s key and receiving its historical relationships.
Before a historical endpoint is mapped to a selected current row, export
reconstructs that endpoint's semantic key from its claim and contexts and checks
it against the stored key. A mismatch fails plain and annotated current exports
with the historical claim ID, instead of attaching the edge to an unrelated
current claim. Successful verification is cached per endpoint within the read
snapshot. This checks historical rows used for remapping, not every omitted row;
`doctor` remains the broader historical integrity check. For example, a malformed
superseded attribute row with no relationships does not block a current export
of its valid newer revision. Full-history export includes and rejects that row.
Adding an edge through the old row makes current export validate it too; repairing
the old row permits the edge to remap to the newer value. Both SQLite adapter
contracts verify this boundary and unchanged database contents on rejection. The measurements below
predate this additional verification.

Run `node scripts/current-export-history-bench.mjs` from the repository root.
It measures annotated current exports after 100, 1,000 and 10,000 revisions of
one attribute, with no edge, a current-row edge, or a historical-row edge.
Setup and output checks are outside timing; medians use five calls after one
warm-up. A local macOS ARM64 trial at 10,000 revisions measured:

| Edge case | Node 24.16.0 before → after | Node 26.5.0 before → after |
|---|---|---|
| None | 6.67 → 1.17 ms | 6.43 → 1.16 ms |
| Current row | 6.71 → 1.19 ms | 6.96 → 1.18 ms |
| Historical row | 6.67 → 1.20 ms | 6.99 → 1.19 ms |

The before column predates both lazy map construction and limiting the map to
edge endpoints. The fallback still scans stored edges and resolves their IDs;
unrelated historical revisions no longer enter the map.

`node scripts/dense-current-export-bench.mjs` is the control with every exported
parent requiring remapping. With 3,000 historical rows, 2,000 current rows and
1,000 edges, narrowing the map changed local medians from 52.41 to 50.00 ms on
Node 24 and 48.18 to 47.35 ms on Node 26. It uses the same warm-up, five-sample
method and output checks outside timing. These are fixture measurements, not a
general export work bound.

A refreshed checkpoint includes historical endpoint semantic-key verification.
The same scripts, run sequentially on Node 24.21.0 and Node 26.8.1, retain their
output checks and one warm-up/five-call medians:

| Current workload | Node 24.21.0 median | Node 26.8.1 median |
|---|---:|---:|
| 10,000 revisions, no edge | 1.214 ms | 1.201 ms |
| 10,000 revisions, current-row edge | 1.225 ms | 1.220 ms |
| 10,000 revisions, historical-row edge | 1.241 ms | 1.252 ms |
| 3,000 history rows, 2,000 current rows, 1,000 historical edges | 74.736 ms | 67.876 ms |

[Current samples and source hashes](../../benchmarks/verified-historical-export-review.json)
include all three sizes in each workload. These current-state measurements do
not isolate endpoint verification's cost from runtime and other implementation
changes since the older trials. The dense case exercises verification for every
remapped parent; the sparse case checks that long unrelated history remains
outside the endpoint map. They establish neither a process-memory limit nor a
general elapsed-time bound.

Historical verification now prepares its context and tag queries once per export,
reusing them for each checked endpoint within the same read snapshot. It reads
the same data and retains full row reconstruction and semantic-key checks.
Repeating the dense trial after this change records 69.659 ms on Node 24.21.0
and 59.309 ms on Node 26.8.1 for 1,000 edges, compared with 74.736 and 67.876 ms
in the preceding checkpoint. [Statement-reuse samples and hashes](../../benchmarks/historical-export-statements-review.json)
retain all three sizes and the same warm-up/five-call controls. The measurements
support this dense workload; they do not establish a universal speedup.

## Transaction-index trial

An isolated Node 26.5.0 / SQLite 3.53.3 macOS arm64 trial compared the version-1
schema with a temporary `CREATE INDEX trial_tx ON cave_claim(tx)`. Each fixture
contained one distinct attribute claim per entity. Five samples each executed
100 prepared head queries, verifying identical results before and after adding
the index. A bounded query used the fixture's middle transaction as `tx <= ?`.

| Claims | Head reads, existing / indexed | Bounded reads, existing / indexed | Added database pages in bytes |
|---|---:|---:|---:|
| 1,000 | 4.52 / 0.075 ms | 4.96 / 0.085 ms | 49,152 |
| 10,000 | 44.38 / 0.071 ms | 47.79 / 0.084 ms | 454,656 |
| 50,000 | 218.68 / 0.072 ms | 235.89 / 0.086 ms | 2,252,800 |

Query plans used the existing `(claim_key, tx)` covering index before the trial
and the transaction-leading index afterward. In separate five-sample fixtures
starting with 10,000 claims, appending 100 claims in individual transactions
took a median 55.66 ms without the index and 10.38 ms with it; row counts and
SQLite integrity checks passed. The receive-clock head read benefits each append.
These in-memory measurements do not characterize disk durability or all write
workloads. They motivated schema version 2, which installs `idx_cave_tx` through
an atomic migration and validates its table, column, binary collation and non-partial coverage.
A same-named index with another collation is incompatible: it cannot provide
the binary transaction range search used by bounded head reads.

A follow-up using the production schema-2 migration on the same runtime and
five fresh 10,000-row fixtures measured 0.079 ms for 100 prepared head reads
and 10.83 ms for 100 individual appends (medians). Every fixture retained
10,100 rows and passed SQLite integrity checks. Native and WASM regression
tests also verify indexed global and bounded query plans, migration rollback
and retry, and unchanged annotated exports.


## Claim capture cost trial

Run `node --disable-warning=ExperimentalWarning scripts/claim-capture-bench.mjs`
alone. It appends pre-canonicalized batches of 100 and 1,000 claims to fresh
in-memory stores: simple relations, or numeric attributes with uncertainty,
confidence, source/scope contexts, a tag and a comment. Canonicalization, store
creation and result validation are outside timing; each median uses five fresh
stores after one warm-up store. Checks verify inserted counts and decode the
first and last claim records, including numeric metadata and source provenance.

On macOS arm64, Node 24.16.0 and 26.5.0 produced these medians. The baseline
bypassed only the new per-claim capture helper; option and edge capture remained
in place. The final source was restored before the after runs. The benchmark
itself measures the checked-out code and exposes no bypass option.

| Claims | Payload | Node 24 before → after | Node 26 before → after |
|---|---|---|---|
| 100 | Relation | 1.57 → 1.60 ms | 1.65 → 1.65 ms |
| 100 | Numeric with metadata | 4.27 → 4.33 ms | 4.12 → 4.50 ms |
| 1,000 | Relation | 11.84 → 11.69 ms | 11.85 → 12.37 ms |
| 1,000 | Numeric with metadata | 38.47 → 37.33 ms | 35.00 → 35.41 ms |

These measurements describe complete append calls, not isolated copy costs.
Baseline runs preceded final runs; cache and execution-order effects remain
possible, and the varying differences do not establish a speedup or universal
overhead bound. File durability, contention, large batches and WASM are outside
this trial. Separate getter regressions establish projection consistency.

## Current-search trial

This trial uses native Node SQLite in memory; it does not measure SQL.js/WASM
or browser rendering. The shared adapter tests check search semantics on both
native SQLite and SQL.js separately.

The returned-row limit does not cap SQL work over matching history. Run
`node scripts/current-search-bench.mjs` alone from the repository root to
compare historical and current-only search at 100, 1,000 and 10,000 revisions
of one fact, alongside an older current fact. The benchmark requests five
results and checks that current-only mode retains both current facts. It
reports eleven-call medians after two warmups, including row decoding and
excluding fixture construction and assertions. These are local measurements,
not CI thresholds or general latency guarantees.

An additional workload combines 10,000 revisions with 10,000 unrelated claim
keys to expose current-row resolution costs beyond matching history. On the
audit machine, historical/current-only medians were 11.75/19.56 ms on Node
24.21.0 and 11.36/19.07 ms on Node 26.8.1. The two matching current facts
remain the same; unrelated store size can still affect query execution cost.

Checking for a newer revision through the existing `(claim_key, tx)` index
replaced whole-store grouping in current-only search. In the same workload,
current-only medians fell from 19.56 to 11.91 ms on Node 24.21.0 and from
19.07 to 12.35 ms on Node 26.8.1. The check considers newer rows regardless of
sensitivity or confidence before applying visibility and result limits;
a hidden replacement or retraction cannot revive an older match.

The 10,000-revision fixture without unrelated keys measured about 11.8 ms
with the indexed check, compared with about 10.9 ms in the earlier grouped
run. This is a workload tradeoff, not a universal speedup; broad match sets
still require searches and ordering work.
