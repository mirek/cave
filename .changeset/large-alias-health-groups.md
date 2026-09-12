---
"@cavelang/cli": patch
---

Read alias disagreement rows in one ordered query and group them in memory, avoiding SQLite parameter limits and repeated group-array copying for large alias closures.
