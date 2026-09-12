---
"@cavelang/cli": patch
---

Prevent report, export, generate and backup output from overwriting SQLite WAL, shared-memory or rollback-journal files belonging to the source database, including through database symlinks.
