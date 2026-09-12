---
"@cavelang/cli": patch
---

Preserve database replacement and cleanup errors in the playground. Retire workers
after database cleanup failure so rebuilding starts a fresh runtime instead of
querying a possibly closed database.
