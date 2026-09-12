# @cavelang/sync

## 0.36.5

### Patch Changes

- Align the @cavelang/sync workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/sync workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/sync workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/sync workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/sync workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Preserve explicit provenance dimensions in optional JSON transaction-annotation
  payloads. Validate payloads and identity agreement before replay, preserve empty
  sets, and retain legacy bare annotations and ordinary imports. Database copies
  now preserve authoritative provenance tables without adding inferred entries.

### Patch Changes

- b3f5de7: Reject database sync when an existing row ID names different claim data or
  explicit provenance, before copying rows, lineage, or a merge record. Preserve
  compatibility with text replay, metadata reordering, and inferred provenance.
  Report conflicting IDs in text and JSON, including dry runs.
- b3f5de7: Reject annotated-text sync when an incoming ID names different canonical
  interchange content from an existing target row, before adding rows or lineage.
  Accept equivalent canonical spellings and reordered contexts or tags.
- b3f5de7: Normalize quotes and backticks in sync labels so merge-record comments cannot become part of the destination entity.
- b3f5de7: Reject database-file sync inside caller-owned transactions before attaching or
  copying. Prevent failed detaches from leaving merged rows and source attachments
  behind, including dry runs. Annotated-text sync remains nestable.
- b3f5de7: Preserve nested merge and cleanup errors when diagnostic formatting throws.
  Keep rollback and attachment cleanup behavior in normal and dry-run sync,
  with safe fallback text for unprintable failures.
- b3f5de7: Fix documented Git union drivers for paths containing spaces and clean up temporary databases after failed merges.
- b3f5de7: Recognize hard links to the target database as self-sync before SQLite attachment, preserving the no-op contract in ordinary and dry-run syncs.
- b3f5de7: Reserve annotated-text sync before refreshing vocabulary, validating, and
  canonicalizing input. Honor inverse declarations committed by another writer
  before the merge, while keeping dry-run registry and UUID state restoration.
- b3f5de7: Retain the original cause when adding the source filename to a sync schema
  validation error, and safely format unusual thrown values. Verify destination
  preservation, source detachment and retry in normal and dry-run modes.
- b3f5de7: Use the effective verb registry when declaring sync merge events so conditional
  vocabulary claims cannot suppress the required top-level declaration.
  Clarify that sync skips matching identities and rejects identities reused with
  different content.
- b3f5de7: Validate older versioned database sync sources against their recorded schema so missing provenance cannot silently fall back to legacy inference.
- b3f5de7: Validate every explicit replay ID as a canonical lowercase UUIDv7 before any
  row is inserted or the receive clock observes an ID. Reject malformed batches
  without changing stored data, vocabulary, or future transaction allocation.
  
  Database sync also rejects malformed or mismatched source id/tx values before
  copying rows, lineage, or recording a merge.
- b3f5de7: Document and verify rollback and retry of edge-only database and annotated-text sync when merge-record insertion fails.
- b3f5de7: Exercise the documented union driver through local Git merges, including preserved claim identities and unresolved invalid input.
- b3f5de7: Document and verify that invalid Unicode merge labels roll back sync and corrected retries preserve valid Unicode source and destination names.
- b3f5de7: Verify rollback and retry after late merge-record failures in text and database sync, including dry runs.

## 0.28.2

### Patch Changes

- 8003648: Keep sync dry-runs from advancing the process UUID transaction clock.
- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.
- 0f986d1: Version SQLite stores with ordered transactional forward migrations, schema
  validation, resumable interruption behavior, and future-version rejection.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/store@0.28.0
