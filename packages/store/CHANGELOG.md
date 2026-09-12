# @cavelang/store

## 0.36.5

### Patch Changes

- @cavelang/canonical@0.36.5
  - @cavelang/core@0.36.5

## 0.36.4

### Patch Changes

- @cavelang/canonical@0.36.4
  - @cavelang/core@0.36.4

## 0.36.3

### Patch Changes

- @cavelang/canonical@0.36.3
  - @cavelang/core@0.36.3

## 0.36.2

### Patch Changes

- Updated dependencies [9207b82]
- Updated dependencies [9e9d967]
  - @cavelang/core@0.36.2
  - @cavelang/canonical@0.36.2

## 0.36.1

### Patch Changes

- Updated dependencies [7a3cad1]
  - @cavelang/core@0.36.1
  - @cavelang/canonical@0.36.1

## 0.36.0

### Minor Changes

- b3f5de7: Add opt-in current-only store search and use it for ingestion context, filtering superseded and retracted rows before the result limit.
- b3f5de7: Add synchronous store cleanup hooks and close cached sensitivity projections when their source closes, attempting all resource cleanup even after errors.
- b3f5de7: Preserve explicit provenance dimensions in optional JSON transaction-annotation
  payloads. Validate payloads and identity agreement before replay, preserve empty
  sets, and retain legacy bare annotations and ordinary imports. Database copies
  now preserve authoritative provenance tables without adding inferred entries.
- b3f5de7: Verify decoded attribute, metric and uncertainty value projections against their raw spelling using the core parsers. Reject inconsistent numeric values, units, endpoints, kinds and approximation flags while preserving literals and values beyond finite JavaScript numeric representation.
- b3f5de7: Reject holes in claim-record context and provenance string arrays instead of skipping their validation. Preserve empty arrays and valid strings, and align object decoding with JSON decoding.
- b3f5de7: Add explicit @claim syntax to preserve reserved entity subjects through standalone, grouped and qualifier emission without changing existing continuation rules. Update grammar, highlighting, editor and book projections.
- b3f5de7: Add schema version 2 with a transaction-leading index, migrated atomically without rewriting claims or metadata.
- b3f5de7: Expose outermost transaction ownership to store callbacks across SQLite adapters. Reject configured action hooks inside caller-owned transactions when effects would change, rolling back the action's savepoint without firing the hook or disturbing earlier caller writes. Preserve nested hook-free, no-op, and dry-run actions.
- b3f5de7: Require decoded claim uncertainty deltas to be positive finite scalars, matching authored CAVE parsing. Reject zero, negative and nonscalar deltas even with consistent raw projections and canonical text.
- b3f5de7: Require Node 24.16.0+ or 26.1.0+ for lossless native SQLite text, reject truncating bindings before opening caller databases, and align engines, doctor, CI and documentation.
- b3f5de7: Verify and restore supported historical snapshot schemas without changing their bytes; migrate only on a subsequent writable open.
- b3f5de7: Validate optional decoded claim metadata: uncertainty value fields, positive finite sigma levels and string comments. Reject malformed fields before canonical identity checks while preserving valid measured claims.
- b3f5de7: Validate decoded claim payload kinds, attribute names and attribute/metric value field types before semantic identity checks. Reject malformed or nonfinite supplied fields while preserving valid value kinds and optional absent numeric fields.
- b3f5de7: Validate claim-record tags before checking canonical identity. Reject nonobjects, missing or nonstring keys, and nonstring supplied values, even when canonical text matches JavaScript's coerced spelling.
- b3f5de7: Validate subject and relation-object term kinds and text before accepting decoded claim records. Reject unsupported kinds and nonstring text even with recomputed semantic identity; preserve entity, text and code terms.
- b3f5de7: Require direct search limits to be non-negative safe integers so negative SQLite limits cannot silently remove the cap. Zero remains supported; omitted limits remain unlimited.

### Patch Changes

- b3f5de7: Avoid repeated context-array copying during legacy provenance backfill, with shared native and browser migration coverage.
- b3f5de7: Validate record provenance with the interchange contract, rejecting empty names, malformed Unicode and unknown dimensions while preserving valid input arrays.
- b3f5de7: Build current-export historical identity maps only when an edge endpoint needs
  remapping, avoiding full-history materialization for absent or already-current edges.
