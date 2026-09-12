---
"@cavelang/store": patch
---

Reject snapshot verification and restore sources with SQLite sidecars, preventing WAL-only rows from being certified under a main-file checksum and then omitted during restore. Use online backup to create a standalone snapshot from a live store.
