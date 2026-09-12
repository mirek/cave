# @cavelang/mcp

## 0.36.9

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.9 release identity.

## 0.36.8

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.8 release identity.

## 0.36.7

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.7 release identity.

## 0.36.6

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.6 release identity.

## 0.36.5

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/mcp workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Patch Changes

- b3f5de7: Detect historical rows and lineage added below a pagination cutoff, rejecting
  stale cursors and changes during page construction with a restart instruction.
  Preserve continuation across wholly future appends. Version opaque cursors to
  include a bounded append revision; keep the public page envelope unchanged.
- b3f5de7: Preserve MCP operation and cleanup failures when thrown values cannot be
  formatted. Use a stable diagnostic fallback without replacing original errors,
  and cover source-token rejection through the CLI before database startup.

## 0.29.0

### Minor Changes

- 38a275d: Add explicit immutable solver-result recording and separate MCP permissions for evaluation, recording, and action execution.

### Patch Changes

- edbbde1: Make the emitting composite build canonical and verify clean and incremental build behavior in CI.
- b5c0877: Reject `cave mcp --src` values that already include the `src:` prefix, and split the bug ledger into self-contained files.
- adb88b0: Create, verify, and atomically restore exact SQLite snapshots while preserving
  row identity, transaction order, provenance, lineage, and full history.
- d3978d0: Expose incomplete derivation status and preserve suspended conclusions and watermarks when the fixpoint pass limit is exhausted.
- 8906d6a: Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
  strict decoders and compatibility fixtures, and use them for CLI and federated
  JSON instead of serializing internal SQLite columns.
- dbc0d59: Validate units in the shared fusion library, convert fixed-duration estimates, and expose typed failures consistently to adapters.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/act@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/fusion@0.28.1
  - @cavelang/loop@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/rules@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/act@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/fusion@0.28.0
  - @cavelang/loop@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/rules@0.28.0
  - @cavelang/store@0.28.0
