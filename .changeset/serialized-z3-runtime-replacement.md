---
"@cavelang/solver-z3": patch
---

Wait for pending Z3 shutdown before creating a replacement runtime, and share one close promise so repeated old-runtime closes cannot affect the replacement.
