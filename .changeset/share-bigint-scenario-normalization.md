---
"@cavelang/solver": minor
"@cavelang/scenario": patch
---

Expose Exact.fromBigInts for exact normalization of integer intermediates and reuse it in scenario arithmetic, replacing duplicate Euclidean reduction without intermediate decimal serialization.
