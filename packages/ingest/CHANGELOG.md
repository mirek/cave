# @cavelang/ingest

## 0.36.9

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.9 release identity.

## 0.36.8

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.8 release identity.

## 0.36.7

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.7 release identity.

## 0.36.6

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.6 release identity.

## 0.36.5

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/ingest workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Extend ingestion cancellation across source fetching, cooperative in-process agents, batch boundaries and strict staged publication, preserving prior accepted lenient work.
- b3f5de7: Require positive safe-integer ingestion batch sizes and validate them before source selection, rejecting invalid CLI sizes before opening a database.

### Patch Changes

- b3f5de7: Create external ingestion-plan MCP configurations only after a batch prompt is ready, avoiding unused artifacts for empty or failed plans.
- b3f5de7: Deduplicate ingestion context path-token searches and stop lookups once the related-claim budget is filled, preserving prompt content and order.
- b3f5de7: Capture ingestion prompt settings and each file's path and content once, preserving consistent filenames, citations and embedded text for getter-backed inputs.
- b3f5de7: Capture promptFor source paths, selected contents and settings before context lookup and file reads, keeping getter-backed source selection consistent throughout prompt assembly.
- b3f5de7: Clean owned ingestion configuration directories after setup failures and place run configuration and prompts under one cleanup scope.
- b3f5de7: Mark partially accepted stdout batches explicitly so evaluation cannot score source-change failures as successful runs after direct agent writes.
- b3f5de7: Stage strict ingestion from an exact SQLite snapshot so existing provenance
  and stored claim data survive. Check the final sync report and fail the run
  when existing identities conflict instead of reporting an unapplied extraction
  as successful.
- b3f5de7: Capture cancellation error causes once and tolerate unreadable nested error
  metadata without discarding the original work or transport failure.
- b3f5de7: Preserve ingestion cleanup and cancellation failures when diagnostic formatting
  throws, retaining original error chains and strict/lenient write boundaries.
- b3f5de7: Retain ingestion command output and final-close errors when diagnostics cannot
  be formatted, covering planning and execution without changing committed writes.
- b3f5de7: Preserve HTML line-break separators during readable-text ingestion so adjacent words do not merge and preformatted lines remain distinct.
- b3f5de7: Reject nonnumeric programmatic timeouts without invoking coercion hooks in completion, ingestion and evaluation adapters. Preserve valid whole-millisecond deadlines and existing zero-timeout policies.
- b3f5de7: Reject path-based ingestion batches whose files change or become unreadable before or during an agent call, preserving retry eligibility and strict/lenient ownership.
- b3f5de7: Cancel unread HTTP error response bodies during URL ingestion while preserving the original HTTP failure and retry classification.
- b3f5de7: Report unprintable function-agent errors as failed batches while preserving
  strict isolation and lenient continuation. Share safe diagnostic formatting
  with cleanup and selected-source read checks.
- b3f5de7: Keep unprintable URL transport errors as retryable source outcomes instead of
  aborting selection, with healthy-source continuation and retry coverage.
- b3f5de7: Retain selected embedded file content with its digest so later edits cannot change the prompt under stale provenance.
- b3f5de7: Validate ingestion timeouts before opening or reading sources and convert valid decimal seconds to whole milliseconds without floating-point rejection.

## 0.28.2

### Patch Changes

- f137fe8: Preserve digest provenance for file paths that are not valid CAVE entity atoms, so unchanged files with spaces or metadata-like prefixes are skipped on later ingestion runs.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/mcp@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/mcp@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/store@0.28.0
