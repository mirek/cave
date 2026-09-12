# @cavelang/act

## 0.36.9

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.9 release identity.

## 0.36.8

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.8 release identity.

## 0.36.7

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.7 release identity.

## 0.36.6

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.6 release identity.

## 0.36.5

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/act workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Preserve prototype-named rule variables and require supplied action arguments to be own properties instead of inherited JavaScript values.

### Patch Changes

- b3f5de7: Document and verify metadata-only action template edits: unchanged effects preserve their stored tags and lineage until their key, value or confidence changes.
- b3f5de7: Align architecture and shape-gate references with deferred action snapshots, and verify that malformed shapes block writes while unchanged actions remain read-only.
- b3f5de7: Explain and verify mixed action imports: an invalid replacement retains the previous body while valid metadata and other declarations apply, and corrected retries remain idempotent.
- b3f5de7: Select action declaration series inside the retraction transaction so peer commits before the write reservation are included and already-completed retractions append nothing.
- b3f5de7: Skip full shape snapshots for entirely unchanged actions while retaining before/after gating for every execution that changes an effect.
- b3f5de7: Resolve named action attributes with a targeted latest-row query, preserving source-series and disabled-declaration semantics while avoiding whole-store materialization per firing.
- b3f5de7: Reject nonnumeric action hook timeouts with the normal validation report before coercion, action writes or lazy hook lookup.
- b3f5de7: Verify and document action lineage across effect updates, no-ops, dry runs and database reopen.
- b3f5de7: Document and verify that hook timeouts retain committed action history and that repeating an unchanged action does not retry its external side effect.
- b3f5de7: Verify that existing action effects cannot bypass premises invalidated by local or peer-written qualifier edges, while preserving past effect lineage.
- b3f5de7: Document and verify atomic rollback and retry of multi-series action retractions, including preservation of past effects and their lineage.
- b3f5de7: Verify and document that a successful no-op action retry preserves committed history without rerunning a previously failed hook, while a new effect runs the corrected hook.

## 0.29.0

### Minor Changes

- 1b0fd3c: Add bounded verification workflows, an allowlisted Z3 CLI fixture, and governed execution of solver action proposals.

### Patch Changes

- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/connect@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/rules@0.28.1
  - @cavelang/shape@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/connect@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/rules@0.28.0
  - @cavelang/shape@0.28.0
  - @cavelang/store@0.28.0
