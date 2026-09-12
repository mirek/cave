---
"@cavelang/store": patch
---

Close partially initialized database connections after any store startup failure,
including PRAGMA setup, statement preparation and vocabulary loading. Preserve
both initialization and cleanup diagnostics when closing also fails.
