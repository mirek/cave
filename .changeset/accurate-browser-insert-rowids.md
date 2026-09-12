---
"@cavelang/core": patch
---

Return SQLite's actual last inserted row ID from browser adapter writes instead of zero, with shared native/browser regressions for insert, update and no-op results.
