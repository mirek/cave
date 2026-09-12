---
"@cavelang/solver": patch
"@cavelang/cli": patch
---

Retain bigint intermediates across constant multiplication chains in linear analysis, preserving cross-cancellation and operand evaluation while avoiding repeated growing decimal serialization. Add exact-chain regressions and paired resource measurements on both supported Node versions.
