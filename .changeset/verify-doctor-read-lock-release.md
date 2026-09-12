---
"@cavelang/cli": patch
---

Verify doctor releases rollback-journal read locks after healthy and invalid-row reports so the existing writer connection can update and repair the store.
