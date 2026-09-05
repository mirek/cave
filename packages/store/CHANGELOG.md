# @cavelang/store

## 0.35.0

### Patch Changes

- Updated dependencies [d64cad8]
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
