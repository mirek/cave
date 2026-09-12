---
"@cavelang/cli": patch
---

Reject already-cancelled shell completions before creating prompt files, preserving the cancellation reason even when prompt-file writes would fail.
