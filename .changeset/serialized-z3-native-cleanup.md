---
"@cavelang/solver-z3": patch
---

Defer native reference cleanup during asynchronous Z3 checks to prevent garbage-collection races that corrupt optimization results or crash the runtime.