- b3f5de7: Capture appended edge fields once so vocabulary cache refresh reflects the edge
  actually inserted even when callers provide changing getters.
- b3f5de7: Capture declared claim fields and nested values before deriving storage columns,
  semantic identity and emitted text, preventing changing getters from producing
  inconsistent stored projections.
- b3f5de7: Capture the current-belief confidence threshold once so getter-backed options
  cannot change which threshold the SQL query applies.
- b3f5de7: Capture export transaction-annotation mode before database reads so callbacks cannot remove requested replay identities midway through export.
- b3f5de7: Capture provenance dimensions and array entries once so normalization returns the values actually validated.
- b3f5de7: Copy object record inputs before validation so changing accessors and caller mutations cannot replace decoded values.
- b3f5de7: Capture canonical-result edge fields before insertion so replay duplicate checks
  and writes cannot use different roles from a changing getter.
- b3f5de7: Capture backup and restore options at entry so callbacks or changing getters cannot change the destination replacement decision during publication.
- b3f5de7: Capture append options and their arrays once so replay validation and insertion
  use the same IDs and batch metadata even when callers supply changing getters.
- b3f5de7: Capture store-open registry and access options once so current vocabulary,
  explicit reload and historical vocabulary reads share the same configured base.
- b3f5de7: Capture search options once so changing getters cannot bypass the result limit or alter the sensitivity ceiling between reads.
- b3f5de7: Capture semantic claims before validating and emitting structured records. Read claim getters during capture and keep returned terms, values, contexts and tags independent of later caller mutation.
- b3f5de7: Clarify actor versus physical-source context encoding and verify complete actor identities under authored-source suppression.
- b3f5de7: Verify and document that exact snapshots preserve structurally valid semantic damage for independent diagnosis and repair of restored copies.
- b3f5de7: Verify read-only opens reject legacy stores awaiting provenance migration and
  clarify that ordinary reopens preserve authoritative provenance metadata.
- b3f5de7: Clarify that an atomic ingest call assigns a separate UUIDv7 identity to each newly minted claim row, with id equal to tx for that row.
- b3f5de7: Handle pre-1970 transaction periods as empty intervals and preserve the valid portion of periods crossing the UUID epoch.
- b3f5de7: Close partially initialized database connections after any store startup failure,
  including PRAGMA setup, statement preparation and vocabulary loading. Preserve
  both initialization and cleanup diagnostics when closing also fails.
- b3f5de7: Align browser SQLite run results with native SQLite by completing RETURNING statements before reading affected-row counts.
- b3f5de7: Organize structured-claim validation, historical-data limits and emission measurements into linked reference sections on the website and package READMEs.
- b3f5de7: Refresh cached vocabulary on registry access and inverse reads after another
  SQLite connection commits, including on read-only connections. Live queries
  recognize new inverse and lifecycle declarations without reopening or ingesting.
- b3f5de7: Diagnose missing grouping edges after a parent is rejected while retaining independent full claims during lenient ingestion.
- b3f5de7: Generate valid resolution SQL for empty explicit policies, preserving neutral precedence and reliability defaults.
- b3f5de7: Add a runnable store API example comparing historical and current-only search before and after a retraction.
- b3f5de7: Include underlying diagnostics in combined rollback, store cleanup, descriptor,
  native text-probe and backup errors, preserving causes, error identities and
  already-published snapshot status.
- b3f5de7: Filter ordinary IS facts before materializing registry replay rows, reducing repeated action refresh costs without changing declaration semantics.
- b3f5de7: Apply historical query boundaries to qualifier parents when reconstructing
  vocabulary, preventing later lineage from removing older verb, inverse, or
  lifecycle declarations from an earlier snapshot.
