---
"@cavelang/store": patch
"@cavelang/cli": patch
---

Reject unsupported path-opening intents before file detection or opening, preventing unknown modes from falling through to SQLite migration access.
