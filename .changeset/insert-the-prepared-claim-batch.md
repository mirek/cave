---
"@cavelang/store": patch
---

Allocate identities and insert from the prepared claim batch, preventing changing
claim-collection getters from silently dropping claims after preparation.
