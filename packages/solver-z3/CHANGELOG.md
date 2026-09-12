# @cavelang/solver-z3

## 0.36.9

### Patch Changes

- @cavelang/solver@0.36.9

## 0.36.8

### Patch Changes

- Updated dependencies [be7359c]
  - @cavelang/solver@0.36.8

## 0.36.7

### Patch Changes

- @cavelang/solver@0.36.7

## 0.36.6

### Patch Changes

- @cavelang/solver@0.36.6

## 0.36.5

### Patch Changes

- @cavelang/solver@0.36.5

## 0.36.4

### Patch Changes

- @cavelang/solver@0.36.4

## 0.36.3

### Patch Changes

- @cavelang/solver@0.36.3

## 0.36.2

### Patch Changes

- @cavelang/solver@0.36.2

## 0.36.1

### Patch Changes

- @cavelang/solver@0.36.1

## 0.36.0

### Minor Changes

- b3f5de7: Add a report-scoped cumulative explanation-work limit and workflow CLI option, preserving backend outcomes and historical recorded limits.
- b3f5de7: Reject Z3 deadlines beyond the timer range with an unknown backend-error result before compilation, preventing overflow from triggering an immediate interrupt.
- b3f5de7: Expose --max-explanation-bits in the named workflow CLI, validating it before adapter startup and carrying it into recorded report limits.

### Patch Changes

- b3f5de7: Add task navigation to the Z3 adapter guide for setup, runtime ownership, model semantics and diagnostics.
- 0b1f150: Give large forced-GC cleanup diagnostics a bounded shared-runner time budget without reducing their workload or correctness assertions.
- b3f5de7: Require finite matching objective bounds attained by the returned model before claiming optimality. Unbounded and unattained objectives now return unknown instead of false proofs of optimality.
- b3f5de7: Attempt and await every worker termination before reporting Z3 shutdown failures.
- b3f5de7: Submit generated domain bounds in bounded batches so raised variable limits do not cause JavaScript argument-list overflow in feasibility or optimization.
- b3f5de7: Compile wide Boolean expressions in bounded groups so models within the expression-node budget do not fail on JavaScript argument limits.
- b3f5de7: Close the benchmark runtime on failed checks or thrown solver errors as well as successful measurement runs.
- b3f5de7: Ensure the quick-start example closes its owned runtime when validation or solving fails and clarify shared-service ownership.
- b3f5de7: Contain deadline interrupt exceptions within pending Z3 checks and preserve safe cleanup ordering.
- b3f5de7: Clarify shutdown ordering relative to pending native checks and record the reviewed Z3 lifecycle and failure-preservation boundaries.
- b3f5de7: Clarify the prepared application boundary and record Z3 translation, exact values, priorities and proof review evidence.
- b3f5de7: Drain queued native releases after failures and retain original Z3 check errors with cleanup diagnostics.
- b3f5de7: Include deadline and error helpers in diagnostic source fingerprints and record current bounded timeout/recovery results.
- b3f5de7: Use fresh unsat-core tracker symbols so user variable names cannot collide with internal trackers and produce false infeasibility results.
- b3f5de7: Include dependency version, canonical fixture digest and verified-check count in benchmark JSON summaries.
- b3f5de7: Index sorted enum member codes once per compilation to avoid repeated literal scans while preserving exact members and fresh-request mappings.
- b3f5de7: Compile deep portable expressions without recursive JavaScript stack exhaustion, reusing shared terms only within the current model.
- b3f5de7: Extend the memory recovery diagnostic with the 75,000-variable feasibility and optimization sequence and subsequent runtime probes.
- 0b1f150: Resolve Z3 process-test fixture URLs as native filesystem paths on Windows and percent-encoded checkout paths.
- b3f5de7: Return workflow startup and shutdown failures consistently while preserving earlier execution diagnostics.
- b3f5de7: Preserve original operation errors when owned Z3 solver or optimizer release also fails.
- b3f5de7: Record current macOS Node 24/26 solver benchmark measurements separately from historical Linux results.
- b3f5de7: Reject workflow CLI timeouts above Z3's supported timer range before adapter startup.
- b3f5de7: Include original check and interrupt diagnostics in combined Z3 deadline errors.
- b3f5de7: Keep worker failure details visible and prevent exception formatting from bypassing workflow cleanup or error results.
- b3f5de7: Retry expired Z3 check interrupts until settlement and add a bounded responsiveness and recovery diagnostic.
- b3f5de7: Defer native reference cleanup during asynchronous Z3 checks to prevent garbage-collection races that corrupt optimization results or crash the runtime.
- b3f5de7: Wait for pending Z3 shutdown before creating a replacement runtime, and share one close promise so repeated old-runtime closes cannot affect the replacement.
- b3f5de7: Give the large memory-recovery diagnostic an explicit numeric-digit budget for its 75,000 bounded variables so it reaches the intended Z3 stress checks.
- b3f5de7: Exercise solver suites and the large forced-GC cleanup regression in the supported-runtime CI matrix, and distinguish historical benchmark figures from current runtime coverage.
- b3f5de7: Record full Node 24 and 26 integration and installed-package checks for combined Z3 lifecycle fixes.
- b3f5de7: Verify competing objectives honor declaration order ahead of weighted soft preferences and preserve prior results after reordered submission.
- b3f5de7: Verify current validation and Z3 translation through full workspace runs on both supported Node majors and update the integration checkpoint.
- b3f5de7: Verify the current declaration validation, enum compilation and expanded solver regressions through the full Node 26 workspace suite.
- b3f5de7: Record current ten-cycle Z3 memory-limit recovery checks on both supported Node majors with source fingerprints.
- b3f5de7: Verify the benchmark's exact assignment and optimum on every solve before reporting performance measurements.
- b3f5de7: Verify packed Z3 enum code mappings preserve exact members across domain changes and cleanly close the runtime.
- b3f5de7: Verify a live solver timeout permits an immediate successful solve on the same runtime while preserving the earlier result.
- b3f5de7: Verify sensitivity preflight, corrected-limit recovery, exact sample assignments and authored-model report identity through the real Z3 adapter.
- b3f5de7: Check live Boolean operator truth tables and mixed integer/real conditional translation across all Boolean input pairs.
- b3f5de7: Record native memory-recovery diagnostics and installed-package verification after queued cleanup failure handling.
- b3f5de7: Verify exact fractional soft-weight compilation and document its numeric-budget and formatting boundary.
- b3f5de7: Record full Node 24 and 26 integration and installed-package verification for Z3 interrupt-failure containment.
- b3f5de7: Verify stable core IDs after both feasibility and optimization, and clarify the optional follow-up core check.
- b3f5de7: Await Node worker exits before Emscripten clears the Z3 pool's message handlers, eliminating a timer-dependent shutdown race.
- b3f5de7: Add a repeatable memory-limit recovery diagnostic with forced garbage collection, exact optimization checks, and runtime metadata for investigating intermittent Wasm failures.
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
  - @cavelang/solver@0.36.0

