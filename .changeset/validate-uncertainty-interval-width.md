---
"@cavelang/core": patch
---

Validate interval half-widths with the shared positive finite uncertainty rule,
rejecting zero, negative, and nonfinite deltas with `InvalidUncertaintyError`.
