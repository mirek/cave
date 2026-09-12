---
"@cavelang/cli": patch
---

Claim automation batches atomically with refreshed declarations and vocabulary,
preventing duplicate concurrent firings and firing revoked automations. Commit
watermarks before executing steps, and reject settling inside caller-owned
transactions before any derivation or batch claim.
