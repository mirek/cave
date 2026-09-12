# @cavelang/connect

## 0.36.7

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.7 release identity.

## 0.36.6

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.6 release identity.

## 0.36.5

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/connect workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Reject non-finite numeric fields, including nested structured values, before SQL staging can replace them with NULL or pass through infinities.
- b3f5de7: Resolve connector fields only from own properties, treating inherited JavaScript properties as missing while preserving explicit JSON keys and nested array access.
- b3f5de7: Reject CSV/TSV rows with excess cells instead of silently discarding values beyond the header, preserving existing missing-cell defaults.
- b3f5de7: Reject unterminated CSV and TSV quoted fields with their opening line number before mapping or pruning can change the store.
- b3f5de7: Reject duplicate CSV/TSV header names after trimming instead of silently keeping the later cell, including header-only sources and SQL staging.
- b3f5de7: Reject non-scalar and non-finite connector record keys instead of coercing them into colliding identities, preserving pruning safeguards for unidentified records.
- b3f5de7: Reject stray CSV quotes and text following closed quoted fields before mapping or pruning, reporting the physical source line instead of silently altering values.
- b3f5de7: Validate CSV/TSV delimiters in the shared reader, rejecting empty or multi-character delimiters and quote/newline conflicts before parsing any source.

### Patch Changes

- b3f5de7: Propagate cancellation through declared URL preparation and discovery, prevent application after abort, and stop queued watch work while preserving resource cleanup.
- b3f5de7: Propagate caller cancellation through direct connector URL fetches and body reads, and reject returned records before mapping or committing after abort.
- b3f5de7: Consolidate connector refresh failure and recovery guidance, distinguishing source rejection, record isolation, pruning rollback and transactional declaration replacement.
- b3f5de7: Close previously registered watchers if later registration fails during direct or declared connector watch startup.
- b3f5de7: Clarify that declared-source retractions affect their own belief series and can
  expose another source's surviving path, without automatically retiring imported
  data.
- b3f5de7: Recognize NDJSON and JSONL HTTP media types before generic JSON, normalize media-type casing, and retain explicit format overrides.
- b3f5de7: Document JSON number precision and verify that quoted large identifiers and exact decimal strings survive local and HTTP loading and SQL projection.
- b3f5de7: Read direct SQLite source integers without range errors, preserving unsafe integers as exact decimal text just like SQL over staged records.
- b3f5de7: Infer TSV sources from the text/tab-separated-values HTTP content type, including extensionless endpoints, while preserving explicit format overrides and source line spans.
- b3f5de7: Capture connector command output through injected streams so integration tests cannot swallow test-runner events or hide reported test results.
- b3f5de7: Include the source path or URL and physical line number in JSONL syntax errors, retaining the underlying parser error as the cause.
- b3f5de7: Stage absent JSON fields as SQL NULL even when their names match inherited JavaScript properties, preserving explicitly supplied values.
- b3f5de7: Preserve declaration assembly's LocateError classification, source context and
  original cause when preparation errors cannot be formatted.
- b3f5de7: Capture cancellation error causes once and tolerate unreadable nested error
  metadata without discarding the original work or transport failure.
- b3f5de7: Safely format connector command, watch and owned-store cleanup failures.
  Preserve operation and close diagnostics across direct and declared command
  modes, including errors without printable messages.
- b3f5de7: Preserve discovery and declaration-scratch failures when cleanup diagnostics
  cannot be formatted. Keep original errors, causes and remaining cleanup attempts.
- b3f5de7: Preserve simultaneous cancellation and transport failures when diagnostic
  formatting throws, retaining original aggregate members and cause for both
  fetch startup and response-body failures.
- b3f5de7: Preserve original SQL errors during empty-source column inference when their
  messages are unreadable or non-string, without retrying the failed staging run.
- b3f5de7: Preserve explicitly quoted empty CSV/TSV records, including final records without a newline, while continuing to ignore blank lines.
- b3f5de7: Capture federated JSON query records before rolling back temporary source claims, preserving their contexts and provenance for direct and declared queries. Retain partial results and nonzero status on mapping failures.
- b3f5de7: Cancel unread HTTP error response bodies while preserving the original URL and status diagnostic if cleanup fails.
- b3f5de7: Recheck connector record and prelude digests under the write reservation so concurrent identical refreshes skip duplicate appends while force retains its behavior.
- b3f5de7: Retain the unusable-source-name diagnostic when an invalid programmatic value cannot be serialized, and verify rejection before writes plus idempotent recovery.
- b3f5de7: Close obsolete declared-source and mapping watchers after declaration changes and ignore their late callbacks.
- b3f5de7: Report declared watcher refresh failures without rejecting scheduled work, preserving existing subscriptions so the next save can retry.
- b3f5de7: Stop queued direct connector watch passes and ignore file callbacks after cancellation, matching declared watch shutdown.
- b3f5de7: Discover and retire vanished connector records within one write transaction, preventing stale prune lists and rolling back the whole pruning phase on failure.
- b3f5de7: Validate and capture connector source contexts before lifecycle writes so invalid source identities or later line spans cannot leave partial prelude or record updates.
- b3f5de7: Verify connector report counts, per-record rollback and retry behavior when ingestion rejects one record while another updates and absent records are pruned.
- b3f5de7: Verify and document that direct and declared federated JSON queries roll back temporary claims and emit no JSON when stored-record projection fails, then recover after the malformed record is repaired.
- b3f5de7: Verify direct and declared federated JSON recovery from malformed stored provenance, including no partial output and preservation of claim, context, provenance, tag and edge history on projection failure and successful retry after repair.
- b3f5de7: Verify extensionless HTTP TSV imports preserve history after malformed refreshes with pruning enabled and resume idempotent updates after correction.
- b3f5de7: Verify interrupted native HTTP response bodies preserve imported history under pruning, identify the failing source and allow an idempotent retry after recovery.
- b3f5de7: Verify that malformed selected JSON records preserve existing claims and transaction history under pruning, with normal update, pruning and idempotent recovery after correction.
- b3f5de7: Verify and document that malformed JSONL refreshes preserve prior claims under pruning and recover idempotently after correction.
- b3f5de7: Verify native HTTP refreshes reject malformed UTF-8 before pruning imported records, preserve history across failures, and resume updates and idempotent refreshes after correction.
- b3f5de7: Verify record and digest rollback after a connector write exception, preservation of earlier commits, and idempotent retry through remaining records and pruning.
- b3f5de7: Document and verify whole-array validation and recovery for selected JSON records across synchronous, asynchronous local and HTTP source loaders.

## 0.28.2

### Patch Changes

- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.
- 8906d6a: Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
  strict decoders and compatibility fixtures, and use them for CLI and federated
  JSON instead of serializing internal SQLite columns.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/store@0.28.0
