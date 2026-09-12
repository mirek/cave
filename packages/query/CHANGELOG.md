# @cavelang/query

## 0.36.8

### Patch Changes

- @cavelang/canonical@0.36.8
  - @cavelang/core@0.36.8
  - @cavelang/parser@0.36.8
  - @cavelang/store@0.36.8

## 0.36.7

### Patch Changes

- Updated dependencies [500f5bb]
  - @cavelang/store@0.36.7
  - @cavelang/canonical@0.36.7
  - @cavelang/core@0.36.7
  - @cavelang/parser@0.36.7

## 0.36.6

### Patch Changes

- Updated dependencies [662e98a]
  - @cavelang/core@0.36.6
  - @cavelang/canonical@0.36.6
  - @cavelang/parser@0.36.6
  - @cavelang/store@0.36.6

## 0.36.5

### Patch Changes

- @cavelang/canonical@0.36.5
  - @cavelang/core@0.36.5
  - @cavelang/parser@0.36.5
  - @cavelang/store@0.36.5

## 0.36.4

### Patch Changes

- @cavelang/canonical@0.36.4
  - @cavelang/core@0.36.4
  - @cavelang/parser@0.36.4
  - @cavelang/store@0.36.4

## 0.36.3

### Patch Changes

- @cavelang/canonical@0.36.3
  - @cavelang/core@0.36.3
  - @cavelang/parser@0.36.3
  - @cavelang/store@0.36.3

## 0.36.2

### Patch Changes

- Updated dependencies [9207b82]
- Updated dependencies [9e9d967]
  - @cavelang/core@0.36.2
  - @cavelang/canonical@0.36.2
  - @cavelang/parser@0.36.2
  - @cavelang/store@0.36.2

## 0.36.1

### Patch Changes

- Updated dependencies [7a3cad1]
  - @cavelang/core@0.36.1
  - @cavelang/canonical@0.36.1
  - @cavelang/parser@0.36.1
  - @cavelang/store@0.36.1

## 0.36.0

### Minor Changes

- b3f5de7: Detect historical rows and lineage added below a pagination cutoff, rejecting
  stale cursors and changes during page construction with a restart instruction.
  Preserve continuation across wholly future appends. Version opaque cursors to
  include a bounded append revision; keep the public page envelope unchanged.
- b3f5de7: Reject bare question marks as unnamed query variables, preserving ordinary prose question marks in reports and directing callers to named variables or wildcards.
- b3f5de7: Reject empty variable names in programmatic matching patterns, consistently with textual CAVE-Q queries.
- b3f5de7: Reject holes in query-record support arrays instead of skipping their nested claim validation. Object input now agrees with its JSON representation, while empty arrays and valid supporting claims remain accepted.
- b3f5de7: Validate optional interpolation metadata when decoding query records. Reject malformed objects, nonfinite or nonnumeric values, nonstring text and nonstring supplied units while preserving valid interpolated records and records without interpolation.

### Patch Changes

- b3f5de7: Batch valid-time and exact-number page reads within remaining match capacity while preserving continuation and scan limits. Add a reproducible pagination benchmark.
- b3f5de7: Capture pagination options once so inherited, non-enumerable and accessor values stay consistent between execution and cursor identity.
- b3f5de7: Capture query options before historical vocabulary lookup, SQL compilation and post-filtering so changing getters cannot move the transaction boundary or row cap.
- b3f5de7: Capture query match fields before evidence projection so repeated getters or caller mutation cannot replace bindings, interpolation metadata or evidence rows during structured-record construction.
- b3f5de7: Capture object query records before validation so changing getters and later
  caller mutation cannot invalidate decoded bindings or interpolation metadata.
  Retain plain-object binding map validation.