- b3f5de7: Identify invalid stored claim IDs in export diagnostics and retain validation causes without changing history or adding a validation pass to successful exports.
- b3f5de7: Identify the published destination when snapshot cleanup fails after atomic publication, retaining the original cleanup failure as cause.
- b3f5de7: Include underlying cleanup and directory synchronization failure details in published-snapshot errors so backup and restore CLI diagnostics expose the cause while retaining publication status.
- b3f5de7: Keep cleanup-hook registrations independent when components share a callback, so unsubscribing one registration preserves the others.
- b3f5de7: Use indexed newer-revision checks for current-only search, avoiding whole-store grouping while preserving retraction and sensitivity semantics.
- b3f5de7: Allocate identities and insert from the prepared claim batch, preventing changing
  claim-collection getters from silently dropping claims after preparation.
- b3f5de7: Keep canonical export claims, metadata, lineage and provenance on one read snapshot so concurrent commits cannot produce mixed-state interchange text.
- b3f5de7: Keep resolution policy and claim selection on one deferred read snapshot for
  resolved beliefs, contests and resolved traversals, preventing mixed-state results
  under concurrent writes. Capture traversal options once before reading.
- b3f5de7: Hold a deferred read snapshot across inverse vocabulary checks and reverse fact
  selection, preventing concurrent commits from labeling new facts with old names.
- b3f5de7: Limit current-export historical identity maps to IDs referenced by edges, avoiding
  materialization of unrelated revisions while preserving qualifier remapping.
- b3f5de7: Reduce preparation cost for large resolution policies by materializing JSON policy rows once while retaining direct VALUES for small policies.
- b3f5de7: Add a reproducible append benchmark and document claim-capture measurements for
  simple and metadata-rich claims on both supported Node versions, including
  methodology and limits.
- b3f5de7: Add a reproducible comparison of historical and current-only search over revision-heavy histories, documenting the distinction between result limits and query work.
- b3f5de7: Extend the current-search benchmark with unrelated claim keys and document the measured cost of resolving current rows across a larger store.
- b3f5de7: Record current sparse and dense export timings after historical endpoint identity verification.
- b3f5de7: Move current-search measurements into a dedicated trial section and link it from the API guidance and benchmark index.
- b3f5de7: Apply partial resolution policy defaults to each unmatched source before aggregating source precedence and reliability.
- b3f5de7: Encode embedded quotes in literal searches for FTS4 separately from FTS5, so browser searches preserve phrase matching instead of silently returning no matches. Raw full-text syntax remains engine-specific.
- b3f5de7: Clarify the claim-record decoder's local UUID/key/canonical checks and structural validation limits, and organize field requirements into a reference table.
- b3f5de7: Preserve snapshot validation errors when closing the verification database also fails.
- b3f5de7: Reject structured claim bodies that open comments or leave literal delimiters unmatched, preserving intended comments and quoted content. Report unrepresentable authored claims as canonicalization diagnostics before storage.
- b3f5de7: Retain payload identity for textual comparison qualifiers and reject structured metrics containing non-metric value kinds.
- b3f5de7: Keep complete NUL-bearing subject and object names when grouping alias-aware resolution results.
- b3f5de7: Reject unquoted relation objects that reparse as another payload or claim modifier, while retaining ordinary object phrases and a narrow fast path for alphabetic objects.
- b3f5de7: Restore vocabulary even when transaction rollback cleanup fails, preserving both the original and cleanup errors.
- b3f5de7: Preserve inherited and non-enumerable registry and assembly options when opening stores by path instead of silently dropping them during option forwarding.
- b3f5de7: Preserve affirmative qualifier claims about an entity named NOT using an unambiguous full-claim spelling with cancelling negations.
- b3f5de7: Emit explicit claim markers for qualifier conditions whose verb is NOT, preserving claim identity and negation through canonical export and strict reimport.
- b3f5de7: Preserve complete NUL-bearing resolution policy identities, SQL prefixes and declaration source tiers.
- b3f5de7: Retain original schema migration failures as error causes and safely format opaque adapter errors after rollback.
- b3f5de7: Preserve self-referential edges during historical and current export, including self-links created by revision remapping.
- b3f5de7: Emit sigma levels as lossless plain decimals so tiny and large positive finite overrides survive canonical export and strict reimport. Reject invalid structured sigma levels during emission.
- b3f5de7: Preserve snapshot hashing or file-sync failures together with descriptor-close failures, and keep descriptor cleanup active during hash-buffer allocation.
- b3f5de7: Preserve backup and restore operation errors when temporary removal fails, and identify the temporary path for recovery.
- b3f5de7: Preserve file-detection read errors when descriptor close also fails, sharing descriptor cleanup with snapshot operations.
- b3f5de7: Reject structured context and tag metadata that splits or changes its key/value identity during canonical emission and append.
- b3f5de7: Preserve text-store replay or assembly failures when closing the failed in-memory store also throws, retaining both errors and the original cause.
- b3f5de7: Preserve combined operation and cleanup failures when a thrown value cannot be
  formatted, using a diagnostic placeholder without replacing the original errors.
