---
"@cavelang/solver-z3": patch
---

Require finite matching objective bounds attained by the returned model before claiming optimality. Unbounded and unattained objectives now return unknown instead of false proofs of optimality.
