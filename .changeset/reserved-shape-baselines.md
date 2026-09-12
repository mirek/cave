---
"@cavelang/cli": patch
---

Read shape-gate baseline violations inside the reserved write transaction so concurrent repairs cannot be silently undone by a gated append.