- b3f5de7: Preserve claim locations and original causes when export reads throw values that cannot be formatted.
- b3f5de7: Reject unquoted value text that splits into metadata, changes whitespace or loses its value boundary during emission; retain explicit text and code literals.
- b3f5de7: Build vocabulary replacements before updating the live cache and version marker,
  preserving the previous registry when an explicit reload fails.
- b3f5de7: Preserve prototype-named SQL result columns in the browser adapter and verify result-name parity with native SQLite.
- b3f5de7: Return finite ranked precedence outside the safe-integer range through the JavaScript number API without SQLite integer-conversion errors.
- b3f5de7: Protect the source database's sidecars in the direct backup API, and recognize hard-link aliases when comparing backup and restore source/destination identity.
- b3f5de7: Refuse backup publication when the destination has SQLite sidecars, even with force, and prevent restore from writing into its source snapshot's sidecar paths.
- b3f5de7: Accumulate short file reads when detecting SQLite headers so valid databases are not misclassified as text; stop at EOF and retain descriptor cleanup.
- b3f5de7: Recheck destination sidecars immediately before backup and restore publication, preserving destinations that became live during snapshot preparation.
- b3f5de7: Record workspace and production-browser integration validation for prepared
  claim batches, captured replay edges and consistent claim storage projections.
- b3f5de7: Record full workspace and browser integration evidence for export optimization
  and the recent store/WASM lifecycle fixes.
- b3f5de7: Clarify the native scope of search benchmarks and record SQL.js/WASM verification of indexed current-only search.
- b3f5de7: Record integration validation for append-option capture and query-record object
  ownership across the workspace and production browser suite.
- b3f5de7: Record full workspace and browser integration evidence for resolution snapshots
  and the preceding store-boundary fixes.