## 0.35.0

### Patch Changes

- @cavelang/solver@0.35.0

## 0.34.0

### Patch Changes

- @cavelang/solver@0.34.0

## 0.33.0

### Patch Changes

- @cavelang/solver@0.33.0

## 0.32.3

### Patch Changes

- 4f8ad1f: Bump routine dependencies: `z3-solver` 4.16.0 → 5.2.0 (Z3 5.1.0), website `vite`, `@vitejs/plugin-react`, React 19.2.8 and its type packages, `@types/node` 22.20.1, and the `actions/checkout`, `actions/setup-node`, and `pnpm/action-setup` workflow actions. Dependabot now leaves `@types/vscode` aligned with `engines.vscode` and treats a TypeScript major as a deliberate migration.
  - @cavelang/solver@0.32.3

## 0.32.2

### Patch Changes

- @cavelang/solver@0.32.2

## 0.32.1

### Patch Changes

- @cavelang/solver@0.32.1

## 0.32.0

### Patch Changes

- @cavelang/solver@0.32.0

## 0.31.1

### Patch Changes

- @cavelang/solver@0.31.1

## 0.31.0

### Patch Changes

- @cavelang/solver@0.31.0

## 0.30.0

### Patch Changes

- @cavelang/solver@0.30.0

## 0.29.1

### Patch Changes

- @cavelang/solver@0.29.1

## 0.29.0

### Minor Changes

- 0f46879: Add the optional, lazy Z3 WebAssembly adapter with exact model compilation,
  optimization, unsat cores, bounded execution, queued concurrency, and cleanup.
- 1b0fd3c: Add bounded verification workflows, an allowlisted Z3 CLI fixture, and governed execution of solver action proposals.

### Patch Changes

- 4b9a87b: Validate packed Z3 Wasm execution and keep the optional solver out of the default website bundle.
- Updated dependencies [7d2d992]
- Updated dependencies [4c009e9]
- Updated dependencies [1b0fd3c]
  - @cavelang/solver@0.29.0
