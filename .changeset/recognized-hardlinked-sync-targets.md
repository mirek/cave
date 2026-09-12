---
"@cavelang/cli": patch
"@cavelang/sync": patch
---

Recognize hard links to the target database as self-sync before SQLite attachment, preserving the no-op contract in ordinary and dry-run syncs.
