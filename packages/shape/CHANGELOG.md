# @cavelang/shape

## 0.29.0

### Minor Changes

- e5ea4df: Add in-band exact-one cardinality and exact-unit constraints to `EXPECTS`,
  with actionable health reports and transactional gate enforcement.
- b899294: Generate deterministic, versioned TypeScript interfaces and store readers from
  in-band shape expectations.

### Patch Changes

- a7aded1: Let leading-character typos reach alias edit-similarity scoring.
- 37ddc5b: Evaluate shape expectations from one indexed current-belief snapshot so SQL
  query count no longer scales with instances multiplied by expectations.

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
