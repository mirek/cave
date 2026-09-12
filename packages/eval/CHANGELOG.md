# @cavelang/eval

## 0.36.7

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.7 release identity.

## 0.36.6

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.6 release identity.

## 0.36.5

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/eval workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Minor Changes

- b3f5de7: Reject invalid evaluation repetition counts before suite discovery or agent work, requiring positive safe integers in the library and CLI.
- b3f5de7: Reject non-finite and out-of-range evaluation tolerances before agent work and in direct scoring calls, enforcing the documented 0–1 range.

### Patch Changes

- b3f5de7: Mark partially accepted stdout batches explicitly so evaluation cannot score source-change failures as successful runs after direct agent writes.
- b3f5de7: Explain bare evaluation queries that the golden fixture cannot answer as no matches, alongside existing missing and unexpected binding details.
- b3f5de7: Index JSON syntax in linear time before decoding judge answers, avoiding repeated scans of malformed nested spans while preserving recovery and scoring.
- b3f5de7: Preserve evaluation cleanup and cancellation failures when diagnostic messages
  or nested error metadata cannot be read, without continuing cancelled runs.
- b3f5de7: Add a reproducible malformed-judge parsing benchmark and document the observed scaling issue and compatibility-preserving optimization requirements.
- b3f5de7: Propagate evaluation cancellation instead of converting it into failed runs or judge scores, stop later agent calls, and preserve throwaway-store cleanup.
- b3f5de7: Recover judge answers after malformed prose quotes without reinterpreting strings inside valid JSON arrays as separate answers.
- b3f5de7: Reject nonnumeric programmatic timeouts without invoking coercion hooks in completion, ingestion and evaluation adapters. Preserve valid whole-millisecond deadlines and existing zero-timeout policies.
- b3f5de7: Keep unprintable evaluation errors as failed-run notes instead of aborting
  report construction, sharing safe formatting with resource cleanup.
- b3f5de7: Preserve useful tolerance and run-count validation diagnostics for unprintable programmatic settings in evaluation and direct scoring.
- b3f5de7: Keep unprintable query execution errors as failed evaluation expectations so later checks can run and reports remain serializable.
- b3f5de7: Preserve valid judge pairings beside JSON strings containing brackets and recover balanced answers after unfinished prose brackets.
- b3f5de7: Document and verify evaluation scoring across actor changes, lifecycle ownership, and separate content sources without mutating stored provenance.

## 0.28.2

### Patch Changes

- ea4eb19: Accept inline comments on eval query expectation lines.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/ingest@0.28.1
  - @cavelang/loop@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/ingest@0.28.0
  - @cavelang/loop@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/store@0.28.0
