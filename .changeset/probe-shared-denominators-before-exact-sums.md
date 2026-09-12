---
"@cavelang/solver": patch
---

Avoid repeated large denominator factors in exact addition and subtraction when a bounded Euclidean probe finds them. Preserve normalization and zero-divisor behavior, with signed identity regressions and full-operation benchmarks covering shared and coprime inputs.
