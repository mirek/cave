# @cavelang/fusion

## 0.36.0

### Patch Changes

- b3f5de7: Avoid unnecessary mean accumulation for identical converted estimates and record bounded fallback cost measurements.
- b3f5de7: Keep fused means within the converted positive-weight input range, preserving identical means exactly across floating-point scales.
- b3f5de7: Capture claim uncertainty and numeric estimate fields once so sigma extraction and fusion conversion use consistent validated values.
- b3f5de7: Calculate fusion, noisy-AND and normalized hypotheses from the same input values that were validated, preventing changing getters from substituting invalid values.
- b3f5de7: Document and verify that pure fusion weights supplied occurrences, leaving historical revision and repeated-evidence selection to the caller.
- b3f5de7: Document the finite-number operand boundary and caller-owned workload limits of fusion arithmetic.
- b3f5de7: Preserve small posterior mean contributions when large positive and negative
  estimates cancel by compensating rounding during accumulation.
- b3f5de7: Retain the combined precision of many weak estimates beside a strong estimate
  using compensated weight accumulation for the posterior denominator and spread.
- b3f5de7: Use compensated probability totals for hypothesis normalization and gap checks
  so small contributions beside a dominant hypothesis are retained.
- b3f5de7: Validate fusion probabilities and means, prevent inherited unit-name conversion, and avoid intermediate overflow while explicitly rejecting unrepresentable posteriors.
- b3f5de7: Preserve tiny posterior means after extreme cancellation by exactly accumulating weighted terms when the ordinary numerator overflows.
- b3f5de7: Recover subnormal weighted contributions after finite cancellation instead of rounding each product prematurely.
- b3f5de7: Preserve representable small excesses and deficits in hypothesisGap by subtracting the unit baseline before combining the compensated summation correction.
- b3f5de7: Preserve representable subnormal posterior means with power-of-two scaling and accumulation before division when finite, retaining the existing overflow fallback.
- b3f5de7: Preserve root-weight factors through normalization when the initial division becomes subnormal or underflows, retaining representable contributions from very uncertain estimates.
- b3f5de7: Validate every claim, estimate, condition and hypothesis array slot so sparse arrays
  cannot silently omit evidence or retain holes in normalized hypotheses.
- b3f5de7: Validate claim estimate sigma after unit conversion so duration scaling cannot
  return an infinite or zero uncertainty spread.
- b3f5de7: Share estimate validation between extraction and fusion so structurally
  constructed claims cannot produce non-finite means or invalid confidence.
- b3f5de7: Reject explicit null confidence and non-string estimate units before fusion,
  including zero-confidence evidence, while preserving omitted-field defaults.
- b3f5de7: Verify fusion cancellation against an independent integer-weight oracle across 768 ordered cases.
- b3f5de7: Verify duration-fusion invariance across input order and compatible units, and clarify output-unit selection after zero-confidence filtering.
- b3f5de7: Verify near-unit hypothesis gaps against independent exact integer sums across varied probability sets and input orders.
- b3f5de7: Exercise subnormal means, underflowed root weights and cancellation through the installed fusion package in packed smoke verification.
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b723c48]
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
- Updated dependencies [0b1f150]
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
  - @cavelang/core@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [d64cad8]
- Updated dependencies [15c38bf]
  - @cavelang/core@0.35.0

## 0.34.0

### Patch Changes

- @cavelang/core@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [cdf4ed9]
- Updated dependencies [1320911]
- Updated dependencies [0adc7d2]
  - @cavelang/core@0.33.0

## 0.32.3

### Patch Changes

- Updated dependencies [7c1950a]
- Updated dependencies [9c28743]
  - @cavelang/core@0.32.3

## 0.32.2

### Patch Changes

- Updated dependencies [a7397de]
- Updated dependencies [a1f05bc]
  - @cavelang/core@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies [af53c4c]
  - @cavelang/core@0.32.1

## 0.32.0

### Patch Changes

- @cavelang/core@0.32.0

## 0.31.1

### Patch Changes

- @cavelang/core@0.31.1

## 0.31.0

### Patch Changes

- @cavelang/core@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [afce4f3]
- Updated dependencies [6035063]
- Updated dependencies [26b23cf]
  - @cavelang/core@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [3d2f5b9]
  - @cavelang/core@0.29.1

## 0.29.0

### Patch Changes

- dbc0d59: Validate units in the shared fusion library, convert fixed-duration estimates, and expose typed failures consistently to adapters.
- 0ac44fd: Reject zero, negative, non-finite, and malformed uncertainty values consistently across parsing, claim construction, interpretation, and fusion.
- Updated dependencies [9022a00]
- Updated dependencies [75ed4cf]
- Updated dependencies [8003648]
- Updated dependencies [a606db4]
- Updated dependencies [03373de]
- Updated dependencies [662e6aa]
- Updated dependencies [1f5ae77]
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

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