- b3f5de7: Record transaction-index read, append and storage measurements and the explicit migration implementation task.
- b3f5de7: Refresh the live vocabulary when appended qualifier edges exclude existing declaration rows, preserving consistency with reload and transaction rollback.
- b3f5de7: Report asynchronous store cleanup callbacks explicitly, observe native Promise rejection and continue remaining cleanup and database closure.
- b3f5de7: Reject promise-like transaction results and roll back initial writes instead of committing asynchronous callbacks early.
- b3f5de7: Reject non-string term and value text before canonical formatting or structured storage can coerce it into a different value.
- b3f5de7: Reject non-string provenance actors, runs, sources and domains before SQLite can coerce them into attribution.
- b3f5de7: Reject dangling stored relationships affecting included export claims instead of silently discarding their edges.
- b3f5de7: Reject unknown provenance dimensions even when a required field is non-enumerable.
- b3f5de7: Reject programmatic text/code literals containing their own delimiter during canonical emission and structured appends, while preserving the other delimiter as content.
- b3f5de7: Reject annotated exports whose stored claim keys disagree with their semantic claims, preserving transaction identity across replay.
- b3f5de7: Reject stored numeric, unit, approximation and uncertainty projections that disagree with authored values during claim conversion and export, without rewriting historical rows.
- b3f5de7: Reject conflicting or incomplete stored claim payload columns when converting rows, preventing export from silently discarding malformed historical data.
- b3f5de7: Reject invalid stored edge roles during export instead of emitting text that loses the edge on re-import.
- b3f5de7: Reject malformed or mismatched row identities in transaction-annotated exports, preserving sensitivity scoping and existing output files on failure.
- b3f5de7: Validate direct store access modes before invoking SQLite adapters so unsupported values cannot fall through to writable connections or unrelated schema errors.
- b3f5de7: Reject unpaired UTF-16 surrogates in claim and metadata text before appending or observing replay IDs, preventing silent UTF-8 replacement during SQLite storage.
- b3f5de7: Reject unpaired Unicode surrogates in direct search and lookup arguments before SQLite can replace them and match different stored text.
- b3f5de7: Reject malformed UTF-8 before text-store replay or annotated file sync can replace claim text while retaining transaction identities.
- b3f5de7: Reject malformed stored provenance during annotated export before emitting unreplayable annotations or replacing CLI output files.
- b3f5de7: Reject malformed append provenance containers before they can be mistaken for empty attribution.
- b3f5de7: Reject unpaired Unicode surrogates in explicit provenance before annotated sync can silently replace identity text during UTF-8 storage.
- b3f5de7: Reject embedded newlines in canonical claim fields and validate structured appends even with caller-supplied raw text, preserving multiline comments and batch atomicity.
- b3f5de7: Require the search table to expose its hidden FTS search column, rejecting incompatible virtual tables such as R-trees during schema validation and diagnosis.
- b3f5de7: Reject non-binary stored approximation flags during claim reconstruction and doctor diagnostics. Verify native/browser SQLite rejection, HTTP sensitivity boundaries, unchanged data on failure and recovery after repair.
- b3f5de7: Reject non-binary stored negation and importance flags during claim conversion instead of silently treating malformed historical values as true.
- b3f5de7: Reject NUL-bearing full-text queries before SQLite can truncate raw syntax or report misleading phrase errors.
- b3f5de7: Reject an ordinary table substituted for the full-text search index during schema validation and diagnosis, even when its columns and rows match the claims.
- b3f5de7: Reject native transaction promises even when their then property is shadowed, preserving rollback and observing asynchronous rejection without invoking that property.
- b3f5de7: Reject custom transaction thenables without invoking their work after rollback, while observing native promise rejections.
- b3f5de7: Reject unsupported path-opening intents before file detection or opening, preventing unknown modes from falling through to SQLite migration access.
- b3f5de7: Reject views substituted for required SQLite tables during schema validation, so opening and diagnosis catch incompatible stores before later table operations fail.
- b3f5de7: Report snapshot directory I/O failures after publication while retaining explicit unsupported-operation fallbacks and simultaneous descriptor-close failures.
- b3f5de7: Reject structured claims with no payload unless the verb is EXISTS, preserving the parser's minimum claim rule through emission and storage.
- b3f5de7: Reject claim records whose row ID and transaction UUID disagree, matching the append and sync identity contract.
- b3f5de7: Canonicalize ordinary ingestion inside its write reservation and refresh
  vocabulary after peer commits using SQLite's data-version counter. Preserve
  the registry and cache marker on rollback, avoiding stale inverse spellings
  and repeated declaration scans during local appends.
- b3f5de7: Resolve policy declarations with large source lists without exceeding JavaScript's function-argument limit.
- b3f5de7: Include both read and release diagnostics in combined snapshot error messages,
  while retaining the original errors and read failure as the cause.
- b3f5de7: Preserve migration and rollback failures together instead of discarding rollback diagnostics.
- b3f5de7: Reject structured attribute names that change payload identity during emission, including empty, split and metadata-like labels.
- b3f5de7: Preserve native text-probe and close errors, and cache successful verification only after probe cleanup succeeds so failed initialization is retried.
- b3f5de7: Reuse prepared context and tag queries within historical export verification while preserving identity checks.
- b3f5de7: Verify sensitivity-scoped search and export across native and browser SQLite, including malformed labels, restrictive mixed labels, history and hidden-current-belief suppression.
- b3f5de7: Exercise literal phrase quoting, historical search, limit validation and rollback through the shared native/browser SQLite adapter contract.
- b3f5de7: Return immediately when scoped export selects no claims, avoiding unused lineage
  scans and historical ID maps while preserving sensitivity and snapshot behavior.
