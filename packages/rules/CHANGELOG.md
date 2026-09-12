# @cavelang/rules

## 0.36.2

### Patch Changes

- Align the @cavelang/rules workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/rules workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Reject invalid rule confidence thresholds and pass limits before derivation writes, and require safe integer pass counts in the CLI.

### Patch Changes

- b3f5de7: Document and verify an atomic rule replacement recipe using caller transactions, explicit report validation and corrected retries while preserving historical lineage.
- b3f5de7: Discover derivation rules through indexed declaration rows instead of materializing all current beliefs, preserving latest-version and retraction semantics.
- b3f5de7: Share indexed declaration discovery across rule derivation, listing, and retraction while preserving latest-version ordering and transactional ambiguity checks.
- b3f5de7: Track active vocabulary alongside rule transaction watermarks, re-evaluating after metadata-only mapping changes and restarting support when vocabulary changes during derivation.
- b3f5de7: Reevaluate settled rules when alias matching or the confidence floor changes, including when returning to defaults.
- b3f5de7: Add a correctness-checked benchmark for quiet runs with many settled rules and isolate evaluation-policy hashing cost.
- b3f5de7: Preserve prototype-named rule variables and require supplied action arguments to be own properties instead of inherited JavaScript values.
- b3f5de7: Re-evaluate incremental rules when mutable premise values or tags change, including equivalent numeric spellings and replacements that invalidate prior conclusions.
- b3f5de7: Avoid unused transaction-head scans for skipped rules, reducing measured 1,000-rule quiet runs from 333 ms to 80 ms.
- b3f5de7: Document and verify rollback of derived conclusions and lineage when watermark or vocabulary bookkeeping writes fail, including corrected retries and restored incremental behavior.
- b3f5de7: Verify that late derivation failures restore cascaded retractions and replacement conclusions together, preserving historical lineage and allowing an idempotent corrected retry.
- b3f5de7: Wake settled rules after new vocabulary declarations so updated mappings can match pre-existing facts.

## 0.28.2

### Patch Changes

- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.
- d3978d0: Expose incomplete derivation status and preserve suspended conclusions and watermarks when the fixpoint pass limit is exhausted.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/fusion@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/fusion@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/store@0.28.0
