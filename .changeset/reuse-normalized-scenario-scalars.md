---
"@cavelang/scenario": patch
---

Reuse normalized exact scalar values when no K/M/B/T multiplier applies, avoiding a second bigint normalization without changing units or approximation metadata.