- b3f5de7: Capture queryRecords options before creating its snapshot so adapter callbacks cannot replace the requested limit or historical boundary. Share option capture with ordinary matching.
- b3f5de7: Capture structured query pattern fields before numeric detection and compilation so changing getters cannot select a different term between stages.
- b3f5de7: Verify raw JSON exponent overflow is rejected in query interpolation and nested claim/support confidence, while large finite interpolation values and valid fixtures remain decodable.
- b3f5de7: Verify read-only opens reject legacy stores awaiting provenance migration and
  clarify that ordinary reopens preserve authoritative provenance metadata.
- b3f5de7: Handle pre-1970 transaction periods as empty intervals and preserve the valid portion of periods crossing the UUID epoch.
- b3f5de7: Add a reproducible current-belief SQL comparison across distinct and heavily revised claim keys, documenting why a blanket correlated-query replacement was rejected.
- b3f5de7: Compile long WHERE filter lists with bounded SQL while preserving comparison, NULL, metadata and transaction semantics.
- b3f5de7: Include selected source SHA-256 hashes and Node launch arguments in raw query-record benchmark reports, distinguishing loader-based baselines and later source revisions without relying solely on a separate review artifact.
- b3f5de7: Keep numeric and valid-time page windows and record projection in one read snapshot, while retaining post-read revision checks for historical peer writes.
- b3f5de7: Keep queryRecords matching and structured-record projection in one read snapshot, preventing concurrent tag or provenance changes from mixing database states. Preserve caller transactions and projection errors.
- b3f5de7: Read resolved query policy, vocabulary and candidate claims within one deferred
  database snapshot, preventing mixed results across concurrent writes. Preserve
  caller transactions and combined read/release errors.
- b3f5de7: Keep vocabulary and claims on one read snapshot for ordinary query matching as
  well as resolved queries, preventing concurrent inverse-verb changes from mixing
  old meanings with new claims.
- b3f5de7: Measure full valid-time, exact-number and selective pagination traversal with snapshot, completeness and termination checks.
- b3f5de7: Record current pagination latency and complete-traversal baselines on both supported Node majors with raw samples.
- b3f5de7: Compare late full-row fetch with current pagination SQL and retain the measured revised-history tradeoff.
- b3f5de7: Measure and document incremental query-match capture and metadata validation cost with a guarded prior-constructor baseline, retaining nested claim/provenance capture and snapshots. Preserve paired supported-runtime reports, source hashes and workload limits.
- b3f5de7: Add reproducible paired measurements for structured-record validation and projection snapshots across memory/WAL stores, metadata sizes and caller transactions. Record raw samples and measured limits.
- b3f5de7: Document a reproducible query snapshot trial across memory and read-only WAL
  stores, caller transactions and both supported Node versions, with resolved
  queries as controls and explicit measurement limits.
- b3f5de7: Extend the pagination benchmark with a selective one-result page and document its remaining query cost.
- b3f5de7: Document paired measurements of claim/provenance capture and provenance validation across supported Node versions, memory and WAL stores, metadata sizes and caller transactions. Retain raw samples and guarded baseline tooling; clarify the earlier trial's historical source dependency.
- b3f5de7: Use tuple membership for bounded unresolved direct queries, preserving historical belief selection while reducing measured pagination cost.
- b3f5de7: Report filter errors using original query line numbers, including blank and comment lines, for both LF and CRLF input.
- b3f5de7: Add reproducible pagination cost attribution and record SQL-window dominance on both supported Node majors.
- b3f5de7: Preserve __proto__ query variables as ordinary own bindings in direct and transitive results, including JSON serialization.
- b3f5de7: Match large context and tag lists without growing SQL expression depth, and retain incremental rule wake-up for large context premises.
- b3f5de7: Record equality-preserving current-row join trials and retain the production plan after unsuccessful alternatives.
- b3f5de7: Record integration validation for append-option capture and query-record object
  ownership across the workspace and production browser suite.
- b3f5de7: Record the complete Node 24 integration checkpoint after query snapshot,
  projection concurrency and provenance migration checks, retaining separate
  browser and hosted-release verification boundaries.