- b3f5de7: Document and isolate the native SQLite embedded-NUL decoding defect on advertised minimum Node versions.
- b3f5de7: Validate replay ID, context and provenance option arrays before copying them, including for empty appends.
- b3f5de7: Validate captured claim fields during structured-record construction using the
  same checks as decoding. Reject missing raw text, non-boolean flags and malformed
  terms, payloads or optional metadata before returning a record.
- b3f5de7: Require arrays for claim context and tag collections before construction, canonical emission, or storage capture can reinterpret malformed inputs.
- b3f5de7: Reject malformed claimsAbout alias flags instead of silently narrowing historical entity lookup.
- b3f5de7: Validate current-belief confidence thresholds before querying, consistently rejecting malformed and out-of-range values across SQLite adapters.
- b3f5de7: Validate selected current claim keys in plain exports to prevent corrupted newer claims from receiving another claim’s historical relationships.
- b3f5de7: Reject malformed current/history and transaction-annotation switches before exporting store data.
- b3f5de7: Reject corrupted historical claim keys before current-only export remaps their relationships to selected current claims.
- b3f5de7: Reject identity primary keys with non-binary collations that can collapse distinct provenance values.
- b3f5de7: Reject malformed raw-search switches and verify current read-option validation in installed packages.
- b3f5de7: Validate and capture transaction identity when constructing structured claim records, using the same invariant as record decoding. Reject malformed stored identities before publishing incompatible records.
- b3f5de7: Reject structured claim records whose stored key disagrees with the semantic claim and its contexts. Capture the key once and preserve stored data on failure.
- b3f5de7: Capture and validate provenance when constructing structured claim records, rejecting malformed entries before publication and preserving valid array ordering and duplicates independently of caller mutation.
- b3f5de7: Reject incompatible required index definitions before accepting a store, including uniqueness constraints that prevent normal claim writes.
- b3f5de7: Reject malformed expected snapshot hashes before file inspection, including trailing newlines, while accepting uppercase hexadecimal.
- b3f5de7: Reject non-string append sources before stamping claim identity or deriving actor and lifecycle provenance.
- b3f5de7: Reject incompatible numeric-column affinities that change claim range comparisons and ordering.
- b3f5de7: Reject incompatible text-column affinities before numeric coercion can collapse authored values and provenance identities.
- b3f5de7: Reject invalid structured edge roles and batch endpoint indices before inserting claims or edges.
- b3f5de7: Reject schemas missing the claim and provenance primary keys required for identity and deduplication.
- b3f5de7: Reject invalid supplied search and export sensitivity options instead of silently defaulting or returning empty results.
- b3f5de7: Reject malformed strict and lifecycle write flags before appending claims instead of silently using lenient or ordinary stamping defaults.
- b3f5de7: Validate STRICT numeric declarations so compatible stores retain fractional writes and numeric affinity.
- b3f5de7: Reject malformed negation and importance flags during claim construction, canonical emission, and atomic structured appends.
- b3f5de7: Reject structured values whose kind, numeric fields, units or approximation flag disagree with their emitted raw text, including uncertainty deltas.
- b3f5de7: Apply the existing uppercase-verb lexical rule during canonical emission and structured appends, with controls for extension verbs, terminal separators and CRLF documents.
- b3f5de7: Reject transaction indexes with incompatible collation during schema checks, migration, and database sync; verify native and WASM rollback and repair.
- b3f5de7: Reject malformed traversal and resolution boolean flags before query construction instead of silently using defaults.
- b3f5de7: Reject unquoted structured subjects that split into multiple tokens, become metadata or comments, or change literal kind during emission and append.
- b3f5de7: Validate every explicit replay ID as a canonical lowercase UUIDv7 before any
  row is inserted or the receive clock observes an ID. Reject malformed batches
  without changing stored data, vocabulary, or future transaction allocation.
  
  Database sync also rejects malformed or mismatched source id/tx values before
  copying rows, lineage, or recording a merge.
