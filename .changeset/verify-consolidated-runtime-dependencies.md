---
"@cavelang/cli": patch
---

Fail CLI consolidation when a published module's literal runtime import is
missing from the CLI's runtime dependency declarations, identifying the file
and dependency before packaging.