- b3f5de7: Reject unpaired UTF-16 surrogates in textual and structured queries before SQLite can turn them into replacement-character matches.
- b3f5de7: Reject non-finite confidence filter thresholds before SQL execution while retaining finite comparisons.
- b3f5de7: Reject explicit null page limits instead of silently selecting the default page size.
- b3f5de7: Reject null SQL-window offsets and expand malformed-bound coverage for compilation and query execution.
- b3f5de7: Reject non-plain query bindings objects that change shape or lose contents during JSON serialization.
- b3f5de7: Retain direct indexed lookups for small metadata lists while using bounded SQL for large query and rule requirements.
- b3f5de7: Track raw candidate positions internally so selective small pages use bounded batch reads without skipping later matches. The packed declaration snapshot is refreshed for the two internal window signatures; exported API declarations are unchanged.
- b3f5de7: Decode supporting query evidence by array index so custom iterators cannot discard records or bypass nested validation.
- b3f5de7: Share binding-map and interpolation validation between query-record construction and decoding. Reject malformed metadata and sparse/non-object support rows before evidence projection while retaining valid plain/null-prototype maps and numeric precision independent of display rounding.
- b3f5de7: Reject unsafe integer SQL limits and offsets with a CAVE-Q validation error
  before binding them. Preserve support for the full safe-integer range.
- b3f5de7: Validate query syntax, time anchors, and incompatible options even when a
  paginated query has no rows at its requested snapshot. CLI text and JSON
  requests now reject these errors consistently on empty and populated stores.
- b3f5de7: Verify and document query records retaining interpolation precision alongside rounded display text and value-slot bindings. Preserve valid rounded records through encoding and decoding.
- b3f5de7: Verify raw-value projection consistency throughout direct and supporting query evidence, including scalar values, trajectories and uncertainty. Document the nested decoder contract.
- b3f5de7: Clarify the finite-value fallback for interpolated record display text and
  record integration verification of the stricter external record decoders.
- b3f5de7: Verify malformed Unicode query errors and recovery through the production playground editor and worker.
- b3f5de7: Verify numeric and valid-time page projection failures preserve caller transactions, retain combined projection/release errors and permit retry after savepoint release.
- b3f5de7: Verify direct and transitive pagination across peer alias retractions and document frozen alias resolution.
- b3f5de7: Verify historical query resolution composes alias membership and source precedence at the same transaction cutoff, including later alias retraction.
- b3f5de7: Verify malformed pagination encodings and fields fail without disrupting valid continuation.
- b3f5de7: Verify Unicode preservation and consistent pagination options through installed store/query package exports.
- b3f5de7: Verify reusable direct-query cursors retain equal-valued claims across later revisions and retractions, including exact-number filtering.
- b3f5de7: Verify direct and transitive query-record failure and repair recovery for malformed stored provenance inside caller-owned transactions, including retained staged data and a later caller rollback. Clarify valid empty provenance arrays versus malformed empty entries.
- b3f5de7: Verify query-record projection and cleanup error preservation with same-transaction retry.
- b3f5de7: Verify ordinary and transitive-support query records retain their selected rows
  and metadata when a peer appends during projection, and document this boundary.
- b3f5de7: Verify bounded historical pagination and filtered continuations on the browser SQLite adapter.
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
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
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
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
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
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
  - @cavelang/store@0.36.0
  - @cavelang/parser@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [d64cad8]
- Updated dependencies [15c38bf]
  - @cavelang/core@0.35.0
  - @cavelang/canonical@0.35.0
  - @cavelang/parser@0.35.0
  - @cavelang/store@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [0e502f1]
  - @cavelang/store@0.34.0
  - @cavelang/core@0.34.0
  - @cavelang/parser@0.34.0
  - @cavelang/canonical@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [cdf4ed9]
- Updated dependencies [1320911]
- Updated dependencies [857aa3c]
- Updated dependencies [0adc7d2]
  - @cavelang/core@0.33.0
  - @cavelang/parser@0.33.0
  - @cavelang/canonical@0.33.0
  - @cavelang/store@0.33.0