- b3f5de7: Reject snapshot verification and restore sources with SQLite sidecars, preventing WAL-only rows from being certified under a main-file checksum and then omitted during restore. Use online backup to create a standalone snapshot from a live store.
- b3f5de7: Verify claim and query record decoding against the real SQLite WebAssembly adapter, including uncertainty, trajectories, literals, oversized values, rounded interpolation and rejection of corrupted numeric projections.
- b3f5de7: Verify Gregorian calendar partitions, ISO week-year lengths, edge years and upper transaction boundaries.
- b3f5de7: Verify combined asynchronous-cleanup and database-close failures, ordered error retention, reentrant closure and corrected retry without repeating callbacks.
- b3f5de7: Verify omitted historical-row validation boundaries and repaired endpoint remapping on both SQLite adapters.
- b3f5de7: Compare indexed current-only search against current beliefs across mixed revision histories, retractions, nonmatching replacements, and result limits.
- b3f5de7: Verify current-only search captures changing option getters once per call and rejects an initially invalid value without widening search scope.
- b3f5de7: Verify current-only search observes committed replacements, retractions and restorations from another database connection without reopening or mutating earlier results.
- b3f5de7: Verify current-only search sees pending updates and retractions, then restores the original results after transaction rollback.
- b3f5de7: Verify deferred commit failure restores claims, vocabulary and transaction ownership on native and browser SQLite adapters.
- b3f5de7: Verify edge-batch rollback and corrected retry after a later foreign-key failure
  or an interrupted vocabulary refresh on both SQLite adapters.
- b3f5de7: Verify epoch-clipped historical vocabulary and later qualifier-parent visibility on native and WASM SQLite.
- b3f5de7: Verify exact confidence preservation through both SQLite adapters, canonical
  history/current export, import, and annotated sync across retraction and reassertion.
- b3f5de7: Verify export history selection, sensitivity and transaction annotations remain consistent with changing option getters on both SQLite adapters.
- b3f5de7: Verify that malformed historical fields are diagnosed only when included by export sensitivity, without changing stored claims or metadata.
- b3f5de7: Verify that installed structured-record construction rejects malformed claim
  flags, raw text, terms and payloads, and preserves a valid JSON round trip.
- b3f5de7: Verify canonical graph validation, atomic edge-write rejection and historical edge export diagnostics in installed packages.
- b3f5de7: Verify installed indexed current-only search handles revision-heavy limits, hidden replacements, retractions, and transaction rollback while historical search remains available.
- b3f5de7: Exercise metadata and provenance rejection, rollback, and corrected attribution against installed public packages in release smoke tests.
- b3f5de7: Document and verify that backup and restore require literal boolean true to replace a destination, preserving existing files for truthy nonboolean options without coercion.
- b3f5de7: Exercise asynchronous cleanup rejection, generated sensitivity preflight and digest identity, and MCP hook setup diagnostics through installed package exports.
- b3f5de7: Verify installed export commands reject malformed stored payloads and flags while preserving output and database bytes, respecting sensitivity scope and recovering after repair.
- b3f5de7: Extend installed-package smoke coverage for shadowed transaction promises, malformed Boolean samples and semantic duplicate sensitivity samples.
- b3f5de7: Verify schema-version read failures close once, retain combined cleanup errors,
  and allow a subsequent successful open on both adapters.
- b3f5de7: Verify fresh positional bindings, failed-write recovery and binary blob preservation across native and browser SQLite adapters.
- b3f5de7: Verify structured records reject malformed historical provenance and preserve repaired records through JSON encode/decode.
- b3f5de7: Verify native and WASM transaction rollback and retry after partial UUID-generation failure.
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b723c48]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [0b1f150]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
  - @cavelang/canonical@0.36.0
  - @cavelang/core@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [d64cad8]
- Updated dependencies [15c38bf]
  - @cavelang/core@0.35.0
  - @cavelang/canonical@0.35.0

## 0.34.0

### Minor Changes

