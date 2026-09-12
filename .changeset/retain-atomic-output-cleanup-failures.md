---
"@cavelang/cli": patch
---

Retain simultaneous atomic-output write, close and temporary-directory cleanup failures in their original order. Never publish after a failed write or file close, and document the completed-file state when directory cleanup fails after replacement.