## 0.32.3

### Patch Changes

- Updated dependencies [658d9fb]
- Updated dependencies [7c1950a]
- Updated dependencies [9c28743]
  - @cavelang/parser@0.32.3
  - @cavelang/core@0.32.3
  - @cavelang/canonical@0.32.3
  - @cavelang/store@0.32.3

## 0.32.2

### Patch Changes

- Updated dependencies [a7397de]
- Updated dependencies [a1f05bc]
  - @cavelang/core@0.32.2
  - @cavelang/canonical@0.32.2
  - @cavelang/parser@0.32.2
  - @cavelang/store@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies [af53c4c]
  - @cavelang/core@0.32.1
  - @cavelang/canonical@0.32.1
  - @cavelang/parser@0.32.1
  - @cavelang/store@0.32.1

## 0.32.0

### Patch Changes

- Updated dependencies [377758f]
  - @cavelang/canonical@0.32.0
  - @cavelang/store@0.32.0
  - @cavelang/core@0.32.0
  - @cavelang/parser@0.32.0

## 0.31.1

### Patch Changes

- @cavelang/core@0.31.1
- @cavelang/parser@0.31.1
- @cavelang/canonical@0.31.1
- @cavelang/store@0.31.1

## 0.31.0

### Patch Changes

- @cavelang/core@0.31.0
- @cavelang/parser@0.31.0
- @cavelang/canonical@0.31.0
- @cavelang/store@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [afce4f3]
- Updated dependencies [6035063]
- Updated dependencies [26b23cf]
  - @cavelang/core@0.30.0
  - @cavelang/canonical@0.30.0
  - @cavelang/parser@0.30.0
  - @cavelang/store@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [3d2f5b9]
  - @cavelang/core@0.29.1
  - @cavelang/canonical@0.29.1
  - @cavelang/parser@0.29.1
  - @cavelang/store@0.29.1

## 0.29.0

### Minor Changes

- 9d3c617: Add SQL-bounded, transaction-snapshot-stable CAVE-Q pagination to the library,
  CLI, and MCP query surfaces, with protective defaults and opaque continuations.
- 8906d6a: Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
  strict decoders and compatibility fixtures, and use them for CLI and federated
  JSON instead of serializing internal SQLite columns.

### Patch Changes

- c73479a: Remove the silent 32-hop limit from transitive queries by using cycle-safe reachable-pair recursion.
- 35a8c61: Add deterministic cross-stack performance fixtures, recorded baselines, query
  plan evidence, and CI regression thresholds.
- f4461c2: Seed transitive recursion from concrete source or destination endpoints while preserving unbound and support semantics.
- Updated dependencies [9022a00]
- Updated dependencies [75ed4cf]
- Updated dependencies [8003648]
- Updated dependencies [a606db4]
- Updated dependencies [03373de]
- Updated dependencies [662e6aa]
- Updated dependencies [1f5ae77]
- Updated dependencies [adb88b0]
- Updated dependencies [6f04273]
- Updated dependencies [387edea]
- Updated dependencies [4d3cadc]
- Updated dependencies [364dce7]
- Updated dependencies [3feae4f]
- Updated dependencies [5cd786d]
- Updated dependencies [27b1dc7]
- Updated dependencies [2f31c8f]
- Updated dependencies [f13c698]
- Updated dependencies [a4b41b9]
- Updated dependencies [1ad5401]
- Updated dependencies [5a96c95]
- Updated dependencies [0fe8dfa]
- Updated dependencies [8906d6a]
- Updated dependencies [35a8c61]
- Updated dependencies [fe2706b]
- Updated dependencies [01ca7dc]
- Updated dependencies [0ac44fd]
- Updated dependencies [0021db8]
- Updated dependencies [0f986d1]
- Updated dependencies [3526b49]
  - @cavelang/core@0.29.0
  - @cavelang/store@0.29.0
  - @cavelang/canonical@0.29.0
  - @cavelang/parser@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/store@0.28.0
