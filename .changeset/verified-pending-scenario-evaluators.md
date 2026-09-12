---
"@cavelang/scenario": patch
---

Verify that asynchronously pending evaluators retain no overlay transaction and cannot roll back subsequent store writes on success or rejection. Clarify that evaluator deadlines and cancellation are caller-owned.
