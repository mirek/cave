# @cavelang/query

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