- 0e502f1: `--db` names a store by content, not extension (spec §13.7): a CAVE text file replays into an in-memory store for every command that only reads (`query`, `search`, `resolve`, `check`, `export`, `report`, `generate`, `serve`, `mcp --read-only`, dry-run and `--list` modes), with `cave import` semantics. Commands that append refuse a text file and point at `cave import`; a read against a missing path is now an error instead of a silently created empty database, reads open SQLite read-only and never migrate an older store (they name the writing command that does), and dry runs open without migration. `@cavelang/store` exports `openAt`, `openText`, `kindOf`, `isStoreFile`, `LocateError`, an `access` open option (`read-only | no-migrate | migrate`), and `Schema.check`/`Schema.versionOf`; `@cavelang/sync` re-exports the shared `isStoreFile`.

### Patch Changes

- @cavelang/core@0.34.0
- @cavelang/canonical@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [cdf4ed9]
- Updated dependencies [1320911]
- Updated dependencies [0adc7d2]
  - @cavelang/core@0.33.0
  - @cavelang/canonical@0.33.0

## 0.32.3

### Patch Changes

- Updated dependencies [7c1950a]
- Updated dependencies [9c28743]
  - @cavelang/core@0.32.3
  - @cavelang/canonical@0.32.3

## 0.32.2

### Patch Changes

- Updated dependencies [a7397de]
- Updated dependencies [a1f05bc]
  - @cavelang/core@0.32.2
  - @cavelang/canonical@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies [af53c4c]
  - @cavelang/core@0.32.1
  - @cavelang/canonical@0.32.1

## 0.32.0

### Patch Changes

- Updated dependencies [377758f]
  - @cavelang/canonical@0.32.0
  - @cavelang/core@0.32.0

## 0.31.1

### Patch Changes

- @cavelang/core@0.31.1
- @cavelang/canonical@0.31.1

## 0.31.0

### Patch Changes

- @cavelang/core@0.31.0
- @cavelang/canonical@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [afce4f3]
- Updated dependencies [6035063]
- Updated dependencies [26b23cf]
  - @cavelang/core@0.30.0
  - @cavelang/canonical@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [3d2f5b9]
  - @cavelang/core@0.29.1
  - @cavelang/canonical@0.29.1

## 0.29.0

### Minor Changes

- adb88b0: Create, verify, and atomically restore exact SQLite snapshots while preserving
  row identity, transaction order, provenance, lineage, and full history.
- 6f04273: Add an explicit synchronous SQLite adapter API with declared transaction,
  full-text, extension, and backup capabilities, plus Node and SQL.js contract
  coverage that no longer relies on build-time `node:sqlite` aliases.
- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.
- 1ad5401: Add fail-closed sensitivity labels and shared audience ceilings for canonical
  exports, cited reports, and the read-only HTTP view.
- 0fe8dfa: Export composable `QuerySql` primitives for current-belief selection, alias
  closure, and transaction-time boundaries, and migrate store, CAVE-Q, shapes,
  generated clients, and views to their shared semantic contract.
- 8906d6a: Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
  strict decoders and compatibility fixtures, and use them for CLI and federated
  JSON instead of serializing internal SQLite columns.
- 0f986d1: Version SQLite stores with ordered transactional forward migrations, schema
  validation, resumable interruption behavior, and future-version rejection.

### Patch Changes

- 364dce7: Pin compact confidence, quoted full-text search, and hostile HTML rendering boundaries with regressions.
- 35a8c61: Add deterministic cross-stack performance fixtures, recorded baselines, query
  plan evidence, and CI regression thresholds.
- fe2706b: Serialize transaction ID allocation across concurrent SQLite writers.
- Updated dependencies [9022a00]
- Updated dependencies [75ed4cf]
- Updated dependencies [8003648]
- Updated dependencies [a606db4]
- Updated dependencies [03373de]
- Updated dependencies [662e6aa]
- Updated dependencies [1f5ae77]
- Updated dependencies [4d3cadc]
- Updated dependencies [3feae4f]
- Updated dependencies [5cd786d]
- Updated dependencies [27b1dc7]
- Updated dependencies [2f31c8f]
- Updated dependencies [f13c698]
- Updated dependencies [a4b41b9]
- Updated dependencies [5a96c95]
- Updated dependencies [01ca7dc]
- Updated dependencies [0ac44fd]
- Updated dependencies [0021db8]
- Updated dependencies [3526b49]
  - @cavelang/core@0.29.0
  - @cavelang/canonical@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
